import { describe, expect, it } from 'vitest';
import { isAllowedTarget } from '../providerDevProxyPlugin';

describe('isAllowedTarget', () => {
  it('allows http to private / LAN / loopback / link-local hosts', () => {
    // The screenshot repro: an LM Studio server on the LAN over plain http.
    expect(isAllowedTarget('http://192.168.100.7:1234/v1/chat/completions')).toBe(true);
    expect(isAllowedTarget('http://192.168.1.50:11434/v1/models')).toBe(true);
    expect(isAllowedTarget('http://10.0.0.5:8080/v1')).toBe(true);
    expect(isAllowedTarget('http://172.16.0.9/v1')).toBe(true);
    expect(isAllowedTarget('http://172.31.255.1/v1')).toBe(true);
    expect(isAllowedTarget('http://localhost:1234/v1')).toBe(true);
    expect(isAllowedTarget('http://127.0.0.1:1234/v1')).toBe(true);
    expect(isAllowedTarget('http://169.254.1.1/v1')).toBe(true);
    expect(isAllowedTarget('http://mybox.local:1234/v1')).toBe(true);
  });

  it('blocks http to public hosts (SSRF guard on the dev server)', () => {
    expect(isAllowedTarget('http://evil.example.com/v1')).toBe(false);
    expect(isAllowedTarget('http://8.8.8.8/v1')).toBe(false);
    // 172.15 and 172.32 sit just outside the RFC 1918 172.16/12 block.
    expect(isAllowedTarget('http://172.15.0.1/v1')).toBe(false);
    expect(isAllowedTarget('http://172.32.0.1/v1')).toBe(false);
  });

  it('allows https to any host', () => {
    expect(isAllowedTarget('https://api.openai.com/v1/chat/completions')).toBe(true);
    expect(isAllowedTarget('https://evil.example.com/v1')).toBe(true);
  });

  it('rejects non-http(s) protocols and malformed input', () => {
    expect(isAllowedTarget('ftp://192.168.1.1/x')).toBe(false);
    expect(isAllowedTarget('not a url')).toBe(false);
  });
});
