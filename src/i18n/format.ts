/**
 * Locale-aware number/date formatting. Persian (`fa`) uses the native `fa-IR`
 * locale, which yields the Jalali calendar and Persian digits (۰۱۲۳) by default
 * — what Persian users expect. English uses `en-US` (Gregorian, Latin digits).
 *
 * These replace ad-hoc `.toLocaleString()` / `new Date().toLocaleString()`
 * calls, which format against the *host* locale rather than the app's chosen
 * language. Pass the current UI language (from `useUiStore(s => s.language)`) so
 * the value re-renders when the user switches languages.
 */
import type { Language } from '../store/prefs';

function intlLocale(lang: Language): string {
  return lang === 'fa' ? 'fa-IR' : 'en-US';
}

/** Integer/decimal number with locale digits and grouping (e.g. token counts). */
export function formatNumber(n: number, lang: Language): string {
  return new Intl.NumberFormat(intlLocale(lang)).format(n);
}

/** Date + time, medium/short (e.g. "Jul 16, 2026, 4:20 PM" / Jalali for fa). */
export function formatDateTime(ts: number | string | Date, lang: Language): string {
  return new Intl.DateTimeFormat(intlLocale(lang), {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(ts));
}

/** Time only, with seconds (e.g. log/message timestamps). */
export function formatTime(ts: number | string | Date, lang: Language): string {
  return new Intl.DateTimeFormat(intlLocale(lang), { timeStyle: 'medium' }).format(
    new Date(ts),
  );
}

/**
 * Compact elapsed duration: sub-second in ms, else seconds with one decimal.
 * `lang` defaults to `'en'` so callers not yet localized keep prior output.
 */
export function formatDuration(ms: number, lang: Language = 'en'): string {
  if (ms < 1000) return `${formatNumber(Math.round(ms), lang)}ms`;
  const secs = new Intl.NumberFormat(intlLocale(lang), {
    maximumFractionDigits: 1,
  }).format(ms / 1000);
  return `${secs}s`;
}
