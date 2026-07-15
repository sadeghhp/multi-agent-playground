import type { UsageBudgetSettings, UsageEntry } from '../domain/usage';

export class BudgetExceededError extends Error {
  readonly code = 'budget-exceeded' as const;

  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export interface BudgetSnapshot {
  runTokens: number;
  runFallbackTokens: number;
  dayTokens: number;
  remainingRun: number;
  remainingDay: number;
  remainingFallback: number;
}

export function startOfLocalDay(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function sumTokensSince(entries: UsageEntry[], sinceMs: number): number {
  let total = 0;
  for (const e of entries) {
    if (e.at >= sinceMs) total += e.totalTokens;
  }
  return total;
}

export function buildBudgetSnapshot(
  settings: UsageBudgetSettings,
  opts: { runTokens: number; runFallbackTokens: number; dayTokens: number },
): BudgetSnapshot {
  return {
    runTokens: opts.runTokens,
    runFallbackTokens: opts.runFallbackTokens,
    dayTokens: opts.dayTokens,
    remainingRun: Math.max(0, settings.maxTokensPerRun - opts.runTokens),
    remainingDay: Math.max(0, settings.maxTokensPerDay - opts.dayTokens),
    remainingFallback: Math.max(0, settings.maxFallbackTokensPerRun - opts.runFallbackTokens),
  };
}

/**
 * Throws BudgetExceededError when the next call's estimated tokens would
 * exceed any configured cap. Uses a conservative estimate so we stop early
 * rather than overshoot silently.
 */
export function assertWithinBudget(
  settings: UsageBudgetSettings,
  snap: BudgetSnapshot,
  opts: { estimatedTokens: number; isFallback: boolean },
): void {
  const need = Math.max(0, opts.estimatedTokens);
  if (snap.runTokens + need > settings.maxTokensPerRun) {
    throw new BudgetExceededError(
      `Token budget for this run exceeded (used ${snap.runTokens.toLocaleString()} / ${settings.maxTokensPerRun.toLocaleString()}).`,
    );
  }
  if (snap.dayTokens + need > settings.maxTokensPerDay) {
    throw new BudgetExceededError(
      `Daily token budget exceeded (used ${snap.dayTokens.toLocaleString()} / ${settings.maxTokensPerDay.toLocaleString()}).`,
    );
  }
  if (opts.isFallback && snap.runFallbackTokens + need > settings.maxFallbackTokensPerRun) {
    throw new BudgetExceededError(
      `Fallback token budget for this run exceeded (used ${snap.runFallbackTokens.toLocaleString()} / ${settings.maxFallbackTokensPerRun.toLocaleString()}).`,
    );
  }
}
