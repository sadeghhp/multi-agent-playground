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
    ).toEqual([{ id: 'gpt-4' }, { id: 'gpt-3.5-turbo' }]);
  });

  it('reads models[] string list', () => {
    expect(parseModelsPayload({ models: ['llama3.1', 'qwen2.5'] })).toEqual([
      { id: 'llama3.1' },
      { id: 'qwen2.5' },
    ]);
  });

  it('reads OpenRouter pricing (USD per token → per 1M)', () => {
    expect(
      parseModelsPayload({
        data: [
          {
            id: 'openai/gpt-4o-mini',
            pricing: { prompt: '0.00000015', completion: '0.0000006' },
          },
          {
            id: 'free/model',
            pricing: { prompt: '0', completion: '0' },
          },
          { id: 'no-pricing' },
        ],
      }),
    ).toEqual([
      { id: 'openai/gpt-4o-mini', inputPer1M: 0.15, outputPer1M: 0.6 },
      { id: 'free/model', inputPer1M: 0, outputPer1M: 0 },
      { id: 'no-pricing' },
    ]);
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
    expect(result.models).toEqual([{ id: 'm1' }, { id: 'm2' }]);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/models',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
