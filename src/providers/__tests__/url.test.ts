import { describe, expect, it } from 'vitest';
import { buildEndpoint, resolveApiBase } from '../url';

describe('resolveApiBase', () => {
  it('adds /v1 when base is host only', () => {
    expect(resolveApiBase('https://api.example.com')).toBe('https://api.example.com/v1');
  });

  it('keeps /v1 in base URL', () => {
    expect(resolveApiBase('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
  });

  // F9: a query string on the base URL (e.g. an api-version) must survive.
  it('preserves a query string on a host-only base', () => {
    expect(resolveApiBase('https://api.example.com?api-version=2024-02-01')).toBe(
      'https://api.example.com/v1?api-version=2024-02-01',
    );
  });
});

describe('buildEndpoint', () => {
  it('defaults empty path to chat completions under /v1 base', () => {
    expect(buildEndpoint('https://api.example.com/v1/', '')).toBe(
      'https://api.example.com/v1/chat/completions',
    );
  });

  it('lists models without duplicating /v1', () => {
    expect(buildEndpoint('https://api.example.com/v1/', '/models')).toBe(
      'https://api.example.com/v1/models',
    );
  });

  it('strips /v1 prefix from path when base already includes /v1', () => {
    expect(buildEndpoint('https://api.example.com', '/v1/chat/completions')).toBe(
      'https://api.example.com/v1/chat/completions',
    );
  });

  it('works for localhost ollama', () => {
    expect(buildEndpoint('http://localhost:11434', '/v1/chat/completions')).toBe(
      'http://localhost:11434/v1/chat/completions',
    );
  });

  it('resolves OpenRouter /api/v1 models and chat paths', () => {
    expect(buildEndpoint('https://openrouter.ai/api/v1', '/models')).toBe(
      'https://openrouter.ai/api/v1/models',
    );
    expect(buildEndpoint('https://openrouter.ai/api/v1', '/v1/chat/completions')).toBe(
      'https://openrouter.ai/api/v1/chat/completions',
    );
  });

  // F9: the path segment is inserted before the base's query, not after it.
  it('places the path before a preserved query string', () => {
    expect(buildEndpoint('https://host.example?api-version=2024-02-01', '')).toBe(
      'https://host.example/v1/chat/completions?api-version=2024-02-01',
    );
  });
});
