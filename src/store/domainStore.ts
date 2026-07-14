import { create } from 'zustand';
import {
  type Agent,
  type Connection,
  type ConversationSettings,
  type Playground,
  type Provider,
  type TranscriptMessage,
  type UiLayoutState,
} from '../domain/schema';
import { createPlayground, duplicateAgent } from '../domain/factories';
import { deletePlayground as dbDelete, loadAllPlaygrounds, savePlayground } from '../persistence/db';
import { regenerateIds } from '../persistence/serialization';
import { setSelectedPlaygroundId } from './prefs';

/**
 * Persistent domain state (spec §16). Holds the active playground and every
 * mutation. Autosaves to IndexedDB with a short debounce (spec §15.2).
 */

export type SaveStatus = 'saved' | 'saving' | 'unsaved' | 'failed';

interface DomainState {
  playground: Playground | null;
  /** Lightweight index for the "saved playgrounds" list (id + name + updatedAt). */
  index: { id: string; name: string; updatedAt: number }[];
  saveStatus: SaveStatus;

  // lifecycle
  hydrate: () => Promise<void>;
  newPlayground: (name?: string) => void;
  loadPlayground: (id: string) => Promise<void>;
  renamePlayground: (name: string) => void;
  duplicatePlayground: () => void;
  deletePlayground: (id: string) => Promise<void>;
  replacePlayground: (pg: Playground) => void;

  // agents
  addAgent: (agent: Agent) => void;
  updateAgent: (id: string, patch: Partial<Agent>) => void;
  duplicateAgentById: (id: string) => Agent | undefined;
  removeAgent: (id: string) => void;
  setAgentPosition: (id: string, x: number, y: number) => void;

  // connections
  addConnection: (conn: Connection) => void;
  updateConnection: (id: string, patch: Partial<Connection>) => void;
  removeConnection: (id: string) => void;

  // providers
  addProvider: (provider: Provider) => void;
  updateProvider: (id: string, patch: Partial<Provider>) => void;
  removeProvider: (id: string) => void;

  // conversation + transcript + ui layout
  updateConversation: (patch: Partial<ConversationSettings>) => void;
  appendTranscript: (msg: TranscriptMessage) => void;
  clearTranscript: () => void;
  updateUiLayout: (patch: Partial<UiLayoutState>) => void;

  /** Force an immediate save (used before export / on demand). */
  flushSave: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 600;

export const useDomainStore = create<DomainState>((set, get) => {
  /** Apply a mutation to the active playground, bump updatedAt, and schedule save. */
  function mutate(fn: (pg: Playground) => Playground) {
    const current = get().playground;
    if (!current) return;
    const next = fn({ ...current, updatedAt: Date.now() });
    set({ playground: next, saveStatus: 'unsaved' });
    scheduleSave();
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void doSave(), SAVE_DEBOUNCE_MS);
  }

  /**
   * Persist any pending debounced edits to the CURRENT playground before it is
   * replaced. Without this, switching playgrounds inside the ~600ms debounce
   * window silently discards the outgoing playground's edits (they live only in
   * memory until doSave runs). Kept synchronous so callers can swap `playground`
   * immediately after; the IndexedDB write is captured against the outgoing
   * playground and fired off (not awaited) so it still lands.
   */
  function flushPending() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    const pg = get().playground;
    if (pg && get().saveStatus !== 'saved') {
      void savePlayground(pg).catch((err) => console.error('Flush save failed', err));
    }
  }

  async function doSave() {
    const pg = get().playground;
    if (!pg) return;
    set({ saveStatus: 'saving' });
    try {
      await savePlayground(pg);
      // Refresh the index entry.
      const index = get().index.filter((i) => i.id !== pg.id);
      index.unshift({ id: pg.id, name: pg.name, updatedAt: pg.updatedAt });
      set({ saveStatus: 'saved', index });
    } catch (err) {
      console.error('Autosave failed', err);
      set({ saveStatus: 'failed' });
    }
  }

  function activate(pg: Playground) {
    set({ playground: pg, saveStatus: 'unsaved' });
    setSelectedPlaygroundId(pg.id);
    scheduleSave();
  }

  return {
    playground: null,
    index: [],
    saveStatus: 'saved',

    async hydrate() {
      const all = await loadAllPlaygrounds();
      const index = all
        .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      set({ index });
    },

    newPlayground(name) {
      flushPending();
      activate(createPlayground(name));
    },

    async loadPlayground(id) {
      flushPending();
      const all = await loadAllPlaygrounds();
      const pg = all.find((p) => p.id === id);
      if (pg) {
        set({ playground: pg, saveStatus: 'saved' });
        setSelectedPlaygroundId(pg.id);
      }
    },

    renamePlayground(name) {
      mutate((pg) => ({ ...pg, name }));
    },

    duplicatePlayground() {
      const pg = get().playground;
      if (!pg) return;
      flushPending();
      // Regenerate every id (playground/agents/providers/connections) and remap
      // references. Sharing provider ids across playgrounds would let deleting one
      // clear the other's credentials (they're keyed globally by provider id).
      const copy = regenerateIds(pg);
      activate({ ...copy, name: `${pg.name} (copy)` });
    },

    async deletePlayground(id) {
      await dbDelete(id);
      const index = get().index.filter((i) => i.id !== id);
      set({ index });
      if (get().playground?.id === id) {
        set({ playground: null });
        setSelectedPlaygroundId(null);
      }
    },

    replacePlayground(pg) {
      flushPending();
      activate(pg);
    },

    addAgent(agent) {
      mutate((pg) => ({ ...pg, agents: [...pg.agents, agent] }));
    },

    updateAgent(id, patch) {
      mutate((pg) => ({
        ...pg,
        agents: pg.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      }));
    },

    duplicateAgentById(id) {
      const pg = get().playground;
      const original = pg?.agents.find((a) => a.id === id);
      if (!original) return undefined;
      const copy = duplicateAgent(original);
      mutate((p) => ({ ...p, agents: [...p.agents, copy] }));
      return copy;
    },

    removeAgent(id) {
      // Deleting an agent removes its connections too (spec §9.4). Transcript
      // history is preserved; messages are tagged as belonging to a deleted agent.
      mutate((pg) => ({
        ...pg,
        agents: pg.agents.filter((a) => a.id !== id),
        connections: pg.connections.filter((c) => c.source !== id && c.target !== id),
        conversation:
          pg.conversation.startingAgentId === id
            ? { ...pg.conversation, startingAgentId: null }
            : pg.conversation,
        transcript: pg.transcript.map((m) =>
          m.agentId === id ? { ...m, agentDeleted: true } : m,
        ),
      }));
    },

    setAgentPosition(id, x, y) {
      mutate((pg) => ({
        ...pg,
        agents: pg.agents.map((a) => (a.id === id ? { ...a, position: { x, y } } : a)),
      }));
    },

    addConnection(conn) {
      mutate((pg) => {
        // Prevent duplicate directed edges between the same pair.
        const exists = pg.connections.some(
          (c) => c.source === conn.source && c.target === conn.target,
        );
        if (exists) return pg;
        return { ...pg, connections: [...pg.connections, conn] };
      });
    },

    updateConnection(id, patch) {
      mutate((pg) => ({
        ...pg,
        connections: pg.connections.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      }));
    },

    removeConnection(id) {
      mutate((pg) => ({ ...pg, connections: pg.connections.filter((c) => c.id !== id) }));
    },

    addProvider(provider) {
      mutate((pg) => ({ ...pg, providers: [...pg.providers, provider] }));
    },

    updateProvider(id, patch) {
      mutate((pg) => ({
        ...pg,
        providers: pg.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      }));
    },

    removeProvider(id) {
      mutate((pg) => ({
        ...pg,
        providers: pg.providers.filter((p) => p.id !== id),
        // Unassign this provider from any agents that used it.
        agents: pg.agents.map((a) =>
          a.llm.providerId === id ? { ...a, llm: { ...a.llm, providerId: null } } : a,
        ),
      }));
    },

    updateConversation(patch) {
      mutate((pg) => ({ ...pg, conversation: { ...pg.conversation, ...patch } }));
    },

    appendTranscript(msg) {
      mutate((pg) => ({ ...pg, transcript: [...pg.transcript, msg] }));
    },

    clearTranscript() {
      mutate((pg) => ({ ...pg, transcript: [] }));
    },

    updateUiLayout(patch) {
      mutate((pg) => ({ ...pg, ui: { ...pg.ui, ...patch } }));
    },

    async flushSave() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      await doSave();
    },
  };
});
