import type { Agent, Connection, Playground, TranscriptMessage } from '../domain/schema';
import { newLogId, newMessageId, newRunId } from '../domain/ids';
import { useDomainStore } from '../store/domainStore';
import { useRuntimeStore } from '../store/runtimeStore';
import { ProviderError, retryEligible, summaryFor } from '../providers/errors';
import { sendChat } from '../providers/openaiAdapter';
import { buildEndpoint } from '../providers/url';
import type { ChatMessage } from '../providers/types';
import { assembleMessages, boundHistory } from '../agents/promptAssembly';

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

export function stopRun(): void {
  const runtime = useRuntimeStore.getState();
  if (runtime.status !== 'running') return;
  runtime.abortController?.abort(new DOMException('Run stopped by user', 'AbortError'));
  runtime.setStatus('stopped');
  runtime.setActive(null, null);
  log('execution-stopped', 'Run stopped by user.');
}

export async function startRun(): Promise<void> {
  const domain = useDomainStore.getState();
  const runtime = useRuntimeStore.getState();
  const pg = domain.playground;
  if (!pg) return;
  if (runtime.status === 'running') return; // one run at a time (spec §19)

  // Snapshot structure — the graph is locked during a run (spec §10.3), so agents,
  // connections and providers won't change under us. Transcript still appends live.
  const agentsById = new Map(pg.agents.map((a) => [a.id, a]));
  const providersById = new Map(pg.providers.map((p) => [p.id, p]));

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
        if (pg.conversation.stopOnError) return finish('error');
        continue;
      }

      const liveTranscript = useDomainStore.getState().playground!.transcript;
      const history = boundHistory(liveTranscript, agent.runtime.historyWindow);
      // The source agent's most recent output, always available to review/handoff
      // targets regardless of the history window (spec §12).
      const sourceOutput = item.sourceAgentId
        ? [...liveTranscript]
            .reverse()
            .find((m) => m.agentId === item.sourceAgentId && m.content)?.content ?? null
        : null;
      const messages = assembleMessages({
        agent,
        conversation: pg.conversation,
        history,
        incoming: connection,
        sourceAgentName: sourceName,
        sourceOutput,
        isFirstTurn: turnNumber === 1,
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
          model: res.model,
          providerId: provider.id,
          content: res.text,
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
        if (pg.conversation.stopOnError) return finish('error');
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

    if (useRuntimeStore.getState().status === 'running') finish('completed');
  } catch (err) {
    log('run-error', err instanceof Error ? err.message : 'Unknown run error.');
    finish('error');
  } finally {
    useRuntimeStore.getState().setActive(null, null);
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

function finish(status: 'completed' | 'error') {
  const runtime = useRuntimeStore.getState();
  runtime.setStatus(status);
  runtime.setActive(null, null);
  log(status === 'completed' ? 'run-completed' : 'run-error', `Run ${status}.`);
}
