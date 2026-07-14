import { create } from 'zustand';
import { type Agent, type SavedAgent } from '../domain/schema';
import { createSavedAgent } from '../domain/factories';
import {
  deleteLibraryAgent,
  loadAllLibraryAgents,
  saveLibraryAgent,
} from '../persistence/db';

/**
 * The agent library ("pool"): a cross-playground collection of saved agents.
 * Kept separate from domainStore because it is not scoped to a single
 * playground — a saved agent can be re-added to any playground or disposed of.
 * Persists to its own IndexedDB store (see persistence/db.ts).
 */

interface AgentLibraryState {
  library: SavedAgent[];
  hydrate: () => Promise<void>;
  /** Snapshot an agent into the library and persist it. Returns the record. */
  saveAgent: (agent: Agent) => Promise<SavedAgent>;
  /** Dispose of a saved agent (remove from the pool). */
  disposeAgent: (id: string) => Promise<void>;
}

export const useAgentLibraryStore = create<AgentLibraryState>((set, get) => ({
  library: [],

  async hydrate() {
    const all = await loadAllLibraryAgents();
    all.sort((a, b) => b.savedAt - a.savedAt);
    set({ library: all });
  },

  async saveAgent(agent) {
    const saved = createSavedAgent(agent);
    await saveLibraryAgent(saved);
    // Newest first, matching hydrate's ordering.
    set({ library: [saved, ...get().library] });
    return saved;
  },

  async disposeAgent(id) {
    await deleteLibraryAgent(id);
    set({ library: get().library.filter((s) => s.id !== id) });
  },
}));
