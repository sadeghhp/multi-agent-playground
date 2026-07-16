import { vi } from 'vitest';
import type { ConversationRun } from '../domain/schema';

/** In-memory run store for tests that assert on versioned run history. */
export const savedRuns = new Map<string, ConversationRun>();

export function clearPersistenceMocks(): void {
  savedRuns.clear();
  savePlayground.mockClear();
  loadPlayground.mockClear();
  loadAllPlaygrounds.mockClear();
  deletePlayground.mockClear();
  saveProvider.mockClear();
  loadAllProviders.mockClear();
  deleteProvider.mockClear();
  saveLibraryAgent.mockClear();
  loadAllLibraryAgents.mockClear();
  deleteLibraryAgent.mockClear();
  saveRunPreset.mockClear();
  loadAllRunPresets.mockClear();
  deleteRunPreset.mockClear();
  saveRun.mockClear();
  getRun.mockClear();
  listRuns.mockClear();
  deleteRun.mockClear();
  deleteRunsForPlayground.mockClear();
  saveUsageEntry.mockClear();
  loadAllUsageEntries.mockClear();
  clearUsageLedger.mockClear();
  deleteUsageSince.mockClear();
  saveModelPrice.mockClear();
  loadAllModelPrices.mockClear();
  deleteModelPrice.mockClear();
}

export const savePlayground = vi.fn().mockResolvedValue(undefined);
export const loadPlayground = vi.fn().mockResolvedValue(undefined);
export const loadAllPlaygrounds = vi.fn().mockResolvedValue([]);
export const deletePlayground = vi.fn().mockResolvedValue(undefined);
export const saveProvider = vi.fn().mockResolvedValue(undefined);
export const loadAllProviders = vi.fn().mockResolvedValue([]);
export const deleteProvider = vi.fn().mockResolvedValue(undefined);
export const saveLibraryAgent = vi.fn().mockResolvedValue(undefined);
export const loadAllLibraryAgents = vi.fn().mockResolvedValue([]);
export const deleteLibraryAgent = vi.fn().mockResolvedValue(undefined);
export const saveRunPreset = vi.fn().mockResolvedValue(undefined);
export const loadAllRunPresets = vi.fn().mockResolvedValue([]);
export const deleteRunPreset = vi.fn().mockResolvedValue(undefined);

export const saveRun = vi.fn().mockImplementation(async (run: ConversationRun) => {
  savedRuns.set(run.id, structuredClone(run));
});

export const getRun = vi.fn().mockImplementation(async (id: string) => savedRuns.get(id));

export const listRuns = vi.fn().mockImplementation(async (playgroundId: string) =>
  [...savedRuns.values()]
    .filter((r) => r.playgroundId === playgroundId)
    .sort((a, b) => a.version - b.version),
);

export const deleteRun = vi.fn().mockImplementation(async (id: string) => {
  savedRuns.delete(id);
});

export const deleteRunsForPlayground = vi.fn().mockImplementation(async (playgroundId: string) => {
  for (const [id, run] of savedRuns) {
    if (run.playgroundId === playgroundId) savedRuns.delete(id);
  }
});

// Usage ledger + model prices — no-op stubs so store/orchestrator paths that
// persist usage don't throw in tests that don't assert on them.
export const saveUsageEntry = vi.fn().mockResolvedValue(undefined);
export const loadAllUsageEntries = vi.fn().mockResolvedValue([]);
export const clearUsageLedger = vi.fn().mockResolvedValue(undefined);
export const deleteUsageSince = vi.fn().mockResolvedValue(undefined);
export const saveModelPrice = vi.fn().mockResolvedValue(undefined);
export const loadAllModelPrices = vi.fn().mockResolvedValue([]);
export const deleteModelPrice = vi.fn().mockResolvedValue(undefined);
export const setRecordDropListener = vi.fn();
