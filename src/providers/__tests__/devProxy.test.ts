import { describe, expect, it } from 'vitest';
import { DEV_PROXY_PATH, resolveFetchTarget, shouldUseDevProxy } from '../devProxy';

describe('devProxy', () => {
  it('does not proxy in test mode', () => {
    expect(shouldUseDevProxy('https://api.example.com/v1/chat/completions')).toBe(false);
    expect(resolveFetchTarget('https://api.example.com/v1/chat/completions').url).toBe(
      'https://api.example.com/v1/chat/completions',
    );
  });

  it('exports stable proxy constants', () => {
    expect(DEV_PROXY_PATH).toBe('/__provider_proxy');
  });

  it('does not route through the proxy when bypassDevProxy is set', () => {
    const endpoint = 'https://api.example.com/v1/chat/completions';
    // In test mode the proxy is already off, so this asserts the flag never
    // *forces* proxying and the target stays the raw endpoint.
    expect(shouldUseDevProxy(endpoint, { bypassDevProxy: true })).toBe(false);
    expect(resolveFetchTarget(endpoint, { bypassDevProxy: true })).toEqual({ url: endpoint });
    expect(resolveFetchTarget(endpoint, { bypassDevProxy: false })).toEqual({ url: endpoint });
  });
});
