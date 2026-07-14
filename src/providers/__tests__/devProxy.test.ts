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
});
