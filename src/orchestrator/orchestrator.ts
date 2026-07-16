import type {
  Agent,
  Connection,
  FailurePolicy,
  Playground,
  Provider,
  ToolTraceEntry,
  TranscriptMessage,
} from '../domain/schema';
import { resolveFailurePolicy } from '../domain/schema';
import { newErrorId, newLogId, newMessageId, newRunId } from '../domain/ids';
import { useDomainStore } from '../store/domainStore';
import { useProviderStore } from '../store/providerStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { useUiStore } from '../store/uiStore';
import { useUsageStore } from '../store/usageStore';
import { ProviderError, formatProviderErrorDetail, retryEligible, summaryFor } from '../providers/errors';
import { sendChat } from '../providers/openaiAdapter';
import { buildEndpoint } from '../providers/url';
import type { ChatMessage, NormalizedResponse } from '../providers/types';
import type { RequestSnapshot } from '../store/runtimeStore';
import { assembleMessages, boundHistory, estimateTokens, visibleAnswerText } from '../agents/promptAssembly';
import { isTerminalKind, terminalKindRank, usesFullHistory } from '../domain/agentKind';
import { hasBlockingErrors, validateForRun } from './validate';
import { beginVersionedRun, finalizeVersionedRun } from './runHistory';
import {
  assertWithinBudget,
  BudgetExceededError,
  buildBudgetSnapshot,
} from '../usage/budget';
import { isSuggestableFailure, listFallbackCandidates } from '../usage/fallback';
import { detectToolCall, MAX_TOOL_ROUNDS, stripToolFences, toolResultMessage } from '../tools/protocol';
import { executeToolCall, resolveTools } from '../tools/registry';
import { buildControlTools, type RosterEntry } from '../tools/control';
import {
  applyControlEffects,
  createControlBudget,
  createNoopTurnControl,
  createTurnControl,
  promoteToFront,
  type QueueItem,
  type TurnControl,
} from './controlEffects';

/**
 * Conversation orchestrator (spec §11). Directed sequential traversal of the
 * agent graph with hard cycle controls. One run at a time; a single
 * AbortController cancels the in-flight request and the loop (spec §14).
 * Queue item shape (incl. the out-of-order `directive`) lives in
 * controlEffects.ts, the orchestration control plane.
 */

/**
 * Control outcome of a single agent turn (see runAgentTurn). Decoupled from the
 * queue so both the discussion loop and the wrap-up phase can drive turns and
 * apply their own failure handling.
 *  - 'success'          a transcript message was appended
 *  - 'skipped'          agent missing/disabled/removed/at its response limit
 *  - 'aborted'          the run was stopped mid-turn
 *  - { failedDetail }   generation failed; the failure is already recorded
 */
type TurnOutcome = 'success' | 'skipped' | 'aborted' | { failedDetail: string };

function log(kind: string, message: string, agentId?: string | null) {
  useRuntimeStore.getState().logEvent({
    id: newLogId(),
    at: Date.now(),
    kind,
    message,
    agentId,
  });
}

/** Outgoing enabled connections to enabled targets, highest priority first (spec §11.3). */
function outgoing(pg: Playground, agentId: string): Connection[] {
  const enabled = new Set(pg.agents.filter((a) => a.runtime.enabled).map((a) => a.id));
  return pg.connections
    .filter((c) => c.enabled && c.source === agentId && enabled.has(c.target))
    .sort((a, b) => b.priority - a.priority);
}

function responseLimitFor(agent: Agent, pg: Playground): number {
  return Math.min(agent.runtime.maxResponsesPerRun, pg.conversation.maxResponsesPerAgent);
}

/**
 * Resolver for an in-flight pause wait (see waitForResume). Module-scoped
 * because only one run is ever active (spec §19); `resumeRun` calls it to wake
 * the loop. Null when the loop is not paused.
 */
let resumeResolve: (() => void) | null = null;

/**
 * Block the loop while paused until `resumeRun` wakes it or the run is aborted.
 * Resolves (never rejects) on abort — the caller re-checks the signal and breaks.
 */
function waitForResume(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      resumeResolve = null;
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    resumeResolve = () => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
  });
}

/**
 * Sleep that rejects with the abort reason if the signal fires first (spec §14).
 * Used for auto-retry backoff so a Stop during the wait breaks the loop promptly
 * instead of stalling for the full delay.
 */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Run `attempt` (a single provider call) with automatic re-attempts for
 * transient, retry-eligible failures (rate-limit/timeout/server-error/network)
 * up to `maxAutoRetries`, backing off exponentially from `backoffMs`. Silent by
 * design — no transcript/error rows per attempt, only an event-log line — so a
 * blip that resolves on retry never surfaces as a user-visible failure. The
 * caller's catch handles the final, non-retryable error. Aborts propagate
 * immediately (never retried).
 */
async function withAutoRetry<T>(
  attempt: () => Promise<T>,
  opts: {
    policy: FailurePolicy;
    signal: AbortSignal;
    agentId: string;
    agentName: string;
    onBeforeRetry?: () => void;
  },
): Promise<T> {
  let tries = 0;
  for (;;) {
    try {
      return await attempt();
    } catch (err) {
      if (opts.signal.aborted) throw err;
      const kind = err instanceof ProviderError ? err.kind : 'unknown';
      if (tries >= opts.policy.maxAutoRetries || !retryEligible(kind)) throw err;
      tries += 1;
      opts.onBeforeRetry?.();
      const delay = opts.policy.backoffMs * 2 ** (tries - 1);
      log(
        'request-retrying',
        `Retrying "${opts.agentName}" (attempt ${tries}/${opts.policy.maxAutoRetries}) after ${kind} — waiting ${delay}ms.`,
        opts.agentId,
      );
      await abortableDelay(delay, opts.signal); // rejects on abort → loop exits
    }
  }
}

/** Most recent non-empty *answer* from `sourceAgentId` (never reasoning). */
function findLastSourceOutput(
  transcript: TranscriptMessage[],
  sourceAgentId: string | null,
): string | null {
  if (!sourceAgentId) return null;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i];
    if (m.agentId !== sourceAgentId) continue;
    const answer = visibleAnswerText(m);
    if (answer) return answer;
  }
  return null;
}

/**
 * Char budget for the terminal (summarizer/finalizer) history window. Much
 * larger than a participant's default so they still see effectively the whole
 * conversation, but not unbounded — a very long run must not overflow a small
 * model on the one turn (final synthesis) that matters most.
 */
const TERMINAL_HISTORY_CHAR_BUDGET = 48_000;

/**
 * A user interjection stays a hard "you must address this" instruction for this
 * many completed agent turns after it; beyond that it downgrades to softer
 * context so a since-resolved interjection stops forcing every later agent to
 * re-answer it (see promptAssembly.userDirectiveIsFresh).
 */
const USER_DIRECTIVE_FRESH_TURNS = 3;

/**
 * Most recent user-authored message (see continueRun), walked backwards in
 * place, with its transcript index so the caller can measure how many turns
 * have addressed it. Surfaced explicitly — not just via the bounded history —
 * so it stays visible even after it scrolls out of the window.
 */
function findLastUserDirective(
  transcript: TranscriptMessage[],
): { content: string; index: number; targetAgentId: string | null; targetAgentName: string | null } | null {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i];
    if (m.agentId === null && m.role === 'user' && m.content) {
      return {
        content: m.content,
        index: i,
        targetAgentId: m.targetAgentId ?? null,
        targetAgentName: m.targetAgentName ?? null,
      };
    }
  }
  return null;
}

/**
 * The discussion's current topic redirect, if any: the LAST transcript message
 * carrying a `topicChange` (set via the moderator's set_topic tool). Derived
 * from the transcript — not runtime state — so it survives continueRun
 * re-entries and page reloads with zero extra persistence.
 */
export function findActiveTopic(
  transcript: TranscriptMessage[],
): { topic: string; setByName: string } | null {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i];
    if (m.topicChange?.trim() && m.status === 'completed') {
      return { topic: m.topicChange.trim(), setByName: m.agentName };
    }
  }
  return null;
}

export function stopRun(): void {
  const runtime = useRuntimeStore.getState();
  // Stoppable from a paused run too — the abort resolves the pause wait so the
  // loop unblocks and exits promptly.
  if (runtime.status !== 'running' && runtime.status !== 'paused') return;
  runtime.abortController?.abort(new DOMException('Run stopped by user', 'AbortError'));
  runtime.setStatus('stopped');
  runtime.setActive(null, null);
  runtime.setPauseRequested(false);
  log('execution-stopped', 'Run stopped by user.');
}

/**
 * Suspend a running run at the next turn boundary (spec extension: flow
 * control). Takes effect after the in-flight turn finishes; the graph and
 * transcript are untouched while paused. No-op unless a run is active.
 */
export function pauseRun(): void {
  const runtime = useRuntimeStore.getState();
  if (runtime.status !== 'running') return;
  runtime.setPauseRequested(true);
  log('run-pause-requested', 'Pause requested — the run will pause after the current turn.');
}

/** Resume a paused run. No-op unless the run is actually paused. */
export function resumeRun(): void {
  const runtime = useRuntimeStore.getState();
  if (runtime.status !== 'paused') return;
  const resolve = resumeResolve;
  resumeResolve = null;
  // The loop clears pauseRequested and flips status back to 'running' when the
  // wait resolves; resolve it here to wake it.
  resolve?.();
}

/**
 * Re-attempt a single agent's failed turn after a run has finished/stopped
 * (spec extension: flow control). Starts a fresh run seeded at that agent, with
 * its source/incoming connection reconstructed from its most recent failed
 * transcript entry, then continues the graph from there. No-op while a run is
 * active or when the graph no longer validates.
 */
export function retryAgentTurn(agentId: string): void {
  const domain = useDomainStore.getState();
  const pg = domain.playground;
  if (!pg) return;
  const status = useRuntimeStore.getState().status;
  if (status === 'running' || status === 'paused') return;

  const agent = pg.agents.find((a) => a.id === agentId);
  if (!agent || !agent.runtime.enabled) return;

  const providers = useProviderStore.getState().providers;
  if (hasBlockingErrors(validateForRun(pg, providers))) return;

  // Reconstruct the queue item from the agent's most recent failed turn so the
  // retry sees the same source/incoming-connection context it originally had.
  let sourceAgentId: string | null = null;
  for (let i = pg.transcript.length - 1; i >= 0; i--) {
    const m = pg.transcript[i];
    if (m.agentId === agentId && m.status === 'failed') {
      sourceAgentId = m.sourceAgentId;
      break;
    }
  }
  const connection = sourceAgentId
    ? pg.connections.find(
        (c) => c.enabled && c.source === sourceAgentId && c.target === agentId,
      ) ?? null
    : null;

  log('run-retry', `Retrying "${agent.name}" from a stopped run.`, agentId);
  // A retry is a surgical re-run of one agent, not a full round — skip the
  // terminal wrap-up so it never appends a duplicate summarizer/finalizer.
  void startRun({ seed: [{ agentId, connectionId: connection?.id ?? null, sourceAgentId }], skipWrapUp: true });
}

/**
 * Continue a finished (or stopped) run with a new user message: appends it to
 * the transcript as a user turn, then re-enters the graph so agents pick up
 * the discussion with the user's input in view (spec §11.6). When the message
 * addresses a specific agent (composer @mention → opts.targetAgentId), that
 * agent answers FIRST — the run is seeded at it with a user-question directive
 * — and the graph then continues from it via its outgoing edges. Untargeted
 * messages re-enter from the starting agent as before (broadcast directive).
 * No-op while a run is already in progress.
 */
export function continueRun(userMessage: string, opts: { targetAgentId?: string } = {}): void {
  const domain = useDomainStore.getState();
  const pg = domain.playground;
  if (!pg) return;
  if (useRuntimeStore.getState().status === 'running') return;

  const trimmed = userMessage.trim();
  if (!trimmed) return;

  const providers = useProviderStore.getState().providers;
  if (hasBlockingErrors(validateForRun(pg, providers))) return;

  // A target must be enabled and non-terminal (terminal kinds only speak in the
  // wrap-up phase). The composer filters these already; fall back to broadcast
  // rather than dropping the message if a stale target slips through.
  const target = opts.targetAgentId
    ? pg.agents.find(
        (a) => a.id === opts.targetAgentId && a.runtime.enabled && !isTerminalKind(a.kind),
      ) ?? null
    : null;

  // Monotonic turn (one past the highest so far), not 0 — a turn-grouped view
  // (timeline / exports) would otherwise wedge a stray "Turn 0" between later
  // turns. startRun then resumes numbering past this message, so the
  // interjection itself doesn't consume the continued run's turn budget.
  const userTurn = pg.transcript.reduce((max, m) => Math.max(max, m.turn), 0) + 1;
  domain.appendTranscript({
    id: newMessageId(),
    turn: userTurn,
    agentId: null,
    agentName: 'You',
    agentDeleted: false,
    role: 'user',
    language: 'en',
    model: '',
    providerId: null,
    content: trimmed,
    status: 'completed',
    sourceAgentId: null,
    connectionType: null,
    ...(target ? { targetAgentId: target.id, targetAgentName: target.name } : {}),
    timestamp: Date.now(),
  });

  if (target) {
    log('directed-question', `You addressed "${target.name}" directly — they answer next.`, target.id);
    void startRun({
      seed: [
        {
          agentId: target.id,
          connectionId: null,
          sourceAgentId: null,
          directive: { type: 'user-question', fromAgentId: null, fromName: 'You', text: trimmed, depth: 0 },
        },
      ],
    });
  } else {
    void startRun();
  }
}

export async function startRun(
  opts: {
    seed?: QueueItem[];
    skipWrapUp?: boolean;
    /**
     * Turn budget for THIS run only, overriding conversation.maxTotalTurns.
     * Used by "continue for N more turns" (timeline footer): each run counts
     * turns from zero, so the override is exactly the number of extra turns.
     */
    maxTurns?: number;
  } = {},
): Promise<void> {
  const domain = useDomainStore.getState();
  const runtime = useRuntimeStore.getState();
  const pg = domain.playground;
  if (!pg) return;
  if (runtime.status === 'running' || runtime.status === 'paused') return; // one run at a time (spec §19)

  // Snapshot structure — the graph is locked during a run (spec §10.3), so agents,
  // connections and providers won't change under us. Providers are application-
  // global (store/providerStore.ts); freeze the current registry here. Transcript
  // still appends live.
  const agentsById = new Map(pg.agents.map((a) => [a.id, a]));
  const providersById = new Map(
    useProviderStore.getState().providers.map((p) => [p.id, p]),
  );

  // Defense in depth: UI also gates on validateForRun, but startRun can be
  // called without the Run dialog (e.g. re-run paths).
  if (hasBlockingErrors(validateForRun(pg, [...providersById.values()]))) return;

  const controller = new AbortController();
  const runId = newRunId();
  // Continue numbering from the highest turn already in the transcript so a run
  // over existing content (continue, follow-up, retry, dialog re-run) never
  // restarts at 1 and collides with prior turns. Fresh runs start from 0. The
  // per-run turn cap below is measured relative to this base.
  const startTurn = pg.transcript.reduce((max, m) => Math.max(max, m.turn), 0);
  runtime.startRun(runId, controller, startTurn);
  await beginVersionedRun(pg, runId);
  log('run-started', `Run started on subject: ${pg.conversation.subject || '(none)'}`);

  // Seed the queue from the starting agent by default, or from an explicit seed
  // (a post-run retry re-enters at a specific agent — see retryAgentTurn).
  // A terminal starting agent is NOT seeded into the discussion — it only runs
  // in the wrap-up phase, so seeding it would make it speak first, breaking the
  // "runs last" contract. The wrap-up phase picks it up regardless.
  const startAgent = agentsById.get(pg.conversation.startingAgentId!);
  const defaultSeed: QueueItem[] =
    startAgent && isTerminalKind(startAgent.kind)
      ? []
      : [{ agentId: pg.conversation.startingAgentId!, connectionId: null, sourceAgentId: null }];
  const seed = opts.seed ?? defaultSeed;
  const queue: QueueItem[] = [...seed];
  const queued = new Set<string>(seed.map((s) => s.agentId));
  for (const s of seed) runtime.setAgentState(s.agentId, 'queued');

  const maxTurns = opts.maxTurns ?? pg.conversation.maxTotalTurns;
  const policy = resolveFailurePolicy(pg.conversation);
  // Run-scoped budgets for the orchestration control tools (see controlEffects).
  const runBudget = createControlBudget();
  const isDisabledForRun = (id: string) => useRuntimeStore.getState().isAgentDisabledForRun(id);
  const responsesOf = (id: string) => useRuntimeStore.getState().responsesPerAgent[id] ?? 0;
  /** Live roster for control-tool target resolution (reflects run-disabled state). */
  const buildRoster = (): RosterEntry[] =>
    pg.agents.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      enabled: a.runtime.enabled && !isDisabledForRun(a.id),
    }));

  // Turn a recorded failure into a control-flow outcome for the loop: 'abort'
  // (a Stop landed mid-decision → break), 'stop' (end the run with error),
  // or 'continue' (skip/disable/retry already applied — keep going). A 'retry'
  // decision re-queues the same turn at the front.
  const applyFailure = async (
    failedItem: QueueItem,
    failedAgent: Agent,
    detail: string,
  ): Promise<'abort' | 'stop' | 'continue'> => {
    const outcome = await handleFailedTurn(failedAgent, policy, detail, controller.signal);
    if (controller.signal.aborted) return 'abort';
    if (outcome === 'retry') {
      queue.unshift(failedItem);
      queued.add(failedItem.agentId);
      runtime.setAgentState(failedItem.agentId, 'queued');
      log('agent-queued', `Retrying "${failedAgent.name}" at the user's request.`, failedAgent.id);
      return 'continue';
    }
    return outcome === 'stop' ? 'stop' : 'continue';
  };

  // Run a single agent's turn end-to-end: guards → generate → record. It never
  // touches the queue, so the discussion loop and the wrap-up phase both use it
  // and each applies its own failure handling to the returned outcome. `ctrl`
  // collects the turn's control-tool effects; the caller drains and applies
  // them at the turn boundary (the wrap-up phase passes an inert one).
  const runAgentTurn = async (item: QueueItem, ctrl: TurnControl): Promise<TurnOutcome> => {
    const agent = agentsById.get(item.agentId);
    if (!agent || !agent.runtime.enabled) {
      log('agent-skipped', `Agent skipped (missing or disabled).`, item.agentId);
      return 'skipped';
    }
    // Removed from the circuit for this run (flow control).
    if (useRuntimeStore.getState().isAgentDisabledForRun(agent.id)) {
      log('agent-skipped', `Agent "${agent.name}" was removed from this run.`, agent.id);
      return 'skipped';
    }
    const already = useRuntimeStore.getState().responsesPerAgent[agent.id] ?? 0;
    if (already >= responseLimitFor(agent, pg)) {
      log('agent-skipped', `Agent "${agent.name}" reached its response limit.`, agent.id);
      return 'skipped';
    }

    const connection = item.connectionId
      ? pg.connections.find((c) => c.id === item.connectionId) ?? null
      : null;
    const sourceName = item.sourceAgentId ? agentsById.get(item.sourceAgentId)?.name ?? null : null;

    // --- generate ---
    useRuntimeStore.getState().incTurn();
    runtime.setActive(agent.id, item.connectionId);
    runtime.setAgentState(agent.id, 'generating');
    useRuntimeStore.getState().clearStreaming(agent.id); // reset any prior live buffer
    log('request-started', `Requesting response from "${agent.name}".`, agent.id);

    const override = useRuntimeStore.getState().providerOverrides[agent.id];
    const providerId = override?.providerId ?? agent.llm.providerId;
    const model = override?.model || agent.llm.model;
    const isFallback = Boolean(override);
    const provider = providersById.get(providerId ?? '');
    const turnNumber = useRuntimeStore.getState().currentTurn;

    if (!provider) {
      const detail = 'No provider configured for this agent.';
      recordFailure(agent, turnNumber, newMessageId(), item, detail, 'run');
      return { failedDetail: detail };
    }

    const liveTranscript = useDomainStore.getState().playground!.transcript;
    // History scope by kind:
    //  - terminal (summarizer/finalizer): effectively the whole transcript, but
    //    through a large char budget so a very long run can't overflow a small
    //    model on the final synthesis turn.
    //  - moderator: no count cap but the standard char budget applies, so a late
    //    turn on a long run can't overflow a small model (it repeats, unlike terminal).
    //  - participant: the agent's own bounded window (unchanged).
    const history = usesFullHistory(agent.kind)
      ? boundHistory(liveTranscript, liveTranscript.length, TERMINAL_HISTORY_CHAR_BUDGET)
      : agent.kind === 'moderator'
        ? boundHistory(liveTranscript, liveTranscript.length)
        : boundHistory(liveTranscript, agent.runtime.historyWindow);
    // The source agent's most recent output, always available to review/handoff
    // targets regardless of the history window (spec §12).
    const sourceOutput = findLastSourceOutput(liveTranscript, item.sourceAgentId);
    const userDirective = findLastUserDirective(liveTranscript);
    const pendingUserDirective = userDirective?.content ?? null;
    // Fresh while only a few completed agent turns have followed the interjection.
    const completedSinceDirective = userDirective
      ? liveTranscript
          .slice(userDirective.index + 1)
          .filter((m) => m.agentId !== null && m.status === 'completed').length
      : 0;
    const messages = assembleMessages({
      agent,
      conversation: pg.conversation,
      history,
      incoming: connection,
      sourceAgentName: sourceName,
      sourceAgentId: item.sourceAgentId,
      sourceOutput,
      pendingUserDirective,
      userDirectiveIsFresh: userDirective ? completedSinceDirective < USER_DIRECTIVE_FRESH_TURNS : undefined,
      userDirectiveTargetName: userDirective?.targetAgentName ?? null,
      userDirectiveTargetsSelf: userDirective?.targetAgentId === agent.id,
      // Out-of-order turn contract: an agent-question / reply-return directive
      // binds this turn only (user-question is already covered by the targeted
      // user-directive treatment above).
      pendingAgentDirective:
        item.directive && item.directive.type !== 'user-question'
          ? {
              fromName: item.directive.fromName,
              text: item.directive.text,
              isReplyReturn: item.directive.type === 'reply-return',
            }
          : null,
      activeTopic: findActiveTopic(liveTranscript),
      roster: buildRoster(),
      // "Opening" framing only fits a genuinely empty transcript.
      isFirstTurn: liveTranscript.length === 0,
    });

    // Pre-generate the id so the request snapshot and the transcript message
    // share a key. The snapshot carries NO credentials.
    const messageId = newMessageId();
    const effectiveTemperature = pg.conversation.temperatureOverride ?? agent.llm.temperature;
    const chatParams = {
      model,
      messages,
      temperature: effectiveTemperature,
      maxOutputTokens: agent.llm.maxOutputTokens,
      topP: agent.llm.topP,
      seed: agent.llm.seed,
      stopSequences: agent.llm.stopSequences,
    };
    const snapshotBase = {
      url: buildEndpoint(provider.baseUrl, provider.path),
      providerName: provider.displayName,
      model,
      messages: messages as ChatMessage[],
      params: {
        temperature: effectiveTemperature,
        maxOutputTokens: agent.llm.maxOutputTokens,
        topP: agent.llm.topP,
        seed: agent.llm.seed,
        stopSequences: agent.llm.stopSequences,
      },
    };

    const effectiveTimeoutMs =
      pg.conversation.responseTimeoutOverrideMs != null
        ? Math.min(agent.runtime.responseTimeoutMs, pg.conversation.responseTimeoutOverrideMs)
        : agent.runtime.responseTimeoutMs;

    // Executable tools (spec extension): the turn becomes a bounded loop —
    // model call → detect tool fence → execute → feed result back → re-call.
    // Each round goes through the UNCHANGED budget/retry/fallback wrapper, so
    // per-round auto-retry, failure policy, and budget assertion apply as-is.
    // Agents with no tools degenerate to exactly one round (today's behavior).
    // Control tools (orchestration) join the same loop: their execute() pushes
    // effects into `ctrl` instead of fetching data.
    const enabledTools = [
      ...resolveTools(agent.tools),
      ...buildControlTools({ agent, roster: buildRoster(), ctrl }),
    ];
    const toolTrace: ToolTraceEntry[] = [];

    try {
      let loopMessages = messages;
      let res: Awaited<ReturnType<typeof callWithBudgetAndOptionalFallback>> = null;
      for (let round = 0; ; round++) {
        res = await callWithBudgetAndOptionalFallback({
          agent,
          provider,
          providersById,
          chatParams: { ...chatParams, messages: loopMessages },
          messages: loopMessages,
          controller,
          effectiveTimeoutMs,
          isFallback,
          runId,
          playgroundId: pg.id,
          messageId,
          // Re-snapshot per round under the same messageId so the request
          // inspector always shows the request that actually produced the turn.
          snapshotBase: { ...snapshotBase, messages: loopMessages },
          item,
          turnNumber,
          policy,
        });
        if (!res) {
          // Failure already recorded inside the call; caller applies policy.
          if (controller.signal.aborted) return 'aborted';
          const errors = useRuntimeStore.getState().errors;
          const detail = errors[errors.length - 1]?.detail ?? 'Request failed.';
          return { failedDetail: detail };
        }

        // Usage is recorded per round — every round is a real provider call.
        void recordCallUsage({
          response: res.response,
          messages: loopMessages,
          provider: res.provider,
          model: res.response.model || model,
          playgroundId: pg.id,
          runId,
          fallback: res.fallback,
        });

        const call =
          round < MAX_TOOL_ROUNDS && enabledTools.length > 0
            ? detectToolCall(res.response.text, enabledTools)
            : null;
        if (!call) break;

        // The intermediate response was streamed into the live buffer; clear it
        // so the next round's tokens don't append onto the tool request text.
        useRuntimeStore.getState().clearStreaming(agent.id);

        let resultText: string;
        let entry: ToolTraceEntry;
        if (call.kind === 'error') {
          resultText = call.error;
          entry = { tool: 'invalid', input: '', result: call.error, ok: false };
          log('tool-call', `"${agent.name}" emitted a malformed tool call.`, agent.id);
        } else {
          useRuntimeStore.getState().setToolStatus(agent.id, `Using ${call.def.name}…`);
          log('tool-call', `"${agent.name}" called ${call.def.id}.`, agent.id);
          const result = await executeToolCall(call.def, call.input, controller.signal);
          resultText = result.text;
          entry = {
            tool: call.def.id,
            input: JSON.stringify(call.input),
            result: result.text,
            ok: result.ok,
            durationMs: result.durationMs,
          };
          useRuntimeStore.getState().setToolStatus(agent.id, null);
        }
        toolTrace.push(entry);

        loopMessages = [
          ...loopMessages,
          { role: 'assistant', content: res.response.text },
          { role: 'user', content: toolResultMessage(entry.tool, resultText, MAX_TOOL_ROUNDS - round - 1) },
        ];
      }

      const usedProvider = res.provider;
      const usedFallback = res.fallback;
      // Orchestration control metadata (spec extension): a directed question is
      // stamped on the ASKER's message; a topic redirect on the redirecting
      // message (findActiveTopic derives the current topic from it); a reply to
      // a directed question records who it answers so history renders the jump.
      const directedEffect = ctrl.effects.find((e) => e.kind === 'direct-question');
      const directedTarget = directedEffect ? agentsById.get(directedEffect.targetAgentId) : undefined;
      const topicEffect = ctrl.effects.find((e) => e.kind === 'set-topic');
      const answersDirected = item.directive && item.directive.type !== 'reply-return';
      const message: TranscriptMessage = {
        id: messageId,
        turn: turnNumber,
        agentId: agent.id,
        agentName: agent.name,
        agentDeleted: false,
        role: agent.role,
        language: agent.language,
        model: res.response.model,
        providerId: usedProvider.id,
        // Keep thinking out of the visible transcript body. When tools ran, a
        // leftover fence (budget-forced answer) is stripped from the answer —
        // the trace preserves it for inspection.
        content: (toolTrace.length > 0 ? stripToolFences(res.response.text) : res.response.text) || '',
        reasoning: res.response.reasoning || undefined,
        toolTrace: toolTrace.length > 0 ? toolTrace : undefined,
        status: 'completed',
        sourceAgentId: item.sourceAgentId,
        connectionType: connection?.type ?? null,
        ...(directedTarget ? { targetAgentId: directedTarget.id, targetAgentName: directedTarget.name } : {}),
        ...(topicEffect ? { topicChange: topicEffect.topic } : {}),
        ...(answersDirected ? { answeringTo: item.directive!.fromName } : {}),
        timestamp: Date.now(),
        durationMs: res.response.durationMs,
        promptTokens: res.response.promptTokens,
        completionTokens: res.response.completionTokens,
        totalTokens: res.response.totalTokens,
      };
      useDomainStore.getState().appendTranscript(message);
      useRuntimeStore.getState().clearStreaming(agent.id);
      useRuntimeStore.getState().incAgentResponses(agent.id);
      // Any success clears the consecutive-failure streak.
      useRuntimeStore.getState().resetConsecutiveFailures(agent.id);
      runtime.setAgentState(agent.id, 'completed');
      log(
        'request-completed',
        `"${agent.name}" responded in ${res.response.durationMs}ms` +
          (toolTrace.length > 0 ? ` after ${toolTrace.length} tool call${toolTrace.length === 1 ? '' : 's'}` : '') +
          (usedFallback ? ' (fallback provider).' : '.'),
        agent.id,
      );
      return 'success';
    } catch (err) {
      const partialOutputChars =
        useRuntimeStore.getState().streamingText[agent.id]?.length ?? 0;
      useRuntimeStore.getState().clearStreaming(agent.id);
      useRuntimeStore.getState().setToolStatus(agent.id, null);
      if (controller.signal.aborted) return 'aborted';
      const pe =
        err instanceof BudgetExceededError
          ? new ProviderError('bad-request', err.message)
          : err instanceof ProviderError
            ? err
            : new ProviderError('unknown', summaryFor('unknown'));
      const detail = formatProviderErrorDetail(pe);
      useRuntimeStore.getState().recordSnapshot(
        messageId,
        buildFailureSnapshot(snapshotBase, pe, messages, partialOutputChars),
      );
      recordFailure(agent, turnNumber, messageId, item, detail, 'agent', provider.displayName, pe, toolTrace);
      return { failedDetail: detail };
    }
  };

  // Pause point (spec extension: flow control). Suspends between turns until the
  // user resumes or stops; the in-flight turn always completes first. Shared by
  // the discussion loop and the wrap-up phase. Returns 'aborted' if a Stop landed
  // during the wait, else 'ok'.
  const pauseIfRequested = async (): Promise<'aborted' | 'ok'> => {
    if (!useRuntimeStore.getState().pauseRequested) return 'ok';
    runtime.setStatus('paused');
    runtime.setActive(null, null);
    log('run-paused', 'Run paused.');
    await waitForResume(controller.signal);
    if (controller.signal.aborted) return 'aborted';
    useRuntimeStore.getState().setPauseRequested(false);
    runtime.setStatus('running');
    log('run-resumed', 'Run resumed.');
    return 'ok';
  };

  // Wrap-up phase: engine-scheduled terminal kinds. Runs after the discussion
  // ends by natural drain or turn-limit (not on a user Stop). Summarizers run
  // first (so a finalizer can build on the summary), then finalizers; each sees
  // the full transcript including prior wrap-up output. Returns 'stopped' if any
  // terminal agent failed under a stop policy, 'aborted' on a mid-phase Stop,
  // else 'completed'.
  const runWrapUpPhase = async (): Promise<'completed' | 'stopped' | 'aborted'> => {
    const terminal = pg.agents
      .filter((a) => isTerminalKind(a.kind) && a.runtime.enabled)
      .filter((a) => !useRuntimeStore.getState().isAgentDisabledForRun(a.id))
      // Skip a terminal agent that already spoke this run — e.g. one seeded into
      // the discussion queue by retryAgentTurn — so it never runs twice.
      .filter((a) => (useRuntimeStore.getState().responsesPerAgent[a.id] ?? 0) === 0)
      .sort((a, b) => terminalKindRank(a.kind) - terminalKindRank(b.kind));

    // Terminal agents are independent one-shot jobs: a failure of one — even a
    // 'stop' decision — must not suppress the others. At wrap-up there is no
    // cascade left to halt, and the finalizer is the primary deliverable. Any
    // stop-level failure still ends the run in error (via the returned 'stopped').
    let errored = false;
    for (const agent of terminal) {
      if (controller.signal.aborted) return 'aborted';
      if ((await pauseIfRequested()) === 'aborted') return 'aborted';
      const item: QueueItem = { agentId: agent.id, connectionId: null, sourceAgentId: null };
      // Retry loop without a queue: honor the failure policy inline (no re-queue).
      // Terminal kinds hold no control tools, so their TurnControl is inert.
      let attempt = await runAgentTurn(item, createNoopTurnControl());
      while (typeof attempt === 'object') {
        const decision = await handleFailedTurn(agent, policy, attempt.failedDetail, controller.signal);
        if (controller.signal.aborted) return 'aborted';
        if (decision === 'retry') {
          log('agent-queued', `Retrying "${agent.name}" at the user's request.`, agent.id);
          attempt = await runAgentTurn(item, createNoopTurnControl());
          continue;
        }
        // 'stop' marks the run errored but does not halt the remaining terminal
        // agents; 'skip'/'disable' just moves on.
        if (decision === 'stop') errored = true;
        break;
      }
      if (attempt === 'aborted') return 'aborted';
    }
    return errored ? 'stopped' : 'completed';
  };

  try {
    while (queue.length > 0) {
      if (controller.signal.aborted) break;

      // The in-flight turn always completes first; suspend at the boundary.
      if ((await pauseIfRequested()) === 'aborted') break;

      // Relative to startTurn so `maxTurns` bounds THIS invocation's turns, not
      // the absolute turn number (which continues from prior runs).
      if (useRuntimeStore.getState().currentTurn - startTurn >= maxTurns) {
        log('turn-limit', `Maximum total turns (${maxTurns}) reached.`);
        break;
      }

      const item = queue.shift()!;
      queued.delete(item.agentId);

      // Fresh per-turn control context; effects apply only if the turn succeeds
      // (a failed turn's effects — and their budget — are simply dropped, so a
      // retry can re-emit the same directed question without a dupe rejection).
      const turnAgent = agentsById.get(item.agentId);
      const ctrl = turnAgent
        ? createTurnControl({
            caller: turnAgent,
            itemDirectiveDepth: item.directive?.depth ?? 0,
            runBudget,
            agentsById,
            isDisabledForRun,
            responsesOf,
            responseLimitFor: (a) => responseLimitFor(a, pg),
          })
        : createNoopTurnControl();

      const outcome = await runAgentTurn(item, ctrl);
      if (outcome === 'aborted') break;
      if (outcome === 'skipped') continue;
      if (typeof outcome === 'object') {
        // Generation failed (already recorded). Apply the failure policy, which
        // may re-queue (retry), stop the run, or skip/disable and continue. A
        // directed item's directive rides along on the retry unchanged.
        const failedAgent = agentsById.get(item.agentId)!;
        if (item.directive) {
          log(
            'directed-question-dropped',
            `"${failedAgent.name}" failed while answering a directed question — the directive is dropped unless retried.`,
            failedAgent.id,
          );
        }
        const fo = await applyFailure(item, failedAgent, outcome.failedDetail);
        if (fo === 'abort') break;
        if (fo === 'stop') return finish(runId, 'error');
        continue;
      }

      // --- apply control effects at the turn boundary (spec extension) ---
      const agent = agentsById.get(item.agentId)!;
      const { suppressGraphEnqueue } = applyControlEffects({
        effects: ctrl.drain(),
        item,
        callerName: agent.name,
        queue,
        queued,
        runBudget,
        agentsById,
        log,
        onQueued: (id) => runtime.setAgentState(id, 'queued'),
      });

      // Reply routing (ask_agent round-trip): after the target answered, the
      // asker gets one follow-up turn with the answer in view, ahead of the
      // rest of the queue. Same guards as any dequeue (limits re-checked there).
      // An end-discussion emitted by this turn wins over the round-trip — the
      // queue stays drained.
      const replyTo = suppressGraphEnqueue ? undefined : item.directive?.replyToAgentId;
      if (replyTo) {
        const asker = agentsById.get(replyTo);
        if (
          asker &&
          asker.runtime.enabled &&
          !isDisabledForRun(asker.id) &&
          responsesOf(asker.id) < responseLimitFor(asker, pg)
        ) {
          promoteToFront(queue, queued, {
            agentId: asker.id,
            connectionId: null,
            sourceAgentId: agent.id,
            directive: {
              type: 'reply-return',
              fromAgentId: agent.id,
              fromName: agent.name,
              text: item.directive!.text,
              depth: item.directive!.depth,
            },
          });
          runtime.setAgentState(asker.id, 'queued');
          log('agent-queued', `"${asker.name}" resumes next with "${agent.name}"'s answer.`, asker.id);
        }
      }

      if (suppressGraphEnqueue) continue;

      // --- enqueue targets (spec §11.2 steps 3–5) ---
      for (const conn of outgoing(pg, agent.id)) {
        const target = agentsById.get(conn.target);
        if (!target) continue;
        // Terminal kinds (summarizer/finalizer) are never graph-scheduled — the
        // wrap-up phase runs them once, last. Edges into them are ignored here.
        if (isTerminalKind(target.kind)) continue;
        if (useRuntimeStore.getState().isAgentDisabledForRun(target.id)) continue; // removed this run
        const targetResponses = useRuntimeStore.getState().responsesPerAgent[target.id] ?? 0;
        if (targetResponses >= responseLimitFor(target, pg)) continue; // can't produce anyway
        if (queued.has(target.id)) continue; // duplicate-queue protection (spec §11.4)
        queue.push({ agentId: target.id, connectionId: conn.id, sourceAgentId: agent.id });
        queued.add(target.id);
        runtime.setAgentState(target.id, 'queued');
        log('agent-queued', `Queued "${target.name}" after "${agent.name}".`, target.id);
      }
    }

    // Wrap-up phase — engine-scheduled terminal kinds run after the discussion
    // ends by natural drain or turn-limit. Skipped when:
    //  - the caller opted out (retryAgentTurn: a surgical re-run, not a round),
    //  - a user Stop aborted the run, or
    //  - no substantive discussion happened (no completed turn to synthesize) —
    //    don't finalize over an empty/failed-only transcript.
    const hasCompletedTurn = useDomainStore
      .getState()
      .playground!.transcript.some((m) => m.status === 'completed');
    if (
      !opts.skipWrapUp &&
      hasCompletedTurn &&
      !controller.signal.aborted &&
      useRuntimeStore.getState().runId === runId &&
      useRuntimeStore.getState().status === 'running'
    ) {
      const wrapUp = await runWrapUpPhase();
      if (wrapUp === 'stopped') return finish(runId, 'error');
    }

    if (useRuntimeStore.getState().runId === runId && useRuntimeStore.getState().status === 'running') {
      finish(runId, 'completed');
    }
  } catch (err) {
    log('run-error', err instanceof Error ? err.message : 'Unknown run error.');
    finish(runId, 'error');
  } finally {
    // Only clear the active-agent highlight if this run is still the one the
    // store thinks is current — otherwise a stopped run's late cleanup could
    // stomp on a newer run's in-flight state (spec §19: one run at a time).
    if (useRuntimeStore.getState().runId === runId) {
      useRuntimeStore.getState().setActive(null, null);
    }
    await finalizeVersionedRun(runId);
  }
}

function recordFailure(
  agent: Agent,
  turn: number,
  messageId: string,
  item: QueueItem,
  detail: string,
  level: 'agent' | 'run',
  providerName?: string,
  pe?: ProviderError,
  /** Tool calls already executed this turn, kept on the failed row for inspection. */
  toolTrace?: ToolTraceEntry[],
) {
  const runtime = useRuntimeStore.getState();
  runtime.setAgentState(agent.id, 'failed');
  runtime.addError({
    id: newErrorId(),
    level,
    agentId: agent.id,
    summary: `${agent.name} failed`,
    detail,
    provider: providerName,
    at: Date.now(),
    retryEligible: pe ? retryEligible(pe.kind) : false,
    errorKind: pe?.kind,
  });
  useDomainStore.getState().appendTranscript({
    id: messageId,
    turn,
    agentId: agent.id,
    agentName: agent.name,
    agentDeleted: false,
    role: agent.role,
    language: agent.language,
    model: agent.llm.model,
    providerId: agent.llm.providerId,
    content: '',
    toolTrace: toolTrace && toolTrace.length > 0 ? toolTrace : undefined,
    status: 'failed',
    sourceAgentId: item.sourceAgentId,
    connectionType: null,
    timestamp: Date.now(),
    error: detail,
  });
  log('request-failed', `"${agent.name}" failed: ${detail}`, agent.id);
}

type FailureOutcome = 'stop' | 'skip' | 'retry';

/**
 * Decide what happens after an agent's turn failed (the failure was already
 * recorded). Escalates on repeated failures and applies the run's failure
 * policy (spec extension: flow control):
 *
 *  1. Count the agent's consecutive post-retry failures (reset on any success).
 *  2. If the auto-disable threshold is reached, remove the agent from the
 *     circuit for the rest of this run — the headline "kept-failing agent gets
 *     pulled out" case — and keep the run going (returns 'skip').
 *  3. Otherwise apply `onFailure`: 'prompt' pauses for a user decision
 *     (abort-safe — a Stop resolves it to 'stop'); 'skip' drops the turn;
 *     'stop' ends the run.
 *
 * Returning 'skip' when a disable drains the queue simply lets the run end
 * naturally (`completed`).
 */
async function handleFailedTurn(
  agent: Agent,
  policy: FailurePolicy,
  detail: string,
  signal: AbortSignal,
): Promise<FailureOutcome> {
  const runtime = useRuntimeStore.getState();
  const streak = runtime.bumpConsecutiveFailures(agent.id);
  const thresholdReached =
    policy.autoDisableAfterFailures > 0 && streak >= policy.autoDisableAfterFailures;

  const autoDisable = () => {
    runtime.disableAgentForRun(agent.id);
    runtime.setAgentState(agent.id, 'disabled'); // grey the node in the graph
    log(
      'agent-auto-disabled',
      `Removed "${agent.name}" from the circuit after ${streak} consecutive failures.`,
      agent.id,
    );
    useUiStore
      .getState()
      .showToast('warn', `"${agent.name}" removed from the run after repeated failures.`);
  };

  if (policy.onFailure === 'prompt') {
    const decision = await useUiStore.getState().requestFailureDecision(
      {
        agentName: agent.name,
        errorSummary: detail,
        consecutiveFailures: streak,
        suggestDisable: thresholdReached,
      },
      signal,
    );
    switch (decision) {
      case 'disable':
        autoDisable();
        return 'skip';
      case 'retry':
        return 'retry';
      case 'skip':
        return 'skip';
      case 'stop':
      default:
        return 'stop';
    }
  }

  if (thresholdReached) {
    autoDisable();
    return 'skip';
  }
  return policy.onFailure === 'skip' ? 'skip' : 'stop';
}

/** Truncated JSON of the raw provider response for the inspector (spec §13.3). */
function safeExcerpt(raw: unknown): string | undefined {
  try {
    return JSON.stringify(raw).slice(0, 4000);
  } catch {
    return undefined;
  }
}

type SnapshotBase = Pick<
  RequestSnapshot,
  'url' | 'providerName' | 'model' | 'messages' | 'params'
>;

/** Sanitized failure snapshot with prompt size and structured provider error fields. */
function buildFailureSnapshot(
  base: SnapshotBase,
  pe: ProviderError,
  messages: ChatMessage[],
  partialOutputChars: number,
): RequestSnapshot {
  const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  return {
    ...base,
    status: pe.status,
    error: formatProviderErrorDetail(pe),
    errorKind: pe.kind,
    errorType: pe.errorType,
    rawUpstream: pe.rawUpstream,
    streamedError: pe.streamed,
    promptMessages: messages.length,
    promptChars,
    ...(partialOutputChars > 0 ? { partialOutputChars } : {}),
  };
}

function finish(runId: string, status: 'completed' | 'error') {
  const runtime = useRuntimeStore.getState();
  // A stale/aborted run's tail must never overwrite a newer run's state.
  if (runtime.runId !== runId) return;
  runtime.setStatus(status);
  runtime.setActive(null, null);
  log(status === 'completed' ? 'run-completed' : 'run-error', `Run ${status}.`);
}

/**
 * Safety margin on the prompt-token estimate for budget gating. `estimateTokens`
 * (chars/4) systematically under-counts for CJK/code — where real tokens can run
 * 2-4× higher — so the raw estimate lets a run slip past its cap and overshoot
 * silently. Inflating the prompt side makes the gate stop early rather than
 * overshoot (it cannot eliminate overshoot for extreme CJK, but bounds it).
 */
const PROMPT_ESTIMATE_SAFETY = 1.3;

function estimateRequestTokens(messages: ChatMessage[], maxOutputTokens: number): number {
  const prompt = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  // Budget conservatively: inflate the prompt estimate and assume the model may
  // use up to maxOutputTokens on the output side.
  return Math.ceil(prompt * PROMPT_ESTIMATE_SAFETY) + maxOutputTokens;
}

async function recordCallUsage(opts: {
  response: NormalizedResponse;
  messages: ChatMessage[];
  provider: Provider;
  model: string;
  playgroundId: string;
  runId: string;
  fallback: boolean;
}): Promise<void> {
  const hasReal =
    opts.response.promptTokens != null ||
    opts.response.completionTokens != null ||
    opts.response.totalTokens != null;
  const promptTokens =
    opts.response.promptTokens ??
    opts.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  const completionTokens =
    opts.response.completionTokens ?? estimateTokens(opts.response.text || '');
  const totalTokens =
    opts.response.totalTokens ?? promptTokens + completionTokens;

  useRuntimeStore.getState().addRunTokens(totalTokens, opts.fallback);
  await useUsageStore.getState().recordUsage({
    playgroundId: opts.playgroundId,
    runId: opts.runId,
    providerId: opts.provider.id,
    providerName: opts.provider.displayName,
    model: opts.model,
    promptTokens,
    completionTokens,
    totalTokens,
    estimated: !hasReal,
    fallback: opts.fallback,
  });
}

/**
 * Send a chat call after budget checks. On suggestable provider failure, pause
 * for a user-confirmed temporary fallback and retry once. Returns null when the
 * failure was recorded and the caller should stop/continue the run loop.
 */
async function callWithBudgetAndOptionalFallback(opts: {
  agent: Agent;
  provider: Provider;
  providersById: Map<string, Provider>;
  chatParams: {
    model: string;
    messages: ChatMessage[];
    temperature: number;
    maxOutputTokens: number;
    topP?: number;
    seed?: number;
    stopSequences?: string[];
  };
  messages: ChatMessage[];
  controller: AbortController;
  effectiveTimeoutMs: number;
  isFallback: boolean;
  runId: string;
  playgroundId: string;
  messageId: string;
  snapshotBase: {
    url: string;
    providerName: string;
    model: string;
    messages: ChatMessage[];
    params: Record<string, unknown>;
  };
  item: QueueItem;
  turnNumber: number;
  policy: FailurePolicy;
}): Promise<{ response: NormalizedResponse; provider: Provider; fallback: boolean } | null> {
  const usage = useUsageStore.getState();
  const runtime = useRuntimeStore.getState();
  const estimatedTokens = estimateRequestTokens(opts.messages, opts.chatParams.maxOutputTokens);
  const snap = buildBudgetSnapshot(usage.budget, {
    runTokens: runtime.runTokens,
    runFallbackTokens: runtime.runFallbackTokens,
    dayTokens: usage.dayTokens(),
  });
  assertWithinBudget(usage.budget, snap, {
    estimatedTokens,
    isFallback: opts.isFallback,
  });

  try {
    // Auto-retry transient failures silently before surfacing anything. Each
    // re-attempt clears the partial stream buffer so retried tokens don't stack.
    const response = await withAutoRetry(
      () =>
        sendChat(opts.provider, opts.chatParams, {
          signal: opts.controller.signal,
          timeoutMs: opts.effectiveTimeoutMs,
          onToken: (chunk) => useRuntimeStore.getState().appendToken(opts.agent.id, chunk),
          onReasoningToken: (chunk) =>
            useRuntimeStore.getState().appendReasoningToken(opts.agent.id, chunk),
        }),
      {
        policy: opts.policy,
        signal: opts.controller.signal,
        agentId: opts.agent.id,
        agentName: opts.agent.name,
        onBeforeRetry: () => useRuntimeStore.getState().clearStreaming(opts.agent.id),
      },
    );
    useRuntimeStore.getState().recordSnapshot(opts.messageId, {
      ...opts.snapshotBase,
      status: response.status,
      finishReason: response.finishReason,
      rawExcerpt: safeExcerpt(response.raw),
    });
    return { response, provider: opts.provider, fallback: opts.isFallback };
  } catch (err) {
    const partialOutputChars =
      useRuntimeStore.getState().streamingText[opts.agent.id]?.length ?? 0;
    useRuntimeStore.getState().clearStreaming(opts.agent.id);
    if (opts.controller.signal.aborted) throw err;

    const pe = err instanceof ProviderError ? err : new ProviderError('unknown', summaryFor('unknown'));

    // Suggest-only: offer another provider when the primary looks unreachable
    // and we are not already on a fallback override for this agent.
    if (!opts.isFallback && isSuggestableFailure(pe.kind)) {
      const candidates = listFallbackCandidates(
        [...opts.providersById.values()],
        opts.provider.id,
      );
      if (candidates.length > 0) {
        const budget = buildBudgetSnapshot(useUsageStore.getState().budget, {
          runTokens: useRuntimeStore.getState().runTokens,
          runFallbackTokens: useRuntimeStore.getState().runFallbackTokens,
          dayTokens: useUsageStore.getState().dayTokens(),
        });
        log(
          'fallback-suggested',
          `Suggesting temporary provider switch after "${opts.provider.displayName}" failed.`,
          opts.agent.id,
        );
        const choice = await useUiStore.getState().requestFallbackSuggestion(
          {
            agentName: opts.agent.name,
            failedProviderName: opts.provider.displayName,
            failedModel: opts.chatParams.model,
            errorSummary: formatProviderErrorDetail(pe),
            candidates,
            budget,
          },
          opts.controller.signal,
        );
        if (choice) {
          const fbProvider = opts.providersById.get(choice.providerId);
          if (fbProvider) {
            useRuntimeStore.getState().setProviderOverride(opts.agent.id, choice);
            log(
              'fallback-accepted',
              `Using "${fbProvider.displayName}" / ${choice.model} for the rest of this run.`,
              opts.agent.id,
            );
            const fbSnap = buildBudgetSnapshot(useUsageStore.getState().budget, {
              runTokens: useRuntimeStore.getState().runTokens,
              runFallbackTokens: useRuntimeStore.getState().runFallbackTokens,
              dayTokens: useUsageStore.getState().dayTokens(),
            });
            assertWithinBudget(useUsageStore.getState().budget, fbSnap, {
              estimatedTokens,
              isFallback: true,
            });
            const fbParams = { ...opts.chatParams, model: choice.model };
            const fbSnapshotBase = {
              ...opts.snapshotBase,
              url: buildEndpoint(fbProvider.baseUrl, fbProvider.path),
              providerName: fbProvider.displayName,
              model: choice.model,
            };
            try {
              const response = await sendChat(fbProvider, fbParams, {
                signal: opts.controller.signal,
                timeoutMs: opts.effectiveTimeoutMs,
                onToken: (chunk) => useRuntimeStore.getState().appendToken(opts.agent.id, chunk),
                onReasoningToken: (chunk) =>
                  useRuntimeStore.getState().appendReasoningToken(opts.agent.id, chunk),
              });
              useRuntimeStore.getState().recordSnapshot(opts.messageId, {
                ...fbSnapshotBase,
                status: response.status,
                finishReason: response.finishReason,
                rawExcerpt: safeExcerpt(response.raw),
              });
              return { response, provider: fbProvider, fallback: true };
            } catch (retryErr) {
              if (opts.controller.signal.aborted) throw retryErr;
              const rpe =
                retryErr instanceof BudgetExceededError
                  ? new ProviderError('bad-request', retryErr.message)
                  : retryErr instanceof ProviderError
                    ? retryErr
                    : new ProviderError('unknown', summaryFor('unknown'));
              const fbPartial =
                useRuntimeStore.getState().streamingText[opts.agent.id]?.length ?? 0;
              useRuntimeStore.getState().clearStreaming(opts.agent.id);
              const detail = formatProviderErrorDetail(rpe);
              useRuntimeStore.getState().recordSnapshot(
                opts.messageId,
                buildFailureSnapshot(fbSnapshotBase, rpe, opts.messages, fbPartial),
              );
              recordFailure(
                opts.agent,
                opts.turnNumber,
                opts.messageId,
                opts.item,
                detail,
                'agent',
                fbProvider.displayName,
                rpe,
              );
              return null;
            }
          }
        }
      }
    }

    if (err instanceof BudgetExceededError) {
      const detail = err.message;
      useRuntimeStore.getState().recordSnapshot(opts.messageId, {
        ...opts.snapshotBase,
        error: detail,
        errorKind: 'bad-request',
        promptMessages: opts.messages.length,
        promptChars: opts.messages.reduce((sum, m) => sum + m.content.length, 0),
      });
      recordFailure(opts.agent, opts.turnNumber, opts.messageId, opts.item, detail, 'run', opts.provider.displayName);
      return null;
    }

    const detail = formatProviderErrorDetail(pe);
    useRuntimeStore.getState().recordSnapshot(
      opts.messageId,
      buildFailureSnapshot(opts.snapshotBase, pe, opts.messages, partialOutputChars),
    );
    recordFailure(
      opts.agent,
      opts.turnNumber,
      opts.messageId,
      opts.item,
      detail,
      'agent',
      opts.provider.displayName,
      pe,
    );
    return null;
  }
}
