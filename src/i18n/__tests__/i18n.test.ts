import { describe, it, expect, afterEach } from 'vitest';
import i18n from '../index';

const PERSIAN_DIGIT = /[۰-۹]/;

// The i18n instance is shared across the test process; always return it to the
// default English so other suites (which assert on English UI text) are unaffected.
afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('i18n instance', () => {
  it('defaults to English and resolves catalog keys', () => {
    expect(i18n.language).toBe('en');
    expect(i18n.t('common.save')).toBe('Save');
    expect(i18n.t('settings.title')).toBe('Settings');
  });

  it('switches the whole catalog to Persian on changeLanguage', async () => {
    await i18n.changeLanguage('fa');
    expect(i18n.t('common.save')).toBe('ذخیره');
    expect(i18n.t('settings.title')).toBe('تنظیمات');
  });

  it('renders {{x, number}} interpolations with the active locale digits', async () => {
    expect(i18n.t('settings.delayMs', { ms: 500 })).toBe('500 ms');
    await i18n.changeLanguage('fa');
    expect(PERSIAN_DIGIT.test(i18n.t('settings.delayMs', { ms: 500 }))).toBe(true);
  });

  it('returns the key itself for an unknown lookup', () => {
    expect(i18n.t('common.__does_not_exist__')).toBe('common.__does_not_exist__');
  });
});
