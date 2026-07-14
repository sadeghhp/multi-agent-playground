import { describe, expect, it } from 'vitest';
import { isAllowedTarget, isSameOriginRequest } from '../providerDevProxyPlugin';

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

  it('blocks the cloud metadata service on any scheme (SSRF guard)', () => {
    // 169.254.169.254 is otherwise inside the allowed link-local range, but it
    // must never be reachable — it's the AWS/GCP/Azure/OpenStack metadata IP.
    expect(isAllowedTarget('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isAllowedTarget('https://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isAllowedTarget('http://[169.254.169.254]/latest/meta-data/')).toBe(false);
    // Other link-local addresses (real LAN tooling) remain allowed.
    expect(isAllowedTarget('http://169.254.1.1/v1')).toBe(true);
  });

  it('rejects non-http(s) protocols and malformed input', () => {
    expect(isAllowedTarget('ftp://192.168.1.1/x')).toBe(false);
    expect(isAllowedTarget('not a url')).toBe(false);
  });
});

describe('isSameOriginRequest', () => {
  it('allows requests with no Origin header (same-origin GET, non-browser callers)', () => {
    expect(isSameOriginRequest({ headers: { host: 'localhost:5173' } })).toBe(true);
  });

  it('allows a same-origin Origin header', () => {
    expect(
      isSameOriginRequest({
        headers: { host: 'localhost:5173', origin: 'http://localhost:5173' },
      }),
    ).toBe(true);
  });

  it('rejects a cross-origin Origin header (CSRF/SSRF-via-open-tab guard)', () => {
    expect(
      isSameOriginRequest({
        headers: { host: 'localhost:5173', origin: 'https://evil.example.com' },
      }),
    ).toBe(false);
  });

  it('rejects a malformed Origin header', () => {
    expect(
      isSameOriginRequest({ headers: { host: 'localhost:5173', origin: 'not a url' } }),
    ).toBe(false);
  });
});
