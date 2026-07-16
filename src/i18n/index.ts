/**
 * i18n bootstrap (English + Persian). Two static, bundled locales — no HTTP
 * backend, no language detector (we read our own persisted pref via prefs.ts).
 *
 * Translation catalogs live in `locales/<lng>/<area>.json`. Each file holds one
 * UI area's chrome strings and is merged into a single `translation` namespace
 * under its filename, so a component calls `t('<area>.<key>')` (e.g.
 * `t('toolbar.run')`). Files are auto-discovered with import.meta.glob, so
 * adding an area is just dropping in two JSON files — no edit here.
 *
 * ONLY chrome (buttons, labels, titles, toasts, dialogs) is translated. User/
 * model content (agent names, prompts, model ids, transcript bodies, code) is
 * never translated — it is bidi-isolated at render time instead.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLanguage } from '../store/prefs';

type Catalog = Record<string, unknown>;

const enFiles = import.meta.glob('./locales/en/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, Catalog>;
const faFiles = import.meta.glob('./locales/fa/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, Catalog>;

/** Key each area file's contents under its filename (e.g. `toolbar`). */
function byArea(files: Record<string, Catalog>): Catalog {
  const out: Catalog = {};
  for (const [path, contents] of Object.entries(files)) {
    const area = path.slice(path.lastIndexOf('/') + 1).replace(/\.json$/, '');
    out[area] = contents;
  }
  return out;
}

void i18n.use(initReactI18next).init({
  lng: getLanguage(),
  fallbackLng: 'en',
  resources: {
    en: { translation: byArea(enFiles) },
    fa: { translation: byArea(faFiles) },
  },
  interpolation: {
    // React already escapes interpolated values; double-escaping mangles them.
    escapeValue: false,
    // `{{count, number}}` renders with the active locale's digits/grouping —
    // e.g. Persian digits (۱٬۲۳۴) under `fa`. Keeps numbers in translated
    // sentences consistent with the standalone helpers in format.ts.
    format: (value, format, lng) => {
      if (format === 'number' && typeof value === 'number') {
        return new Intl.NumberFormat(lng === 'fa' ? 'fa-IR' : 'en-US').format(value);
      }
      return String(value);
    },
  },
  returnNull: false,
});

export default i18n;
