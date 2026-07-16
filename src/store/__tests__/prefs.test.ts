import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getLlmSettings,
  getSelectedPlaygroundId,
  getTheme,
  setLlmSettings,
  setSelectedPlaygroundId,
  setTheme,
} from '../prefs';

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

  it('persists LLM settings, defaulting to zero request delay', () => {
    expect(getLlmSettings()).toEqual({ requestDelayMs: 0, insightProviderId: '', insightModel: '' });
    setLlmSettings({ requestDelayMs: 1500, insightProviderId: '', insightModel: '' });
    expect(getLlmSettings()).toEqual({ requestDelayMs: 1500, insightProviderId: '', insightModel: '' });
  });

  it('falls back to defaults for invalid LLM settings JSON', () => {
    window.localStorage.setItem('map.llmSettings', '{not-json');
    expect(getLlmSettings()).toEqual({ requestDelayMs: 0, insightProviderId: '', insightModel: '' });
    window.localStorage.setItem('map.llmSettings', JSON.stringify({ requestDelayMs: -5 }));
    expect(getLlmSettings()).toEqual({ requestDelayMs: 0, insightProviderId: '', insightModel: '' });
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

  it('getLlmSettings/setLlmSettings do not throw', () => {
    makeStorageThrow('getItem');
    expect(() => getLlmSettings()).not.toThrow();
    expect(getLlmSettings()).toEqual({ requestDelayMs: 0, insightProviderId: '', insightModel: '' });

    vi.restoreAllMocks();
    makeStorageThrow('setItem');
    expect(() =>
      setLlmSettings({ requestDelayMs: 500, insightProviderId: '', insightModel: '' }),
    ).not.toThrow();
  });
});
