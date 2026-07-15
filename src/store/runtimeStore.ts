import { create } from 'zustand';
import type { RuntimeState } from '../domain/schema';
import type { ChatMessage } from '../providers/types';
import type { ProviderErrorKind } from '../providers/errors';

/**
 * Sanitized request/response snapshot for the request inspector (spec §13.3).
 * Held in memory only — never persisted — so no secrets ever hit storage. The
 * endpoint URL and messages carry no credentials (auth lives in headers, which
 * are deliberately omitted here).
 */
export interface RequestSnapshot {
  url: string;
  providerName: string;
  model: string;
  messages: ChatMessage[];
  params: Record<string, unknown>;
  status?: number;
  finishReason?: string | null;
  error?: string;
  rawExcerpt?: string;
  errorKind?: ProviderErrorKind;
  errorType?: string;
  rawUpstream?: string;
  streamedError?: boolean;
  promptMessages?: number;
  promptChars?: number;
  partialOutputChars?: number;
}

/**
 * Runtime execution state (spec §16). MEMORY-ONLY — never persisted. After a
 * reload there is no active run; any run that was active is simply gone
 * (interrupted), never resumed (spec §16, §11).
 */

export type RunStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'stopped'
  | 'completed'
  | 'error'
  | 'interrupted';

export interface EventLogEntry {
  id: string;
  at: number;
  kind: string;
  message: string;
  agentId?: string | null;
}

export interface RunError {
  id: string;
  level: 'agent' | 'run';
  agentId?: string | null;
  summary: string;
  detail?: string;
  provider?: string;
  at: number;
  retryEligible?: boolean;
  errorKind?: ProviderErrorKind;
}

/** Temporary provider/model remap for the current run only (suggest-only fallback). */
export interface ProviderOverride {
  providerId: string;
  model: string;
}

interface RuntimeStoreState {
  runId: string | null;
  status: RunStatus;
  currentTurn: number;
  activeAgentId: string | null;
  /** The edge currently feeding the active agent, for highlight (spec §10.3). */
  activeConnectionId: string | null;
  /** Per-agent runtime visual state (spec §7.2 runtime states). */
  agentStates: Record<string, RuntimeState>;
  responsesPerAgent: Record<string, number>;
  events: EventLogEntry[];
  errors: RunError[];
  /** Per-message sanitized request snapshots (spec §13.3), memory-only. */
  requestSnapshots: Record<string, RequestSnapshot>;
  /**
   * Per-agent live token buffer for the in-flight response, keyed by agent id.
   * Memory-only; cleared when the agent's turn finalizes into the transcript.
   */
  streamingText: Record<string, string>;
  /**
   * Per-agent live reasoning/thinking buffer for the in-flight response.
   * Separate from `streamingText` so the UI can show a thinking indicator
   * while answer tokens stream into the body (ChatGPT/DeepSeek-style).
   */
  streamingReasoning: Record<string, string>;
  /** Run-scoped provider overrides from accepted fallback suggestions. */
  providerOverrides: Record<string, ProviderOverride>;
  /**
   * Agents removed from the circuit for THIS run only (flow control). The
   * domain model is never touched — the graph is locked during a run
   * (spec §10.3) — so removal lives here and is consulted at both enqueue
   * (outgoing) and dequeue. Cleared when a new run starts.
   */
  runDisabledAgents: Record<string, true>;
  /**
   * Per-agent count of consecutive post-retry failures; reset to 0 on any
   * success by the same agent. Drives auto-disable escalation.
   */
  consecutiveFailures: Record<string, number>;
  /**
   * A pause was requested; the run loop suspends at the next turn boundary and
   * flips status to 'paused' (spec extension: flow control). Cleared on resume
   * and when a new run starts.
   */
  pauseRequested: boolean;
  /** Tokens recorded for the active run (for budget gating). */
  runTokens: number;
  runFallbackTokens: number;
  /** Non-serialized: aborts the in-flight provider request (spec §14). */
  abortController: AbortController | null;

  startRun: (runId: string, controller: AbortController) => void;
  recordSnapshot: (messageId: string, snapshot: RequestSnapshot) => void;
  appendToken: (agentId: string, chunk: string) => void;
  appendReasoningToken: (agentId: string, chunk: string) => void;
  clearStreaming: (agentId: string) => void;
  setProviderOverride: (agentId: string, override: ProviderOverride) => void;
  /** Remove an agent from the circuit for the rest of this run. */
  disableAgentForRun: (agentId: string) => void;
  /** True if the agent has been removed from the circuit this run. */
  isAgentDisabledForRun: (agentId: string) => boolean;
  /** Increment and return the agent's consecutive-failure streak. */
  bumpConsecutiveFailures: (agentId: string) => number;
  /** Reset the agent's consecutive-failure streak (call on success). */
  resetConsecutiveFailures: (agentId: string) => void;
  /** Request/clear a pause (the loop acts on it at the next turn boundary). */
  setPauseRequested: (requested: boolean) => void;
  addRunTokens: (tokens: number, fallback: boolean) => void;
  setStatus: (status: RunStatus) => void;
  setActive: (agentId: string | null, connectionId: string | null) => void;
  setAgentState: (agentId: string, state: RuntimeState) => void;
  incTurn: () => void;
  incAgentResponses: (agentId: string) => void;
  logEvent: (entry: EventLogEntry) => void;
  addError: (error: RunError) => void;
  reset: () => void;
  isRunning: () => boolean;
}

// Bounds on memory-only, append-only run state — without these, a long
// conversation (many turns/messages) grows these collections without limit
// for the entire life of the run, increasing memory use and the cost of every
// re-render that reads them.
const MAX_EVENTS = 500;
const MAX_ERRORS = 500;
const MAX_REQUEST_SNAPSHOTS = 500;

function capArray<T>(arr: T[], max: number): T[] {
  return arr.length > max ? arr.slice(arr.length - max) : arr;
}

function capRecord<T>(record: Record<string, T>, max: number): Record<string, T> {
  const keys = Object.keys(record);
  if (keys.length <= max) return record;
  const next = { ...record };
  for (const key of keys.slice(0, keys.length - max)) delete next[key];
  return next;
}

const initial = {
  runId: null,
  status: 'idle' as RunStatus,
  currentTurn: 0,
  activeAgentId: null,
  activeConnectionId: null,
  agentStates: {},
  responsesPerAgent: {},
  events: [],
  errors: [],
  requestSnapshots: {},
  streamingText: {},
  streamingReasoning: {},
  providerOverrides: {} as Record<string, ProviderOverride>,
  runDisabledAgents: {} as Record<string, true>,
  consecutiveFailures: {} as Record<string, number>,
  pauseRequested: false,
  runTokens: 0,
  runFallbackTokens: 0,
  abortController: null,
};

export const useRuntimeStore = create<RuntimeStoreState>((set, get) => ({
  ...initial,

  startRun: (runId, controller) =>
    set({
      ...initial,
      runId,
      status: 'running',
      abortController: controller,
    }),

  recordSnapshot: (messageId, snapshot) =>
    set((s) => ({
      requestSnapshots: capRecord(
        { ...s.requestSnapshots, [messageId]: snapshot },
        MAX_REQUEST_SNAPSHOTS,
      ),
    })),
  appendToken: (agentId, chunk) =>
    set((s) => ({
      streamingText: { ...s.streamingText, [agentId]: (s.streamingText[agentId] ?? '') + chunk },
    })),
  appendReasoningToken: (agentId, chunk) =>
    set((s) => ({
      streamingReasoning: {
        ...s.streamingReasoning,
        [agentId]: (s.streamingReasoning[agentId] ?? '') + chunk,
      },
    })),
  clearStreaming: (agentId) =>
    set((s) => {
      const hasText = agentId in s.streamingText;
      const hasReasoning = agentId in s.streamingReasoning;
      if (!hasText && !hasReasoning) return s;
      const nextText = { ...s.streamingText };
      const nextReasoning = { ...s.streamingReasoning };
      delete nextText[agentId];
      delete nextReasoning[agentId];
      return { streamingText: nextText, streamingReasoning: nextReasoning };
    }),
  setProviderOverride: (agentId, override) =>
    set((s) => ({
      providerOverrides: { ...s.providerOverrides, [agentId]: override },
    })),
  disableAgentForRun: (agentId) =>
    set((s) => ({
      runDisabledAgents: { ...s.runDisabledAgents, [agentId]: true },
    })),
  isAgentDisabledForRun: (agentId) => Boolean(get().runDisabledAgents[agentId]),
  bumpConsecutiveFailures: (agentId) => {
    const next = (get().consecutiveFailures[agentId] ?? 0) + 1;
    set((s) => ({
      consecutiveFailures: { ...s.consecutiveFailures, [agentId]: next },
    }));
    return next;
  },
  resetConsecutiveFailures: (agentId) =>
    set((s) => {
      if (!(agentId in s.consecutiveFailures)) return s;
      const next = { ...s.consecutiveFailures };
      delete next[agentId];
      return { consecutiveFailures: next };
    }),
  setPauseRequested: (requested) => set({ pauseRequested: requested }),
  addRunTokens: (tokens, fallback) =>
    set((s) => ({
      runTokens: s.runTokens + tokens,
      runFallbackTokens: fallback ? s.runFallbackTokens + tokens : s.runFallbackTokens,
    })),
  setStatus: (status) => set({ status }),
  setActive: (activeAgentId, activeConnectionId) => set({ activeAgentId, activeConnectionId }),
  setAgentState: (agentId, state) =>
    set((s) => ({ agentStates: { ...s.agentStates, [agentId]: state } })),
  incTurn: () => set((s) => ({ currentTurn: s.currentTurn + 1 })),
  incAgentResponses: (agentId) =>
    set((s) => ({
      responsesPerAgent: {
        ...s.responsesPerAgent,
        [agentId]: (s.responsesPerAgent[agentId] ?? 0) + 1,
      },
    })),
  logEvent: (entry) => set((s) => ({ events: capArray([...s.events, entry], MAX_EVENTS) })),
  addError: (error) => set((s) => ({ errors: capArray([...s.errors, error], MAX_ERRORS) })),
  reset: () => set({ ...initial }),
  isRunning: () => get().status === 'running',
}));
