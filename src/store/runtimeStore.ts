import { create } from 'zustand';
import type { RuntimeState } from '../domain/schema';
import type { ChatMessage } from '../providers/types';

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
}

/**
 * Runtime execution state (spec §16). MEMORY-ONLY — never persisted. After a
 * reload there is no active run; any run that was active is simply gone
 * (interrupted), never resumed (spec §16, §11).
 */

export type RunStatus = 'idle' | 'running' | 'stopped' | 'completed' | 'error' | 'interrupted';

export interface EventLogEntry {
  id: string;
  at: number;
  kind: string;
  message: string;
  agentId?: string | null;
}

export interface RunError {
  level: 'agent' | 'run';
  agentId?: string | null;
  summary: string;
  detail?: string;
  provider?: string;
  at: number;
  retryEligible?: boolean;
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
  /** Non-serialized: aborts the in-flight provider request (spec §14). */
  abortController: AbortController | null;

  startRun: (runId: string, controller: AbortController) => void;
  recordSnapshot: (messageId: string, snapshot: RequestSnapshot) => void;
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
    set((s) => ({ requestSnapshots: { ...s.requestSnapshots, [messageId]: snapshot } })),
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
  logEvent: (entry) => set((s) => ({ events: [...s.events, entry] })),
  addError: (error) => set((s) => ({ errors: [...s.errors, error] })),
  reset: () => set({ ...initial }),
  isRunning: () => get().status === 'running',
}));
