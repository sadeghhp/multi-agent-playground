import { describe, expect, it } from 'vitest';
import { deriveAuthMethod } from '../providerAuth';

describe('deriveAuthMethod', () => {
  it('treats an empty or whitespace key as no-auth', () => {
    expect(deriveAuthMethod('')).toBe('none');
    expect(deriveAuthMethod('   ')).toBe('none');
  });

  it('uses bearer auth when a key is present', () => {
    expect(deriveAuthMethod('sk-123')).toBe('bearer');
  });
});
