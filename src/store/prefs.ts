/**
 * Small UI preferences persisted to localStorage only (spec §15.1): selected
 * playground id, theme. NOT domain data — that lives in IndexedDB.
 */

const SELECTED_KEY = 'map.selectedPlaygroundId';
const THEME_KEY = 'map.theme';

export type Theme = 'light' | 'dark';

export function getSelectedPlaygroundId(): string | null {
  try {
    return window.localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}
export function setSelectedPlaygroundId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(SELECTED_KEY, id);
    else window.localStorage.removeItem(SELECTED_KEY);
  } catch {
    /* storage full / disabled (e.g. private-browsing quota) — non-fatal */
  }
}

export function getTheme(): Theme {
  try {
    return window.localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
export function setTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage full / disabled (e.g. private-browsing quota) — non-fatal */
  }
}
