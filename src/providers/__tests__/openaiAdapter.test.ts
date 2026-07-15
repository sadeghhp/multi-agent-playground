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

  it('requests stream_options.include_usage for OpenRouter / OpenAI hosts only', async () => {
    const makeSse = () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeSse())
      .mockResolvedValueOnce(makeSse())
      .mockResolvedValueOnce(makeSse());
    vi.stubGlobal('fetch', fetchMock);

    await sendChat(
      createProvider({ baseUrl: 'https://openrouter.ai/api', apiKey: 'k' }),
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      { onToken: () => {} },
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string).stream_options).toEqual({
      include_usage: true,
    });

    await sendChat(
      createProvider({ baseUrl: 'https://api.openai.com', apiKey: 'k' }),
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      { onToken: () => {} },
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string).stream_options).toEqual({
      include_usage: true,
    });

    await sendChat(
      createProvider({ baseUrl: 'http://localhost:11434', apiKey: '' }),
      { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      { onToken: () => {} },
    );
    expect(JSON.parse(fetchMock.mock.calls[2][1].body as string).stream_options).toBeUndefined();
  });

  it('streams reasoning deltas via onReasoningToken, separate from content', async () => {
    const sse = [
      'data: {"model":"test-model","choices":[{"delta":{"reasoning_content":"pondering "}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"deeply"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(sse));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    const tokens: string[] = [];
    const reasoningTokens: string[] = [];
    const res = await sendChat(
      provider,
      { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
      { onToken: (c) => tokens.push(c), onReasoningToken: (c) => reasoningTokens.push(c) },
    );

    expect(reasoningTokens).toEqual(['pondering ', 'deeply']);
    expect(tokens).toEqual(['answer']);
    expect(res.reasoning).toBe('pondering deeply');
    expect(res.text).toBe('answer');
  });

  it('reports empty text with reasoning captured when a reasoning model never emits content', async () => {
    const sse = [
      'data: {"model":"test-model","choices":[{"delta":{"reasoning_content":"thinking a lot"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(sse));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    const res = await sendChat(
      provider,
      { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
      { onToken: () => {}, onReasoningToken: () => {} },
    );

    expect(res.text).toBe('');
    expect(res.reasoning).toBe('thinking a lot');
  });

  it('strips inline <think> tags from streamed content into reasoning', async () => {
    const sse = [
      'data: {"model":"test-model","choices":[{"delta":{"content":"<think>weighing options"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"</think>the answer is 4"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(sse));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    const res = await sendChat(
      provider,
      { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
      { onToken: () => {} },
    );

    expect(res.text).toBe('the answer is 4');
    expect(res.reasoning).toBe('weighing options');
  });

  it('strips inline <think> tags from a plain JSON response into reasoning', async () => {
    const body = {
      model: 'test-model',
      choices: [
        {
          message: { role: 'assistant', content: '<think>weighing options</think>the answer is 4' },
          finish_reason: 'stop',
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    const res = await sendChat(provider, { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.text).toBe('the answer is 4');
    expect(res.reasoning).toBe('weighing options');
  });

  it('strips Qwen-style closer-only </think> (open tag was in the prompt)', async () => {
    const sse = [
      'data: {"model":"test-model","choices":[{"delta":{"content":"Thinking Process:\\n1. Analyze"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"</think>\\nپاسخ نهایی"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(sse));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    const res = await sendChat(
      provider,
      { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
      { onToken: () => {} },
    );

    expect(res.text).toBe('پاسخ نهایی');
    expect(res.reasoning).toBe('Thinking Process:\n1. Analyze');
  });

  it('keeps reasoning_content separate from content in a plain JSON response', async () => {
    const body = {
      model: 'test-model',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'the answer',
            reasoning_content: 'pondering',
          },
          finish_reason: 'stop',
        },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(okResponse(body));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    const res = await sendChat(provider, { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] });

    expect(res.text).toBe('the answer');
    expect(res.reasoning).toBe('pondering');
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

  it('accepts content-part arrays (multimodal / compat servers)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          model: 'test-model',
          choices: [{
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'hello world' }],
            },
            finish_reason: 'stop',
          }],
        }),
      ),
    );
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });
    const res = await sendChat(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.text).toBe('hello world');
  });

  it('captures reasoning_content separately when content is null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          model: 'test-model',
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              reasoning_content: 'ok',
            },
            finish_reason: 'stop',
          }],
        }),
      ),
    );
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });
    const res = await sendChat(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.text).toBe('');
    expect(res.reasoning).toBe('ok');
  });

  it('promotes a tagged answer out of the reasoning channel when content is empty', async () => {
    const sse = [
      'data: {"model":"test-model","choices":[{"delta":{"reasoning_content":"<think>ponder"}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"</think>the answer is 4"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(sse)));
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    const res = await sendChat(
      provider,
      { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
      { onToken: () => {} },
    );

    expect(res.text).toBe('the answer is 4');
    expect(res.reasoning).toBe('ponder');
  });

  it('does not dump untagged reasoning into the answer body', async () => {
    const sse = [
      'data: {"model":"test-model","choices":[{"delta":{"reasoning_content":"pure chain of thought"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(sse)));
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    const res = await sendChat(
      provider,
      { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
      { onToken: () => {} },
    );

    expect(res.text).toBe('');
    expect(res.reasoning).toBe('pure chain of thought');
  });

  it('reads streamed answer from delta.text when content is absent', async () => {
    const sse = [
      'data: {"model":"test-model","choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n',
      'data: {"choices":[{"delta":{"text":"final answer"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(sse)));
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    const res = await sendChat(
      provider,
      { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
      { onToken: () => {} },
    );

    expect(res.text).toBe('final answer');
    expect(res.reasoning).toBe('thinking');
  });

  it('reads a final choice.message when deltas left content empty', async () => {
    const sse = [
      'data: {"model":"test-model","choices":[{"delta":{"reasoning_content":"thinking"}}]}\n\n',
      'data: {"choices":[{"message":{"role":"assistant","content":"final answer"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(sse)));
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    const res = await sendChat(
      provider,
      { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
      { onToken: () => {} },
    );

    expect(res.text).toBe('final answer');
    expect(res.reasoning).toBe('thinking');
  });

  it('accepts legacy choices[0].text completion shape', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse({
          choices: [{ text: 'legacy ok', finish_reason: 'stop' }],
        }),
      ),
    );
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });
    const res = await sendChat(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.text).toBe('legacy ok');
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
    ).rejects.toMatchObject({
      kind: 'bad-request',
      detail: 'context length exceeded',
      streamed: true,
    });
  });

  it('classifies OpenRouter mid-stream errors with metadata.raw as bad-request when upstream is invalid-arg', async () => {
    const errorChunk = {
      error: {
        code: 502,
        message: 'JSON error injected into SSE stream',
        metadata: {
          error_type: 'unmapped',
          raw: '{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}',
        },
      },
      choices: [{ delta: { content: '' }, finish_reason: 'error' }],
    };
    const sse = [
      'data: {"model":"google/gemini-2.5-flash-lite","choices":[{"delta":{"content":"partial"}}]}\n\n',
      `data: ${JSON.stringify(errorChunk)}\n\n`,
    ];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse(sse)));
    const provider = createProvider({ baseUrl: 'https://openrouter.ai/api', apiKey: 'k' });

    await expect(
      sendChat(
        provider,
        { model: 'google/gemini-2.5-flash-lite', messages: [{ role: 'user', content: 'hi' }] },
        { onToken: () => {} },
      ),
    ).rejects.toMatchObject({
      kind: 'bad-request',
      status: 502,
      streamed: true,
      errorType: 'unmapped',
      rawUpstream: expect.stringMatching(/invalid argument/i),
      detail: 'JSON error injected into SSE stream',
    });
  });

  it('preserves structured metadata from HTTP error JSON bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: 'Bad Request',
              metadata: { error_type: 'invalid_request', raw: 'max_tokens out of range' },
            },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });

    await expect(
      sendChat(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({
      kind: 'bad-request',
      status: 400,
      errorType: 'invalid_request',
      rawUpstream: 'max_tokens out of range',
    });
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
