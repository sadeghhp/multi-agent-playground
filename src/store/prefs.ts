/**
 * Small UI preferences persisted to localStorage only (spec §15.1): selected
 * playground id, theme. NOT domain data — that lives in IndexedDB.
 */

const SELECTED_KEY = 'map.selectedPlaygroundId';
const THEME_KEY = 'map.theme';

export type Theme = 'light' | 'dark';

export function getSelectedPlaygroundId(): string | null {
  return window.localStorage.getItem(SELECTED_KEY);
}
export function setSelectedPlaygroundId(id: string | null): void {
  if (id) window.localStorage.setItem(SELECTED_KEY, id);
  else window.localStorage.removeItem(SELECTED_KEY);
}

export function getTheme(): Theme {
  return window.localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}
export function setTheme(theme: Theme): void {
  window.localStorage.setItem(THEME_KEY, theme);
}
