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
import { estimateCostUsd } from '../usage/pricing';
import { startOfLocalDay, sumTokensSince } from '../usage/budget';

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
      set({ entries, prices, budget: getUsageBudget(), hydrated: true });
    } catch (err) {
      console.error('Usage hydrate failed', err);
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
    try {
      await saveUsageEntry(entry);
    } catch (err) {
      console.error('Usage save failed', err);
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
    set({ entries: [] });
    await clearUsageLedger();
  },

  async clearToday() {
    const since = startOfLocalDay();
    set((s) => ({ entries: s.entries.filter((e) => e.at < since) }));
    await deleteUsageSince(since);
  },

  dayTokens() {
    return sumTokensSince(get().entries, startOfLocalDay());
  },
}));
