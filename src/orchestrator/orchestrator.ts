import type { Agent, Connection, Playground, Provider, TranscriptMessage } from '../domain/schema';
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
import { hasBlockingErrors, validateForRun } from './validate';
import { beginVersionedRun, finalizeVersionedRun } from './runHistory';
import {
  assertWithinBudget,
  BudgetExceededError,
  buildBudgetSnapshot,
} from '../usage/budget';
import { isSuggestableFailure, listFallbackCandidates } from '../usage/fallback';

/**
 * Conversation orchestrator (spec §11). Directed sequential traversal of the
 * agent graph with hard cycle controls. One run at a time; a single
 * AbortController cancels the in-flight request and the loop (spec §14).
 */

interface QueueItem {
  agentId: string;
  connectionId: string | null;
  sourceAgentId: string | null;
}

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
 * Most recent user-authored message (see continueRun), walked backwards in
 * place. Kept as an explicit, always-surfaced instruction — not just a line
 * inside the bounded/gated history — so it stays authoritative for every
 * agent turn for the rest of the conversation, however many turns later.
 */
function findLastUserDirective(transcript: TranscriptMessage[]): string | null {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i];
    if (m.agentId === null && m.role === 'user' && m.content) return m.content;
  }
  return null;
}

export function stopRun(): void {
  const runtime = useRuntimeStore.getState();
  if (runtime.status !== 'running') return;
  runtime.abortController?.abort(new DOMException('Run stopped by user', 'AbortError'));
  runtime.setStatus('stopped');
  runtime.setActive(null, null);
  log('execution-stopped', 'Run stopped by user.');
}

/**
 * Continue a finished (or stopped) run with a new user message: appends it to
 * the transcript as a user turn, then re-enters the graph from the starting
 * agent so agents pick up the discussion with the user's input in view (spec
 * §11.6 — the fresh message is just more history, surfaced to every agent via
 * assembleMessages). No-op while a run is already in progress.
 */
export function continueRun(userMessage: string): void {
  const domain = useDomainStore.getState();
  const pg = domain.playground;
  if (!pg) return;
  if (useRuntimeStore.getState().status === 'running') return;

  const trimmed = userMessage.trim();
  if (!trimmed) return;

  const providers = useProviderStore.getState().providers;
  if (hasBlockingErrors(validateForRun(pg, providers))) return;

  domain.appendTranscript({
    id: newMessageId(),
    turn: 0,
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
    timestamp: Date.now(),
  });

  void startRun();
}

export async function startRun(): Promise<void> {
  const domain = useDomainStore.getState();
  const runtime = useRuntimeStore.getState();
  const pg = domain.playground;
  if (!pg) return;
  if (runtime.status === 'running') return; // one run at a time (spec §19)

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
  runtime.startRun(runId, controller);
  await beginVersionedRun(pg, runId);
  log('run-started', `Run started on subject: ${pg.conversation.subject || '(none)'}`);

  const startId = pg.conversation.startingAgentId!;
  const queue: QueueItem[] = [{ agentId: startId, connectionId: null, sourceAgentId: null }];
  const queued = new Set<string>([startId]);
  runtime.setAgentState(startId, 'queued');

  const maxTurns = pg.conversation.maxTotalTurns;

  try {
    while (queue.length > 0) {
      if (controller.signal.aborted) break;
      if (useRuntimeStore.getState().currentTurn >= maxTurns) {
        log('turn-limit', `Maximum total turns (${maxTurns}) reached.`);
        break;
      }

      const item = queue.shift()!;
      queued.delete(item.agentId);
      const agent = agentsById.get(item.agentId);
      if (!agent || !agent.runtime.enabled) {
        log('agent-skipped', `Agent skipped (missing or disabled).`, item.agentId);
        continue;
      }

      const already = useRuntimeStore.getState().responsesPerAgent[agent.id] ?? 0;
      if (already >= responseLimitFor(agent, pg)) {
        log('agent-skipped', `Agent "${agent.name}" reached its response limit.`, agent.id);
        continue;
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
        recordFailure(agent, turnNumber, newMessageId(), item, 'No provider configured for this agent.', 'run');
        if (pg.conversation.stopOnError) return finish(runId, 'error');
        continue;
      }

      const liveTranscript = useDomainStore.getState().playground!.transcript;
      const history = boundHistory(liveTranscript, agent.runtime.historyWindow);
      // The source agent's most recent output, always available to review/handoff
      // targets regardless of the history window (spec §12). Walked backwards
      // in place rather than cloning+reversing the whole transcript every turn
      // (which would be O(n) per turn, O(n²) over a long conversation).
      const sourceOutput = findLastSourceOutput(liveTranscript, item.sourceAgentId);
      const pendingUserDirective = findLastUserDirective(liveTranscript);
      const messages = assembleMessages({
        agent,
        conversation: pg.conversation,
        history,
        incoming: connection,
        sourceAgentName: sourceName,
        sourceOutput,
        pendingUserDirective,
        // "Opening" framing only fits a genuinely empty transcript. Turn 1 of
        // a run that continues an existing transcript (see continueRun) must
        // still see itself as replying within an ongoing discussion.
        isFirstTurn: liveTranscript.length === 0,
      });

      // Pre-generate the id so the request snapshot (spec §13.3) and the
      // transcript message share a key. The snapshot carries NO credentials.
      const messageId = newMessageId();
      // Run-level override: takes precedence over the agent's own sampling
      // temperature for this conversation only (null means "no override").
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

      try {
        const res = await callWithBudgetAndOptionalFallback({
          agent,
          provider,
          providersById,
          chatParams,
          messages,
          controller,
          effectiveTimeoutMs,
          isFallback,
          runId,
          playgroundId: pg.id,
          messageId,
          snapshotBase,
          item,
          turnNumber,
        });
        if (!res) {
          // Failure already recorded; stop or continue based on stopOnError.
          if (pg.conversation.stopOnError) return finish(runId, 'error');
          continue;
        }

        const usedProvider = res.provider;
        const usedFallback = res.fallback;
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
          // Keep thinking out of the visible transcript body (thinking is hidden
          // by default behind the chip). Reasoning-only turns leave content empty.
          content: res.response.text || '',
          reasoning: res.response.reasoning || undefined,
          status: 'completed',
          sourceAgentId: item.sourceAgentId,
          connectionType: connection?.type ?? null,
          timestamp: Date.now(),
          durationMs: res.response.durationMs,
          promptTokens: res.response.promptTokens,
          completionTokens: res.response.completionTokens,
          totalTokens: res.response.totalTokens,
        };
        useDomainStore.getState().appendTranscript(message);
        useRuntimeStore.getState().clearStreaming(agent.id);
        useRuntimeStore.getState().incAgentResponses(agent.id);
        runtime.setAgentState(agent.id, 'completed');
        log(
          'request-completed',
          `"${agent.name}" responded in ${res.response.durationMs}ms` +
            (usedFallback ? ' (fallback provider).' : '.'),
          agent.id,
        );
        void recordCallUsage({
          response: res.response,
          messages,
          provider: usedProvider,
          model: res.response.model || model,
          playgroundId: pg.id,
          runId,
          fallback: usedFallback,
        });
      } catch (err) {
        const partialOutputChars =
          useRuntimeStore.getState().streamingText[agent.id]?.length ?? 0;
        useRuntimeStore.getState().clearStreaming(agent.id);
        if (controller.signal.aborted) break;
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
        recordFailure(agent, turnNumber, messageId, item, detail, 'agent', provider.displayName, pe);
        if (pg.conversation.stopOnError) return finish(runId, 'error');
        continue;
      }

      // --- enqueue targets (spec §11.2 steps 3–5) ---
      for (const conn of outgoing(pg, agent.id)) {
        const target = agentsById.get(conn.target);
        if (!target) continue;
        const targetResponses = useRuntimeStore.getState().responsesPerAgent[target.id] ?? 0;
        if (targetResponses >= responseLimitFor(target, pg)) continue; // can't produce anyway
        if (queued.has(target.id)) continue; // duplicate-queue protection (spec §11.4)
        queue.push({ agentId: target.id, connectionId: conn.id, sourceAgentId: agent.id });
        queued.add(target.id);
        runtime.setAgentState(target.id, 'queued');
        log('agent-queued', `Queued "${target.name}" after "${agent.name}".`, target.id);
      }
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
    status: 'failed',
    sourceAgentId: item.sourceAgentId,
    connectionType: null,
    timestamp: Date.now(),
    error: detail,
  });
  log('request-failed', `"${agent.name}" failed: ${detail}`, agent.id);
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

function estimateRequestTokens(messages: ChatMessage[], maxOutputTokens: number): number {
  const prompt = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  // Budget conservatively: assume the model may use up to maxOutputTokens.
  return prompt + maxOutputTokens;
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
    const response = await sendChat(opts.provider, opts.chatParams, {
      signal: opts.controller.signal,
      timeoutMs: opts.effectiveTimeoutMs,
      onToken: (chunk) => useRuntimeStore.getState().appendToken(opts.agent.id, chunk),
      onReasoningToken: (chunk) =>
        useRuntimeStore.getState().appendReasoningToken(opts.agent.id, chunk),
    });
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
        const choice = await useUiStore.getState().requestFallbackSuggestion({
          agentName: opts.agent.name,
          failedProviderName: opts.provider.displayName,
          failedModel: opts.chatParams.model,
          errorSummary: formatProviderErrorDetail(pe),
          candidates,
          budget,
        });
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
