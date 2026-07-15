import type { Agent, Connection, Playground, TranscriptMessage } from '../domain/schema';
import { newErrorId, newLogId, newMessageId, newRunId } from '../domain/ids';
import { useDomainStore } from '../store/domainStore';
import { useProviderStore } from '../store/providerStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { ProviderError, retryEligible, summaryFor } from '../providers/errors';
import { sendChat } from '../providers/openaiAdapter';
import { buildEndpoint } from '../providers/url';
import type { ChatMessage } from '../providers/types';
import { assembleMessages, boundHistory } from '../agents/promptAssembly';
import { hasBlockingErrors, validateForRun } from './validate';

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

/** Most recent non-empty message from `sourceAgentId`, walked backwards in place. */
function findLastSourceOutput(
  transcript: TranscriptMessage[],
  sourceAgentId: string | null,
): string | null {
  if (!sourceAgentId) return null;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const m = transcript[i];
    if (m.agentId === sourceAgentId && m.content) return m.content;
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

  const controller = new AbortController();
  const runId = newRunId();
  runtime.startRun(runId, controller);
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

      const provider = providersById.get(agent.llm.providerId ?? '');
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
      const chatParams = {
        model: agent.llm.model,
        messages,
        temperature: agent.llm.temperature,
        maxOutputTokens: agent.llm.maxOutputTokens,
        topP: agent.llm.topP,
        seed: agent.llm.seed,
        stopSequences: agent.llm.stopSequences,
      };
      const snapshotBase = {
        url: buildEndpoint(provider.baseUrl, provider.path),
        providerName: provider.displayName,
        model: agent.llm.model,
        messages: messages as ChatMessage[],
        params: {
          temperature: agent.llm.temperature,
          maxOutputTokens: agent.llm.maxOutputTokens,
          topP: agent.llm.topP,
          seed: agent.llm.seed,
          stopSequences: agent.llm.stopSequences,
        },
      };

      try {
        const res = await sendChat(provider, chatParams, {
          signal: controller.signal,
          timeoutMs: agent.runtime.responseTimeoutMs,
          onToken: (chunk) => useRuntimeStore.getState().appendToken(agent.id, chunk),
        });

        useRuntimeStore.getState().recordSnapshot(messageId, {
          ...snapshotBase,
          status: res.status,
          finishReason: res.finishReason,
          rawExcerpt: safeExcerpt(res.raw),
        });

        const message: TranscriptMessage = {
          id: messageId,
          turn: turnNumber,
          agentId: agent.id,
          agentName: agent.name,
          agentDeleted: false,
          role: agent.role,
          language: agent.language,
          model: res.model,
          providerId: provider.id,
          // Reasoning models sometimes emit their whole reply as
          // `reasoning_content` deltas and leave `content` empty; fall back
          // to the reasoning text so the turn isn't rendered blank.
          content: res.text || res.reasoning,
          status: 'completed',
          sourceAgentId: item.sourceAgentId,
          connectionType: connection?.type ?? null,
          timestamp: Date.now(),
          durationMs: res.durationMs,
          promptTokens: res.promptTokens,
          completionTokens: res.completionTokens,
          totalTokens: res.totalTokens,
        };
        useDomainStore.getState().appendTranscript(message);
        useRuntimeStore.getState().clearStreaming(agent.id); // final message replaces the live buffer
        useRuntimeStore.getState().incAgentResponses(agent.id);
        runtime.setAgentState(agent.id, 'completed');
        log('request-completed', `"${agent.name}" responded in ${res.durationMs}ms.`, agent.id);
      } catch (err) {
        useRuntimeStore.getState().clearStreaming(agent.id); // drop the partial live buffer
        if (controller.signal.aborted) {
          // Stop was pressed; leave the loop quietly (status already 'stopped').
          break;
        }
        const pe = err instanceof ProviderError ? err : new ProviderError('unknown', summaryFor('unknown'));
        const detail = `${pe.message}${pe.detail ? ` (${pe.detail})` : ''}`;
        useRuntimeStore.getState().recordSnapshot(messageId, {
          ...snapshotBase,
          status: pe.status,
          error: detail,
        });
        recordFailure(agent, turnNumber, messageId, item, detail, 'agent', provider.displayName, pe);
        if (pg.conversation.stopOnError) return finish(runId, 'error');
        continue; // skip enqueuing this agent's targets on failure
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

function finish(runId: string, status: 'completed' | 'error') {
  const runtime = useRuntimeStore.getState();
  // A stale/aborted run's tail must never overwrite a newer run's state.
  if (runtime.runId !== runId) return;
  runtime.setStatus(status);
  runtime.setActive(null, null);
  log(status === 'completed' ? 'run-completed' : 'run-error', `Run ${status}.`);
}
