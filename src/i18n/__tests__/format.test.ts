import { describe, it, expect } from 'vitest';
import { formatNumber, formatDuration, formatDateTime, formatTime } from '../format';

/** Persian (Extended Arabic-Indic) digits ۰-۹. */
const PERSIAN_DIGIT = /[۰-۹]/;

describe('i18n format helpers', () => {
  it('formats numbers with Latin digits + grouping in English', () => {
    expect(formatNumber(1234, 'en')).toBe('1,234');
  });

  it('formats numbers with Persian digits in Persian', () => {
    const out = formatNumber(1234, 'fa');
    expect(PERSIAN_DIGIT.test(out)).toBe(true);
    // Must NOT contain Latin digits.
    expect(/[0-9]/.test(out)).toBe(false);
  });

  it('formats sub-second durations in ms and seconds with one decimal', () => {
    expect(formatDuration(500, 'en')).toBe('500ms');
    expect(formatDuration(1500, 'en')).toBe('1.5s');
  });

  it('localizes duration digits in Persian', () => {
    expect(PERSIAN_DIGIT.test(formatDuration(1500, 'fa'))).toBe(true);
  });

  it('defaults duration language to English when omitted', () => {
    expect(formatDuration(250)).toBe('250ms');
  });

  it('produces non-empty, locale-appropriate date/time strings', () => {
    const ts = Date.UTC(2026, 6, 16, 12, 0, 0);
    expect(formatDateTime(ts, 'en').length).toBeGreaterThan(0);
    expect(PERSIAN_DIGIT.test(formatDateTime(ts, 'fa'))).toBe(true);
    expect(PERSIAN_DIGIT.test(formatTime(ts, 'fa'))).toBe(true);
  });
});
