import { create } from 'zustand';
import { type Theme, getTheme, setTheme } from './prefs';

/**
 * Transient UI state (spec §16). Never persisted with the domain model.
 */

export type OpenPanel = 'none' | 'providers' | 'run' | 'playgrounds' | 'settings' | 'timeline';

export type Selection =
  | { kind: 'none' }
  | { kind: 'agent'; id: string }
  | { kind: 'connection'; id: string };

interface UiState {
  selection: Selection;
  openPanel: OpenPanel;
  theme: Theme;
  /** Transient banner for warnings/errors surfaced to the user. */
  toast: { kind: 'info' | 'warn' | 'error'; message: string } | null;

  selectAgent: (id: string) => void;
  selectConnection: (id: string) => void;
  clearSelection: () => void;
  setPanel: (panel: OpenPanel) => void;
  toggleTheme: () => void;
  showToast: (kind: 'info' | 'warn' | 'error', message: string) => void;
  dismissToast: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  selection: { kind: 'none' },
  openPanel: 'none',
  theme: getTheme(),
  toast: null,

  selectAgent: (id) => set({ selection: { kind: 'agent', id } }),
  selectConnection: (id) => set({ selection: { kind: 'connection', id } }),
  clearSelection: () => set({ selection: { kind: 'none' } }),
  setPanel: (panel) => set({ openPanel: panel }),
  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    set({ theme: next });
  },
  showToast: (kind, message) => set({ toast: { kind, message } }),
  dismissToast: () => set({ toast: null }),
}));
