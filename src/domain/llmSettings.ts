import { z } from 'zod';

/**
 * App-level LLM behavior prefs (localStorage only).
 * Not domain/playground data — see store/prefs.ts.
 */

export const LlmSettings = z.object({
  /** Minimum wait after each LLM HTTP call completes before the next starts. */
  requestDelayMs: z.number().int().min(0).max(60_000).default(0),
  /**
   * Default provider for on-demand timeline insights (summary/review). Empty
   * means "borrow from an agent" — the legacy behavior where the insight call
   * reuses a suitable agent's provider/model. Setting this lets the user route
   * insights to a provider they know allows browser-origin (CORS) requests,
   * even when the run's own agents use CORS-blocked gateways.
   */
  insightProviderId: z.string().default(''),
  /** Model id used with `insightProviderId`. Ignored when the provider is empty. */
  insightModel: z.string().default(''),
});
export type LlmSettings = z.infer<typeof LlmSettings>;

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  requestDelayMs: 0,
  insightProviderId: '',
  insightModel: '',
};
