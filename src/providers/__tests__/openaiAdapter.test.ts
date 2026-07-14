import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProvider } from '../../domain/factories';
import { sendChat } from '../openaiAdapter';

function okResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/**
 * An SSE response that sends `initialChunks` then goes silent — it never
 * closes or errors on its own. The stream only ever settles if `signal`
 * (the same signal the mocked `fetch` receives) aborts, mirroring how a real
 * network connection is torn down when its request is aborted mid-stream.
 */
function stalledSseResponse(initialChunks: string[], signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of initialChunks) controller.enqueue(encoder.encode(c));
      const onAbort = () => controller.error(signal.reason ?? new DOMException('aborted', 'AbortError'));
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

const sampleBody = {
  model: 'test-model',
  choices: [{ message: { role: 'assistant', content: 'hello world' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sendChat', () => {
  it('builds the endpoint, sends auth, and normalizes the response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sampleBody));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createProvider({
      baseUrl: 'https://api.example.com/',
      path: '/v1/chat/completions',
      authMethod: 'bearer',
      authPrefix: 'Bearer',
      authHeaderName: 'Authorization',
      apiKey: 'secret-key',
    });

    const res = await sendChat(provider, {
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.5,
      maxOutputTokens: 100,
    });

    expect(res.text).toBe('hello world');
    expect(res.finishReason).toBe('stop');
    expect(res.totalTokens).toBe(7);
    expect(res.status).toBe(200);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret-key');
    const body = JSON.parse(init.body as string);
    expect(body.max_tokens).toBe(100); // maxOutputTokens -> max_tokens
    expect(body.model).toBe('test-model');
  });

  it('sends a custom-header key raw, without a Bearer prefix', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sampleBody));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createProvider({
      baseUrl: 'https://api.example.com',
      authMethod: 'custom-header',
      authHeaderName: 'x-api-key',
      apiKey: 'sk-raw',
    });

    await sendChat(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] });

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-raw');
    expect(headers.Authorization).toBeUndefined();
  });

  it('falls back to Authorization when authHeaderName is a forbidden header name (L-1 regression)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sampleBody));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createProvider({
      baseUrl: 'https://api.example.com',
      authMethod: 'bearer',
      authHeaderName: 'User-Agent',
      apiKey: 'secret-key',
    });

    await sendChat(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] });

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    // The forbidden name must never be used to carry the key...
    expect(headers['User-Agent']).toBeUndefined();
    // ...it falls back to the safe default instead.
    expect(headers.Authorization).toBe('Bearer secret-key');
  });

  it('strips forbidden custom headers but keeps allowed ones', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sampleBody));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createProvider({
      baseUrl: 'https://api.example.com',
      apiKey: 'k',
      customHeaders: { 'X-Custom': 'yes', Host: 'evil.com', 'user-agent': 'x' },
    });

    await sendChat(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] });

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['X-Custom']).toBe('yes');
    expect(headers.Host).toBeUndefined();
    expect(headers['user-agent']).toBeUndefined();
  });

  it('allows http for remote endpoints', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sampleBody));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider({ baseUrl: 'http://api.example.com', apiKey: 'k' });

    const res = await sendChat(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.text).toBe('hello world');
    expect(fetchMock).toHaveBeenCalled();
  });

  it('allows http for localhost', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sampleBody));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider({ baseUrl: 'http://localhost:11434', apiKey: '' , authMethod: 'none'});

    const res = await sendChat(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.text).toBe('hello world');
  });

  it('classifies a 401 as auth', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'bad' });
    await expect(
      sendChat(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ kind: 'auth', status: 401 });
  });

  it('classifies a thrown "Failed to fetch" as cors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });
    await expect(
      sendChat(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ kind: 'cors' });
  });

  it('reports aborted when the caller signal is already aborted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      sendChat(
        provider,
        { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('streams SSE deltas via onToken and normalizes the assembled result', async () => {
    const sse = [
      'data: {"model":"test-model","choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n',
      'data: [DONE]\n\n',
    ];
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(sse));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    const tokens: string[] = [];
    const res = await sendChat(
      provider,
      { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
      { onToken: (c) => tokens.push(c) },
    );

    expect(tokens).toEqual(['hello ', 'world']);
    expect(res.text).toBe('hello world');
    expect(res.finishReason).toBe('stop');
    expect(res.totalTokens).toBe(7);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.stream).toBe(true);
  });

  it('emits the full text once when a streaming request returns plain JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse(sampleBody));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    const tokens: string[] = [];
    const res = await sendChat(
      provider,
      { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
      { onToken: (c) => tokens.push(c) },
    );

    expect(tokens).toEqual(['hello world']);
    expect(res.text).toBe('hello world');
  });

  it('flags an unsupported response shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ nope: true })));
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });
    await expect(
      sendChat(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ kind: 'unsupported-response' });
  });

  it('surfaces an in-band SSE error instead of silently returning empty text', async () => {
    const sse = [
      'data: {"model":"test-model","choices":[{"delta":{"content":"partial"}}]}\n\n',
      'data: {"error":{"message":"context length exceeded"}}\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(sse)));
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    await expect(
      sendChat(
        provider,
        { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
        { onToken: () => {} },
      ),
    ).rejects.toMatchObject({ kind: 'server-error', detail: 'context length exceeded' });
  });

  it('times out a stream that stalls mid-response instead of hanging forever', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) =>
        Promise.resolve(
          stalledSseResponse(
            ['data: {"model":"test-model","choices":[{"delta":{"content":"partial"}}]}\n\n'],
            init.signal!,
          ),
        ),
      ),
    );
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    await expect(
      sendChat(
        provider,
        { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
        { onToken: () => {}, timeoutMs: 30 },
      ),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('does not leak abort listeners on a reused long-lived caller signal (L-2 regression)', async () => {
    // Force the AbortSignal.any-less fallback merge path, which is the one
    // that historically leaked a listener per call on a signal that never aborts.
    const originalAny = AbortSignal.any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (AbortSignal as any).any;
    try {
      // A fresh Response per call — a Response body can only be read once, and
      // this test calls sendChat repeatedly against the same mock.
      vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(okResponse(sampleBody))));
      const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });

      // A long-lived signal reused across many requests, e.g. a per-conversation
      // "stop" controller — it never aborts over the life of this test.
      const controller = new AbortController();
      let added = 0;
      let removed = 0;
      const originalAdd = controller.signal.addEventListener.bind(controller.signal);
      const originalRemove = controller.signal.removeEventListener.bind(controller.signal);
      controller.signal.addEventListener = ((...args: Parameters<typeof originalAdd>) => {
        added += 1;
        return originalAdd(...args);
      }) as typeof originalAdd;
      controller.signal.removeEventListener = ((...args: Parameters<typeof originalRemove>) => {
        removed += 1;
        return originalRemove(...args);
      }) as typeof originalRemove;

      for (let i = 0; i < 5; i++) {
        await sendChat(
          provider,
          { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
          { signal: controller.signal },
        );
      }

      expect(added).toBe(5);
      // Every listener this attached to the caller's signal must have been
      // detached again once its own request settled — none left dangling.
      expect(removed).toBe(5);
    } finally {
      if (originalAny) AbortSignal.any = originalAny;
    }
  });
});
