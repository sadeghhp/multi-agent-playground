import { describe, expect, it } from 'vitest';
import { buildEndpoint, resolveApiBase } from '../url';

describe('resolveApiBase', () => {
  it('adds /v1 when base is host only', () => {
    expect(resolveApiBase('https://api.example.com')).toBe('https://api.example.com/v1');
  });

  it('keeps /v1 in base URL', () => {
    expect(resolveApiBase('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
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
});
