import { create } from 'zustand';
import { type ConversationRun } from '../domain/schema';
import { deleteRun, listRuns, saveRun } from '../persistence/db';

/**
 * Versioned conversation run history for the active playground. Persists to
 * IndexedDB via persistence/db.ts; this store is an in-memory cache for the UI.
 */

interface RunHistoryState {
  playgroundId: string | null;
  runs: ConversationRun[];
  hydrate: (playgroundId: string) => Promise<void>;
  clear: () => void;
  onRunCreated: (run: ConversationRun) => void;
  onRunUpdated: (run: ConversationRun) => void;
  removeRun: (id: string) => Promise<void>;
}

export const useRunHistoryStore = create<RunHistoryState>((set, get) => ({
  playgroundId: null,
  runs: [],

  async hydrate(playgroundId) {
    try {
      const runs = await listRuns(playgroundId);
      set({ playgroundId, runs });
    } catch (err) {
      console.error('Run history hydrate failed', err);
      set({ playgroundId, runs: [] });
    }
  },

  clear() {
    set({ playgroundId: null, runs: [] });
  },

  onRunCreated(run) {
    const { playgroundId, runs } = get();
    if (playgroundId !== run.playgroundId) return;
    set({ runs: [...runs, run].sort((a, b) => a.version - b.version) });
  },

  onRunUpdated(run) {
    const { playgroundId, runs } = get();
    if (playgroundId !== run.playgroundId) return;
    set({
      runs: runs.map((r) => (r.id === run.id ? run : r)).sort((a, b) => a.version - b.version),
    });
  },

  async removeRun(id) {
    const run = get().runs.find((r) => r.id === id);
    if (!run || run.status === 'running') return;
    await deleteRun(id);
    set({ runs: get().runs.filter((r) => r.id !== id) });
  },
}));

/** Compute the next version number and parent run id for a new execution. */
export async function nextRunMeta(
  playgroundId: string,
): Promise<{ version: number; parentRunId: string | null }> {
  const runs = await listRuns(playgroundId);
  if (runs.length === 0) return { version: 1, parentRunId: null };
  const last = runs[runs.length - 1]!;
  return { version: last.version + 1, parentRunId: last.id };
}

export async function persistRunDraft(run: ConversationRun): Promise<void> {
  await saveRun(run);
  useRunHistoryStore.getState().onRunCreated(run);
}

export async function persistRunFinal(run: ConversationRun): Promise<void> {
  await saveRun(run);
  useRunHistoryStore.getState().onRunUpdated(run);
}
