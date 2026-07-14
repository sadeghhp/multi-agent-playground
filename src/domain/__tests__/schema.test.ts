import { describe, expect, it } from 'vitest';
import { Provider } from '../schema';
import { createProvider } from '../factories';

describe('Provider.baseUrl validation (L-7 regression)', () => {
  it('allows the not-yet-configured empty default', () => {
    const result = Provider.safeParse(createProvider({ baseUrl: '' }));
    expect(result.success).toBe(true);
  });

  it('allows a well-formed http(s) URL', () => {
    expect(Provider.safeParse(createProvider({ baseUrl: 'http://localhost:11434' })).success).toBe(true);
    expect(Provider.safeParse(createProvider({ baseUrl: 'https://api.example.com' })).success).toBe(true);
  });

  it('rejects an unusable baseUrl instead of accepting it silently', () => {
    const result = Provider.safeParse(createProvider({ baseUrl: 'not-a-url' }));
    expect(result.success).toBe(false);
  });
});
