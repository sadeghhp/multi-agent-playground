import { create } from 'zustand';
import { type Theme, getTheme, setTheme } from './prefs';

/**
 * Transient UI state (spec §16). Never persisted with the domain model.
 */

export type OpenPanel =
  | 'none'
  | 'providers'
  | 'skills'
  | 'run'
  | 'playgrounds'
  | 'library'
  | 'settings'
  | 'timeline'
  | 'createAgentAi';

export type Selection =
  | { kind: 'none' }
  | { kind: 'agent'; id: string }
  | { kind: 'connection'; id: string };

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

interface UiState {
  selection: Selection;
  openPanel: OpenPanel;
  theme: Theme;
  /** Transient banner for warnings/errors surfaced to the user. */
  toast: { kind: 'info' | 'warn' | 'error'; message: string } | null;
  /** In-app confirmation dialog request (replaces window.confirm). */
  confirm: ConfirmState | null;

  selectAgent: (id: string) => void;
  selectConnection: (id: string) => void;
  clearSelection: () => void;
  setPanel: (panel: OpenPanel) => void;
  toggleTheme: () => void;
  showToast: (kind: 'info' | 'warn' | 'error', message: string) => void;
  dismissToast: () => void;
  /** Open a themed confirm dialog; resolves true if the user confirms. */
  requestConfirm: (opts: ConfirmOptions) => Promise<boolean>;
  resolveConfirm: (ok: boolean) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  selection: { kind: 'none' },
  openPanel: 'none',
  theme: getTheme(),
  toast: null,
  confirm: null,

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
  requestConfirm: (opts) =>
    new Promise<boolean>((resolve) => {
      // Resolve any dialog already open (defensive) before showing the new one.
      const existing = get().confirm;
      if (existing) existing.resolve(false);
      set({ confirm: { ...opts, resolve } });
    }),
  resolveConfirm: (ok) => {
    const current = get().confirm;
    if (!current) return;
    current.resolve(ok);
    set({ confirm: null });
  },
}));
