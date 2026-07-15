import { z } from 'zod';

/**
 * App-level LLM behavior prefs (localStorage only).
 * Not domain/playground data — see store/prefs.ts.
 */

export const LlmSettings = z.object({
  /** Minimum wait after each LLM HTTP call completes before the next starts. */
  requestDelayMs: z.number().int().min(0).max(60_000).default(0),
});
export type LlmSettings = z.infer<typeof LlmSettings>;

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  requestDelayMs: 0,
};
