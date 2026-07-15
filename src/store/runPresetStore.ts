import { create } from 'zustand';
import { type ConversationSettings, type RunPreset } from '../domain/schema';
import { createRunPreset } from '../domain/factories';
import { deleteRunPreset, loadAllRunPresets, saveRunPreset } from '../persistence/db';

/**
 * Named, reusable bundles of "Run conversation" options (tone, length,
 * chit-chat policy, language, temperature/timeout overrides, turn caps,
 * stop-on-error). Kept separate from domainStore because presets are not
 * scoped to a single playground. Persists to its own IndexedDB store (see
 * persistence/db.ts).
 */

interface RunPresetState {
  presets: RunPreset[];
  hydrate: () => Promise<void>;
  /** Snapshot a conversation's run-level options into a named preset. */
  savePreset: (name: string, conversation: ConversationSettings) => Promise<RunPreset>;
  deletePreset: (id: string) => Promise<void>;
}

export const useRunPresetStore = create<RunPresetState>((set, get) => ({
  presets: [],

  async hydrate() {
    try {
      const all = await loadAllRunPresets();
      all.sort((a, b) => b.savedAt - a.savedAt);
      set({ presets: all });
    } catch (err) {
      console.error('Run preset hydrate failed', err);
      set({ presets: [] });
    }
  },

  async savePreset(name, conversation) {
    const preset = createRunPreset(name, conversation);
    set({ presets: [preset, ...get().presets] });
    await saveRunPreset(preset);
    return preset;
  },

  async deletePreset(id) {
    await deleteRunPreset(id);
    set({ presets: get().presets.filter((p) => p.id !== id) });
  },
}));
