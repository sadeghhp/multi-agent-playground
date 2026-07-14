import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSelectedPlaygroundId, getTheme, setSelectedPlaygroundId, setTheme } from '../prefs';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('prefs round-trip', () => {
  it('persists the selected playground id', () => {
    setSelectedPlaygroundId('pg_1');
    expect(getSelectedPlaygroundId()).toBe('pg_1');
    setSelectedPlaygroundId(null);
    expect(getSelectedPlaygroundId()).toBeNull();
  });

  it('persists the theme, defaulting to light', () => {
    expect(getTheme()).toBe('light');
    setTheme('dark');
    expect(getTheme()).toBe('dark');
  });
});

describe('localStorage failure resilience (L-11 regression)', () => {
  // jsdom's Storage methods live on the shared prototype — spying on the
  // `window.localStorage` instance directly does not intercept real calls to
  // it, so the mock must patch the prototype (verified against this repo's
  // jsdom version; see the analogous note in credentialStore.test.ts).
  function makeStorageThrow(method: 'getItem' | 'setItem' | 'removeItem') {
    const proto = Object.getPrototypeOf(window.localStorage);
    vi.spyOn(proto, method).mockImplementation(() => {
      throw new Error(`${method} disabled`);
    });
  }

  it('getSelectedPlaygroundId/setSelectedPlaygroundId do not throw', () => {
    makeStorageThrow('getItem');
    expect(() => getSelectedPlaygroundId()).not.toThrow();
    expect(getSelectedPlaygroundId()).toBeNull();

    vi.restoreAllMocks();
    makeStorageThrow('setItem');
    expect(() => setSelectedPlaygroundId('pg_1')).not.toThrow();

    vi.restoreAllMocks();
    makeStorageThrow('removeItem');
    expect(() => setSelectedPlaygroundId(null)).not.toThrow();
  });

  it('getTheme/setTheme do not throw, defaulting to light', () => {
    makeStorageThrow('getItem');
    expect(() => getTheme()).not.toThrow();
    expect(getTheme()).toBe('light');

    vi.restoreAllMocks();
    makeStorageThrow('setItem');
    expect(() => setTheme('dark')).not.toThrow();
  });
});
