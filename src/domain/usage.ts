import { z } from 'zod';

/**
 * LLM usage ledger + editable model prices (local accounting only).
 * Persisted in IndexedDB; never includes API keys.
 */

export const UsageEntry = z.object({
  id: z.string(),
  at: z.number().int(),
  playgroundId: z.string().nullable().default(null),
  runId: z.string().nullable().default(null),
  providerId: z.string(),
  providerName: z.string().default(''),
  model: z.string().default(''),
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  totalTokens: z.number().int().nonnegative().default(0),
  /** USD estimate from the price table at record time; 0 when unknown. */
  estimatedCost: z.number().nonnegative().default(0),
  /** True when token counts were estimated (e.g. stream without usage). */
  estimated: z.boolean().default(false),
  /** True when this call used a run-scoped fallback override. */
  fallback: z.boolean().default(false),
});
export type UsageEntry = z.infer<typeof UsageEntry>;

export const ModelPrice = z.object({
  id: z.string(),
  providerId: z.string(),
  model: z.string(),
  /** USD per 1M input (prompt) tokens. */
  inputPer1M: z.number().nonnegative().default(0),
  /** USD per 1M output (completion) tokens. */
  outputPer1M: z.number().nonnegative().default(0),
});
export type ModelPrice = z.infer<typeof ModelPrice>;

export const UsageBudgetSettings = z.object({
  maxTokensPerRun: z.number().int().positive().default(50_000),
  maxTokensPerDay: z.number().int().positive().default(200_000),
  maxFallbackTokensPerRun: z.number().int().positive().default(20_000),
});
export type UsageBudgetSettings = z.infer<typeof UsageBudgetSettings>;

export const DEFAULT_USAGE_BUDGET: UsageBudgetSettings = {
  maxTokensPerRun: 50_000,
  maxTokensPerDay: 200_000,
  maxFallbackTokensPerRun: 20_000,
};
