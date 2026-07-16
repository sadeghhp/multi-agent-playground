/**
 * Small UI preferences persisted to localStorage only (spec §15.1): selected
 * playground id, theme, token budget caps, LLM settings. NOT domain data —
 * that lives in IndexedDB.
 */

import {
  DEFAULT_USAGE_BUDGET,
  UsageBudgetSettings as UsageBudgetSettingsSchema,
  type UsageBudgetSettings,
} from '../domain/usage';
import {
  DEFAULT_LLM_SETTINGS,
  LlmSettings as LlmSettingsSchema,
  type LlmSettings,
} from '../domain/llmSettings';

const SELECTED_KEY = 'map.selectedPlaygroundId';
const THEME_KEY = 'map.theme';
const LANG_KEY = 'map.lang';
const BUDGET_KEY = 'map.usageBudget';
const LLM_SETTINGS_KEY = 'map.llmSettings';

export type Theme = 'light' | 'dark';
/** UI language. 'fa' (Persian) is right-to-left; 'en' (English) is left-to-right. */
export type Language = 'en' | 'fa';
export type { UsageBudgetSettings };
export type { LlmSettings };

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

export function getLanguage(): Language {
  try {
    return window.localStorage.getItem(LANG_KEY) === 'fa' ? 'fa' : 'en';
  } catch {
    return 'en';
  }
}
export function setLanguage(lang: Language): void {
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* storage full / disabled (e.g. private-browsing quota) — non-fatal */
  }
}

/** The writing direction for a language. Used to set `dir` on <html>. */
export function directionFor(lang: Language): 'rtl' | 'ltr' {
  return lang === 'fa' ? 'rtl' : 'ltr';
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

export function getLlmSettings(): LlmSettings {
  try {
    const raw = window.localStorage.getItem(LLM_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_LLM_SETTINGS };
    const parsed = LlmSettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : { ...DEFAULT_LLM_SETTINGS };
  } catch {
    return { ...DEFAULT_LLM_SETTINGS };
  }
}

export function setLlmSettings(settings: LlmSettings): void {
  try {
    const parsed = LlmSettingsSchema.parse(settings);
    window.localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify(parsed));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}
