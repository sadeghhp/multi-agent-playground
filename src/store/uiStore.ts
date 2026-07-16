import { create } from 'zustand';
import { type Theme, getTheme, setTheme } from './prefs';
import type { FallbackCandidate } from '../usage/fallback';
import type { BudgetSnapshot } from '../usage/budget';

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
  | 'runHistory'
  | 'createAgentAi'
  | 'smartArrange'
  | 'usage';

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

export interface FallbackSuggestionOptions {
  agentName: string;
  failedProviderName: string;
  failedModel: string;
  errorSummary: string;
  candidates: FallbackCandidate[];
  budget: BudgetSnapshot;
}

export type FallbackChoice = { providerId: string; model: string } | null;

interface FallbackState extends FallbackSuggestionOptions {
  resolve: (choice: FallbackChoice) => void;
}

/** User's answer to a failure-decision prompt (flow control, 'prompt' mode). */
export type FailureDecision = 'stop' | 'skip' | 'retry' | 'disable';

export interface FailureDecisionOptions {
  agentName: string;
  errorSummary: string;
  /** Consecutive post-retry failures for this agent so far. */
  consecutiveFailures: number;
  /** Auto-disable threshold has been reached — preselect "remove from circuit". */
  suggestDisable: boolean;
}

interface FailureDecisionState extends FailureDecisionOptions {
  resolve: (decision: FailureDecision) => void;
}

interface UiState {
  selection: Selection;
  openPanel: OpenPanel;
  theme: Theme;
  /** Transient banner for warnings/errors surfaced to the user. */
  toast: { kind: 'info' | 'warn' | 'error'; message: string } | null;
  /** In-app confirmation dialog request (replaces window.confirm). */
  confirm: ConfirmState | null;
  /** Suggest-only provider fallback while a run is paused on failure. */
  fallbackSuggest: FallbackState | null;
  /** Failure-decision prompt while a run is paused on failure ('prompt' mode). */
  failureDecision: FailureDecisionState | null;
  /** Bumped to ask the canvas to re-fit the viewport (e.g. after Smart Arrange). */
  fitViewNonce: number;

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
  /**
   * Pause for a temporary provider switch suggestion; null = dismissed. If a
   * signal is provided, aborting it (e.g. the user hit Stop) resolves the
   * pending prompt to null so the run loop never hangs on it.
   */
  requestFallbackSuggestion: (
    opts: FallbackSuggestionOptions,
    signal?: AbortSignal,
  ) => Promise<FallbackChoice>;
  resolveFallbackSuggestion: (choice: FallbackChoice) => void;
  /**
   * Pause for a user decision after an agent failed ('prompt' mode). Aborting
   * the provided signal resolves the pending prompt to 'stop' so the loop never
   * hangs when the run is stopped mid-decision.
   */
  requestFailureDecision: (
    opts: FailureDecisionOptions,
    signal?: AbortSignal,
  ) => Promise<FailureDecision>;
  resolveFailureDecision: (decision: FailureDecision) => void;
  /** Ask the canvas to re-fit the viewport around all nodes. */
  requestFitView: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  selection: { kind: 'none' },
  openPanel: 'none',
  theme: getTheme(),
  toast: null,
  confirm: null,
  fallbackSuggest: null,
  failureDecision: null,
  fitViewNonce: 0,

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
  requestFitView: () => set((s) => ({ fitViewNonce: s.fitViewNonce + 1 })),
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
  requestFallbackSuggestion: (opts, signal) =>
    new Promise<FallbackChoice>((resolve) => {
      const existing = get().fallbackSuggest;
      if (existing) existing.resolve(null);
      if (signal?.aborted) {
        // Clear any just-resolved modal so it doesn't linger rendered when we
        // bail without opening a replacement.
        if (existing) set({ fallbackSuggest: null });
        resolve(null);
        return;
      }
      const onAbort = () => {
        if (get().fallbackSuggest) set({ fallbackSuggest: null });
        resolve(null);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const wrapped = (choice: FallbackChoice) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(choice);
      };
      set({ fallbackSuggest: { ...opts, resolve: wrapped } });
    }),
  resolveFallbackSuggestion: (choice) => {
    const current = get().fallbackSuggest;
    if (!current) return;
    current.resolve(choice);
    set({ fallbackSuggest: null });
  },
  requestFailureDecision: (opts, signal) =>
    new Promise<FailureDecision>((resolve) => {
      const existing = get().failureDecision;
      if (existing) existing.resolve('stop');
      if (signal?.aborted) {
        if (existing) set({ failureDecision: null });
        resolve('stop');
        return;
      }
      const onAbort = () => {
        if (get().failureDecision) set({ failureDecision: null });
        resolve('stop');
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const wrapped = (decision: FailureDecision) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(decision);
      };
      set({ failureDecision: { ...opts, resolve: wrapped } });
    }),
  resolveFailureDecision: (decision) => {
    const current = get().failureDecision;
    if (!current) return;
    current.resolve(decision);
    set({ failureDecision: null });
  },
}));
