import type { AgentLanguage } from './schema';

/**
 * Writing direction per agent language. Persian (Farsi) is right-to-left;
 * English and French are left-to-right. Shared by every transcript renderer
 * (completed messages, live streaming, and the timeline) so an agent's output
 * reads in the correct direction everywhere it appears.
 */
export const LANGUAGE_DIR: Record<AgentLanguage, 'ltr' | 'rtl'> = {
  en: 'ltr',
  fa: 'rtl',
  fr: 'ltr',
};

export function dirForLanguage(language: AgentLanguage): 'ltr' | 'rtl' {
  return LANGUAGE_DIR[language];
}
