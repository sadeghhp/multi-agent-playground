import { create } from 'zustand';
import type { Provider } from '../domain/schema';
import { deleteProvider as dbDelete, loadAllProviders, saveProvider } from '../persistence/db';
import { useDomainStore } from './domainStore';

/**
 * Application-global provider registry (schema v2). Providers are created once at
 * the scope of the whole app and reused by every playground — creating a new
 * playground immediately has access to all providers already configured. Agents
 * reference a provider by id (`agent.llm.providerId`); that id resolves here.
 *
 * Kept separate from the domain (playground) store on purpose: providers are not
 * part of any single playground's saved state, so they persist and are edited
 * independently (persistence/db.ts `providers` object store). API keys live in
 * the credential store, never in the persisted provider record.
 */

interface ProviderState {
  providers: Provider[];
  hydrated: boolean;

  hydrate: () => Promise<void>;
  addProvider: (provider: Provider) => void;
  updateProvider: (id: string, patch: Partial<Provider>) => void;
  removeProvider: (id: string) => void;
  /**
   * Reuse an existing provider that points at the same endpoint, or add the given
   * one. Returns the id that callers should wire agents to. Used when loading the
   * example and when merging imported providers, so repeats don't pile up
   * near-duplicate registry entries.
   */
  ensureProvider: (provider: Provider) => string;
  /** Merge imported providers into the registry, deduping by id (spec §15.3). */
  mergeProviders: (incoming: Provider[]) => void;
}

/** Two providers are "the same endpoint" when base URL + path match. */
function sameEndpoint(a: Provider, b: Provider): boolean {
  return a.baseUrl === b.baseUrl && a.path === b.path;
}

// Debounce persistence so live edits in the provider editor don't write on every
// keystroke. Dirty ids are flushed together after a short quiet period.
const SAVE_DEBOUNCE_MS = 400;
const dirty = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useProviderStore = create<ProviderState>((set, get) => {
  function persist(id: string) {
    dirty.add(id);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }

  async function flush() {
    saveTimer = null;
    const ids = [...dirty];
    dirty.clear();
    for (const id of ids) {
      // Re-read live state on every iteration rather than a snapshot taken
      // once at the top: this loop awaits between saves, and if the provider
      // was removed during that gap (removeProvider already dispatched its
      // own dbDelete), a stale snapshot would still save it here — resurrecting
      // a just-deleted record in IndexedDB.
      const p = get().providers.find((pr) => pr.id === id);
      if (p) await saveProvider(p).catch((err) => console.error('Provider save failed', err));
    }
  }

  return {
    providers: [],
    hydrated: false,

    async hydrate() {
      try {
        const providers = await loadAllProviders();
        set({ providers, hydrated: true });
      } catch (err) {
        // A transient IndexedDB failure at startup must not crash app
        // initialization — degrade to an empty, usable registry instead.
        console.error('Provider hydrate failed', err);
        set({ providers: [], hydrated: true });
      }
    },

    addProvider(provider) {
      set((s) => ({ providers: [...s.providers, provider] }));
      persist(provider.id);
    },

    updateProvider(id, patch) {
      set((s) => ({
        providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      }));
      persist(id);
    },

    removeProvider(id) {
      set((s) => ({ providers: s.providers.filter((p) => p.id !== id) }));
      dirty.delete(id);
      void dbDelete(id).catch((err) => console.error('Provider delete failed', err));
      // Unassign the provider from agents in the currently-open playground. Other
      // playgrounds sit in IndexedDB and are left as-is; they degrade gracefully to
      // a run-validation error ("no provider assigned") until reassigned.
      useDomainStore.getState().unassignProvider(id);
    },

    ensureProvider(provider) {
      const existing = get().providers.find((p) => sameEndpoint(p, provider));
      if (existing) return existing.id;
      get().addProvider(provider);
      return provider.id;
    },

    mergeProviders(incoming) {
      const known = new Set(get().providers.map((p) => p.id));
      const fresh = incoming.filter((p) => !known.has(p.id));
      if (fresh.length === 0) return;
      set((s) => ({ providers: [...s.providers, ...fresh] }));
      fresh.forEach((p) => persist(p.id));
    },
  };
});
