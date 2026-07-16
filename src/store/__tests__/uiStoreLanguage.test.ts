import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { useUiStore } from '../uiStore';
import i18n from '../../i18n';
import { getLanguage } from '../prefs';

afterEach(async () => {
  await i18n.changeLanguage('en');
  useUiStore.getState().setLanguage('en');
  window.localStorage.clear();
});

describe('uiStore language', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('setLanguage updates the store, persists the pref, and swaps the i18n catalog', () => {
    useUiStore.getState().setLanguage('fa');
    expect(useUiStore.getState().language).toBe('fa');
    expect(getLanguage()).toBe('fa');
    expect(i18n.language).toBe('fa');
  });

  it('is a no-op when the language is unchanged', () => {
    useUiStore.getState().setLanguage('en');
    expect(useUiStore.getState().language).toBe('en');
    expect(i18n.language).toBe('en');
  });
});
