import { describe, expect, it } from 'vitest';
import { deriveAuthMethod, schemeFromAuthMethod } from '../providerAuth';

describe('deriveAuthMethod', () => {
  it('treats an empty or whitespace key as no-auth regardless of scheme', () => {
    expect(deriveAuthMethod('', 'bearer')).toBe('none');
    expect(deriveAuthMethod('   ', 'bearer')).toBe('none');
    expect(deriveAuthMethod('', 'custom-header')).toBe('none');
  });

  it('maps a present key to the selected scheme', () => {
    expect(deriveAuthMethod('sk-123', 'bearer')).toBe('bearer');
    expect(deriveAuthMethod('sk-123', 'custom-header')).toBe('custom-header');
  });
});

describe('schemeFromAuthMethod', () => {
  it('seeds custom-header only for the custom-header method, bearer otherwise', () => {
    expect(schemeFromAuthMethod('custom-header')).toBe('custom-header');
    expect(schemeFromAuthMethod('bearer')).toBe('bearer');
    // 'none' has no scheme of its own; default the radio to bearer.
    expect(schemeFromAuthMethod('none')).toBe('bearer');
  });
});
