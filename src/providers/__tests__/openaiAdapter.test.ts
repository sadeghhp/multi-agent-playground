import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProvider } from '../../domain/factories';
import { sendChat } from '../openaiAdapter';

function okResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
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

  it('flags an unsupported response shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ nope: true })));
    const provider = createProvider({ baseUrl: 'https://api.example.com', apiKey: 'k' });
    await expect(
      sendChat(provider, { model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ kind: 'unsupported-response' });
  });
});
