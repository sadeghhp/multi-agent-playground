import { describe, it, expect, beforeEach } from 'vitest';
import { getLanguage, setLanguage, directionFor } from '../prefs';

describe('language preference', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('defaults to English when nothing is stored', () => {
    expect(getLanguage()).toBe('en');
  });

  it('round-trips the stored language', () => {
    setLanguage('fa');
    expect(getLanguage()).toBe('fa');
    setLanguage('en');
    expect(getLanguage()).toBe('en');
  });

  it('treats any unknown stored value as English', () => {
    window.localStorage.setItem('map.lang', 'de');
    expect(getLanguage()).toBe('en');
  });

  it('maps Persian to RTL and English to LTR', () => {
    expect(directionFor('fa')).toBe('rtl');
    expect(directionFor('en')).toBe('ltr');
  });
});
