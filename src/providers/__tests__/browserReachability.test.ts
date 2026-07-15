import { describe, expect, it } from 'vitest';
import { assessProviderReachability } from '../browserReachability';
import { isAppOnLocalhost, isPrivateNetworkHost, isRemoteHttp } from '../url';

describe('isPrivateNetworkHost', () => {
  it('recognizes loopback and .localhost', () => {
    expect(isPrivateNetworkHost('localhost')).toBe(true);
    expect(isPrivateNetworkHost('127.0.0.1')).toBe(true);
    expect(isPrivateNetworkHost('::1')).toBe(true);
    expect(isPrivateNetworkHost('[::1]')).toBe(true);
    expect(isPrivateNetworkHost('ollama.localhost')).toBe(true);
  });

  it('recognizes RFC1918 and link-local', () => {
    expect(isPrivateNetworkHost('192.168.1.50')).toBe(true);
    expect(isPrivateNetworkHost('10.0.0.2')).toBe(true);
    expect(isPrivateNetworkHost('172.16.0.1')).toBe(true);
    expect(isPrivateNetworkHost('169.254.1.1')).toBe(true);
  });

  it('rejects public hosts and the cloud metadata IP', () => {
    expect(isPrivateNetworkHost('api.openai.com')).toBe(false);
    expect(isPrivateNetworkHost('8.8.8.8')).toBe(false);
    expect(isPrivateNetworkHost('169.254.169.254')).toBe(false);
  });
});

describe('isAppOnLocalhost', () => {
  it('is true for localhost origins', () => {
    expect(isAppOnLocalhost('http://localhost:5173')).toBe(true);
    expect(isAppOnLocalhost('http://127.0.0.1:4173')).toBe(true);
  });

  it('is false for public origins', () => {
    expect(isAppOnLocalhost('https://sadeghhp.github.io')).toBe(false);
    expect(isAppOnLocalhost('https://example.com')).toBe(false);
  });
});

describe('isRemoteHttp', () => {
  it('is true only for non-private http URLs', () => {
    expect(isRemoteHttp('http://api.example.com')).toBe(true);
    expect(isRemoteHttp('http://localhost:11434')).toBe(false);
    expect(isRemoteHttp('https://api.example.com')).toBe(false);
  });
});

describe('assessProviderReachability', () => {
  const githubPages = 'https://sadeghhp.github.io';
  const localApp = 'http://localhost:5173';

  it('blocks localhost provider from a public app origin', () => {
    const r = assessProviderReachability('http://localhost:11434', githubPages);
    expect(r.ok).toBe(false);
    expect(r.issue).toBe('private-network');
    expect(r.hints.length).toBeGreaterThan(0);
  });

  it('allows localhost provider from a local app origin', () => {
    const r = assessProviderReachability('http://localhost:11434', localApp);
    expect(r.ok).toBe(true);
    expect(r.issue).toBeUndefined();
  });

  it('blocks remote http', () => {
    const r = assessProviderReachability('http://api.example.com', githubPages);
    expect(r.ok).toBe(false);
    expect(r.issue).toBe('insecure-remote');
  });

  it('warns (ok) for remote https that needs CORS', () => {
    const r = assessProviderReachability('https://api.openai.com', githubPages);
    expect(r.ok).toBe(true);
    expect(r.issue).toBe('cors-required');
  });

  it('allows LAN providers only when the app is local', () => {
    expect(assessProviderReachability('http://192.168.1.50:1234', localApp).ok).toBe(true);
    expect(assessProviderReachability('http://192.168.1.50:1234', githubPages).ok).toBe(false);
    expect(assessProviderReachability('http://192.168.1.50:1234', githubPages).issue).toBe(
      'private-network',
    );
  });

  it('rejects invalid URLs', () => {
    const r = assessProviderReachability('not a url', localApp);
    expect(r.ok).toBe(false);
    expect(r.issue).toBe('invalid-url');
  });
});
