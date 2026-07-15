/**
 * Small UI preferences persisted to localStorage only (spec §15.1): selected
 * playground id, theme, token budget caps. NOT domain data — that lives in IndexedDB.
 */

import {
  DEFAULT_USAGE_BUDGET,
  UsageBudgetSettings as UsageBudgetSettingsSchema,
  type UsageBudgetSettings,
} from '../domain/usage';

const SELECTED_KEY = 'map.selectedPlaygroundId';
const THEME_KEY = 'map.theme';
const BUDGET_KEY = 'map.usageBudget';

export type Theme = 'light' | 'dark';
export type { UsageBudgetSettings };

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

export function getUsageBudget(): UsageBudgetSettings {
  try {
    const raw = window.localStorage.getItem(BUDGET_KEY);
    if (!raw) return { ...DEFAULT_USAGE_BUDGET };
    const parsed = UsageBudgetSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { ...DEFAULT_USAGE_BUDGET };
  } catch {
    return { ...DEFAULT_USAGE_BUDGET };
  }
}

export function setUsageBudget(budget: UsageBudgetSettings): void {
  try {
    const parsed = UsageBudgetSettingsSchema.parse(budget);
    window.localStorage.setItem(BUDGET_KEY, JSON.stringify(parsed));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}
