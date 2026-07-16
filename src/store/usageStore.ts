import { create } from 'zustand';
import { newPriceId, newUsageId } from '../domain/ids';
import type { ModelPrice, UsageBudgetSettings, UsageEntry } from '../domain/usage';
import {
  clearUsageLedger,
  deleteUsageSince,
  loadAllModelPrices,
  loadAllUsageEntries,
  saveModelPrice,
  saveUsageEntry,
  deleteModelPrice as dbDeletePrice,
} from '../persistence/db';
import { getUsageBudget, setUsageBudget } from './prefs';
import { useUiStore } from './uiStore';
import { estimateCostUsd } from '../usage/pricing';
import { startOfLocalDay, sumTokensSince } from '../usage/budget';

/**
 * Running cache of today's token total, so `dayTokens()` (called on every
 * budget check) doesn't re-scan the whole unbounded ledger each time. Recomputed
 * lazily when the local day rolls over, incremented on each new same-day entry,
 * and invalidated on any bulk change (hydrate/clear).
 */
let dayTotalCache: { day: number; total: number } | null = null;
function invalidateDayTotal(): void {
  dayTotalCache = null;
}

interface UsageState {
  entries: UsageEntry[];
  prices: ModelPrice[];
  budget: UsageBudgetSettings;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setBudget: (budget: UsageBudgetSettings) => void;
  recordUsage: (input: {
    playgroundId: string | null;
    runId: string | null;
    providerId: string;
    providerName: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimated: boolean;
    fallback: boolean;
  }) => Promise<UsageEntry>;
  upsertPrice: (input: {
    id?: string;
    providerId: string;
    model: string;
    inputPer1M: number;
    outputPer1M: number;
  }) => void;
  removePrice: (id: string) => void;
  findPrice: (providerId: string, model: string) => ModelPrice | undefined;
  clearAll: () => Promise<void>;
  clearToday: () => Promise<void>;
  dayTokens: () => number;
}

export const useUsageStore = create<UsageState>((set, get) => ({
  entries: [],
  prices: [],
  budget: getUsageBudget(),
  hydrated: false,

  async hydrate() {
    try {
      const [entries, prices] = await Promise.all([loadAllUsageEntries(), loadAllModelPrices()]);
      invalidateDayTotal();
      set({ entries, prices, budget: getUsageBudget(), hydrated: true });
    } catch (err) {
      console.error('Usage hydrate failed', err);
      invalidateDayTotal();
      set({ entries: [], prices: [], budget: getUsageBudget(), hydrated: true });
    }
  },

  setBudget(budget) {
    setUsageBudget(budget);
    set({ budget });
  },

  async recordUsage(input) {
    const price = get().findPrice(input.providerId, input.model);
    const promptTokens = Math.max(0, Math.round(input.promptTokens));
    const completionTokens = Math.max(0, Math.round(input.completionTokens));
    const totalTokens =
      input.totalTokens > 0
        ? Math.round(input.totalTokens)
        : promptTokens + completionTokens;
    const entry: UsageEntry = {
      id: newUsageId(),
      at: Date.now(),
      playgroundId: input.playgroundId,
      runId: input.runId,
      providerId: input.providerId,
      providerName: input.providerName,
      model: input.model,
      promptTokens,
      completionTokens,
      totalTokens,
      estimatedCost: estimateCostUsd(price, promptTokens, completionTokens),
      estimated: input.estimated,
      fallback: input.fallback,
    };
    set((s) => ({ entries: [...s.entries, entry] }));
    // Keep the day-total cache in step with the new entry instead of forcing a
    // full re-scan on the next dayTokens() call.
    if (dayTotalCache && dayTotalCache.day === startOfLocalDay() && entry.at >= dayTotalCache.day) {
      dayTotalCache.total += entry.totalTokens;
    } else {
      invalidateDayTotal();
    }
    try {
      await saveUsageEntry(entry);
    } catch (err) {
      console.error('Usage save failed', err);
      // Surface it: the in-memory ledger now counts this entry but a reload would
      // lose it, so day-budget accounting silently under-counts post-reload.
      useUiStore
        .getState()
        .showToast('warn', 'Usage accounting could not be saved; it may reset on reload.');
    }
    return entry;
  },

  upsertPrice(input) {
    const existing = get().prices.find(
      (p) => p.providerId === input.providerId && p.model === input.model,
    );
    const price: ModelPrice = {
      id: input.id ?? existing?.id ?? newPriceId(),
      providerId: input.providerId,
      model: input.model,
      inputPer1M: input.inputPer1M,
      outputPer1M: input.outputPer1M,
    };
    set((s) => ({
      prices: [...s.prices.filter((p) => p.id !== price.id), price],
    }));
    void saveModelPrice(price).catch((err) => console.error('Price save failed', err));
  },

  removePrice(id) {
    set((s) => ({ prices: s.prices.filter((p) => p.id !== id) }));
    void dbDeletePrice(id).catch((err) => console.error('Price delete failed', err));
  },

  findPrice(providerId, model) {
    const exact = get().prices.find((p) => p.providerId === providerId && p.model === model);
    if (exact) return exact;
    // Fall back to any price row matching the model id (useful across OpenRouter copies).
    return get().prices.find((p) => p.model === model);
  },

  async clearAll() {
    invalidateDayTotal();
    set({ entries: [] });
    await clearUsageLedger();
  },

  async clearToday() {
    const since = startOfLocalDay();
    invalidateDayTotal();
    set((s) => ({ entries: s.entries.filter((e) => e.at < since) }));
    await deleteUsageSince(since);
  },

  dayTokens() {
    const day = startOfLocalDay();
    if (!dayTotalCache || dayTotalCache.day !== day) {
      dayTotalCache = { day, total: sumTokensSince(get().entries, day) };
    }
    return dayTotalCache.total;
  },
}));
