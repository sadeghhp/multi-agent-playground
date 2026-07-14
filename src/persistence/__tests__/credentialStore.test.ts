import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCredential, loadCredential, saveCredential } from '../credentialStore';

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

/**
 * jsdom's sessionStorage and localStorage share one `Storage` prototype, so
 * `vi.spyOn` must patch that shared prototype (spying on an instance directly
 * doesn't intercept jsdom's storage calls at all). To make only ONE of the two
 * stores fail, the mock inspects `this` — bound to whichever instance the
 * method was actually called on — and only throws for that one.
 */
function makeOneStoreThrow(
  method: 'setItem' | 'getItem' | 'removeItem',
  failingStore: Storage,
) {
  const proto = Object.getPrototypeOf(window.sessionStorage);
  const original = proto[method];
  vi.spyOn(proto, method).mockImplementation(function (this: Storage, ...args: unknown[]) {
    if (this === failingStore) throw new Error(`${method} disabled`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (original as any).apply(this, args);
  });
}

describe('credentialStore round-trip', () => {
  it('saves and loads a session credential', () => {
    saveCredential('p1', 'secret', 'session');
    expect(loadCredential('p1')).toBe('secret');
  });

  it('clears a credential from both stores', () => {
    saveCredential('p1', 'secret', 'local');
    clearCredential('p1');
    expect(loadCredential('p1')).toBeUndefined();
  });
});

describe('Storage failure resilience (L-4/L-6 regression)', () => {
  it('saveCredential does not throw when setItem throws, and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    makeOneStoreThrow('setItem', window.sessionStorage);

    expect(() => saveCredential('p1', 'secret', 'session')).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('loadCredential does not throw when getItem throws, and returns undefined', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    makeOneStoreThrow('getItem', window.sessionStorage);

    expect(() => loadCredential('p1')).not.toThrow();
    expect(loadCredential('p1')).toBeUndefined();
  });

  it('clearCredential clears the other store even when one throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    saveCredential('p1', 'secret', 'local');
    // sessionStorage.removeItem fails; localStorage.removeItem must still run.
    makeOneStoreThrow('removeItem', window.sessionStorage);

    expect(() => clearCredential('p1')).not.toThrow();
    expect(window.localStorage.getItem('map.cred.p1')).toBeNull();
  });
});
