import type { ConversationRun, ConversationRunStatus, Playground } from '../domain/schema';
import { getRun } from '../persistence/db';
import { useDomainStore } from '../store/domainStore';
import { useRuntimeStore, type RunStatus } from '../store/runtimeStore';
import { nextRunMeta, persistRunDraft, persistRunFinal } from '../store/runHistoryStore';

function toRunStatus(status: RunStatus): ConversationRunStatus {
  // Transient runtime-only states — never persisted as-is (spec §16).
  if (status === 'idle' || status === 'paused') return 'interrupted';
  return status;
}

/** Create and persist a draft run record at the start of startRun(). */
export async function beginVersionedRun(pg: Playground, runId: string): Promise<void> {
  const { version, parentRunId } = await nextRunMeta(pg.id);
  const run: ConversationRun = {
    id: runId,
    playgroundId: pg.id,
    version,
    parentRunId,
    startedAt: Date.now(),
    endedAt: null,
    status: 'running',
    conversation: { ...pg.conversation },
    transcript: [...pg.transcript],
    events: [],
    messageCountAtStart: pg.transcript.length,
  };
  await persistRunDraft(run);
}

/** Snapshot transcript and events when a run settles. */
export async function finalizeVersionedRun(runId: string): Promise<void> {
  const runtime = useRuntimeStore.getState();
  if (runtime.runId !== runId) return;

  const pg = useDomainStore.getState().playground;
  if (!pg) return;

  const existing = await getRun(runId);
  if (!existing) return;

  const finalized: ConversationRun = {
    ...existing,
    endedAt: Date.now(),
    status: toRunStatus(runtime.status),
    transcript: [...pg.transcript],
    events: runtime.events.map((e) => ({
      id: e.id,
      at: e.at,
      kind: e.kind,
      message: e.message,
      agentId: e.agentId,
    })),
  };
  await persistRunFinal(finalized);
}
