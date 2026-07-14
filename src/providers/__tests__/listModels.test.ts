import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProvider } from '../../domain/factories';
import { listModels, parseModelsPayload } from '../listModels';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseModelsPayload', () => {
  it('reads OpenAI-style data[].id', () => {
    expect(
      parseModelsPayload({
        data: [{ id: 'gpt-4' }, { id: 'gpt-3.5-turbo' }],
      }),
    ).toEqual(['gpt-4', 'gpt-3.5-turbo']);
  });

  it('reads models[] string list', () => {
    expect(parseModelsPayload({ models: ['llama3.1', 'qwen2.5'] })).toEqual(['llama3.1', 'qwen2.5']);
  });
});

describe('listModels', () => {
  it('fetches and parses /v1/models', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: 'm1' }, { id: 'm2' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const provider = createProvider({
      baseUrl: 'https://api.example.com',
      authMethod: 'bearer',
      apiKey: 'k',
    });
    const result = await listModels(provider);

    expect(result.ok).toBe(true);
    expect(result.models).toEqual(['m1', 'm2']);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
