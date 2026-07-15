import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../persistence/db', () => import('../../test/persistenceDbMock'));

import { clearPersistenceMocks } from '../../test/persistenceDbMock';

import { createAgent, createPlayground, createProvider } from '../../domain/factories';
import type { Agent, Playground } from '../../domain/schema';
import { useDomainStore } from '../../store/domainStore';
import { useProviderStore } from '../../store/providerStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { retryAgentTurn, startRun, stopRun } from '../orchestrator';

function okChat() {
  return new Response(
    JSON.stringify({
      model: 'test',
      choices: [{ message: { role: 'assistant', content: 'response' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

/** Classify a captured request by the kind directive baked into its system prompt. */
function requestKind(init: RequestInit | undefined): string {
  const body = typeof init?.body === 'string' ? init.body : '';
  const sys = (JSON.parse(body).messages?.[0]?.content ?? '') as string;
  if (sys.includes('You are the finalizer')) return 'finalizer';
  if (sys.includes('You are the summarizer')) return 'summarizer';
  if (sys.includes('You are the moderator')) return 'moderator';
  return 'participant';
}

/** The history entries (peer turns) rendered into a request body, e.g. "[A]: response". */
function historyLabels(init: RequestInit | undefined): string[] {
  const body = typeof init?.body === 'string' ? init.body : '';
  const messages = (JSON.parse(body).messages ?? []) as { role: string; content: string }[];
  return messages
    .map((m) => /^\[([^\]]+)\]:/.exec(m.content)?.[1])
    .filter((v): v is string => Boolean(v));
}

interface Built {
  pg: Playground;
  a: Agent;
  b: Agent;
  summarizer: Agent;
  finalizer: Agent;
}

/**
 * A↔B participants (cyclic when `cycle`), plus one summarizer and one finalizer.
 * The finalizer carries an incoming edge from B so we can prove it is NOT
 * graph-scheduled (it must still run exactly once, in wrap-up).
 */
function buildPlayground(opts: { cycle: boolean; maxTurns: number }): Built {
  const pg = createPlayground('Test');
  const provider = createProvider({
    displayName: 'Local',
    baseUrl: 'http://localhost:11434',
    authMethod: 'none',
    models: ['test'],
  });
  const llm = { ...createAgent().llm, providerId: provider.id, model: 'test' };
  const a = createAgent({ name: 'A', role: 'r', systemInstruction: 'do', llm });
  const b = createAgent({ name: 'B', role: 'r', systemInstruction: 'do', llm });
  const summarizer = createAgent({ name: 'S', role: 'r', systemInstruction: 'do', kind: 'summarizer', llm });
  const finalizer = createAgent({ name: 'F', role: 'r', systemInstruction: 'do', kind: 'finalizer', llm });

  useProviderStore.setState({ providers: [provider] });
  pg.agents.push(a, b, summarizer, finalizer);
  pg.connections.push({ id: 'c1', source: a.id, target: b.id, enabled: true, type: 'conversation', priority: 0 });
  if (opts.cycle) {
    pg.connections.push({ id: 'c2', source: b.id, target: a.id, enabled: true, type: 'conversation', priority: 0 });
  }
  // Decorative edge into the finalizer — must be ignored for scheduling.
  pg.connections.push({ id: 'c3', source: b.id, target: finalizer.id, enabled: true, type: 'handoff', priority: 0 });
  pg.conversation = {
    ...pg.conversation,
    subject: 'topic',
    startingAgentId: a.id,
    maxTotalTurns: opts.maxTurns,
    maxResponsesPerAgent: 10,
  };
  return { pg, a, b, summarizer, finalizer };
}

beforeEach(() => {
  useRuntimeStore.getState().reset();
  useProviderStore.setState({ providers: [] });
  clearPersistenceMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('agent-kind wrap-up phase', () => {
  it('runs the finalizer last, exactly once, after a natural drain', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(okChat())));
    const { pg, finalizer } = buildPlayground({ cycle: false, maxTurns: 50 });
    useDomainStore.setState({ playground: pg });

    await startRun();

    const transcript = useDomainStore.getState().playground!.transcript;
    expect(useRuntimeStore.getState().status).toBe('completed');
    // Finalizer speaks exactly once despite its incoming graph edge...
    expect(transcript.filter((m) => m.agentId === finalizer.id)).toHaveLength(1);
    // ...and it is the very last message.
    expect(transcript[transcript.length - 1].agentId).toBe(finalizer.id);
  });

  it('still runs the finalizer last when the turn limit is hit mid-discussion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(okChat())));
    // A↔B cycle with a tight turn cap: discussion is cut off by the limit, not drain.
    const { pg, a, b, summarizer, finalizer } = buildPlayground({ cycle: true, maxTurns: 2 });
    useDomainStore.setState({ playground: pg });

    await startRun();

    const transcript = useDomainStore.getState().playground!.transcript;
    // Two discussion turns (A, B) capped by maxTurns, then wrap-up S, F.
    const ids = transcript.map((m) => m.agentId);
    expect(ids.slice(0, 2)).toEqual([a.id, b.id]);
    expect(transcript[transcript.length - 1].agentId).toBe(finalizer.id);
    expect(transcript.some((m) => m.agentId === summarizer.id)).toBe(true);
  });

  it('runs the summarizer before the finalizer, both over the full transcript', async () => {
    const calls: { kind: string; labels: string[] }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        calls.push({ kind: requestKind(init), labels: historyLabels(init) });
        return Promise.resolve(okChat());
      }),
    );
    const { pg } = buildPlayground({ cycle: false, maxTurns: 50 });
    useDomainStore.setState({ playground: pg });

    await startRun();

    const summarizerIdx = calls.findIndex((c) => c.kind === 'summarizer');
    const finalizerIdx = calls.findIndex((c) => c.kind === 'finalizer');
    expect(summarizerIdx).toBeGreaterThanOrEqual(0);
    expect(finalizerIdx).toBeGreaterThan(summarizerIdx); // summarizer first
    // Both terminal agents saw the whole discussion (A and B) as history.
    expect(calls[summarizerIdx].labels).toEqual(expect.arrayContaining(['A', 'B']));
    expect(calls[finalizerIdx].labels).toEqual(expect.arrayContaining(['A', 'B']));
    // The finalizer additionally saw the summarizer's output (each sees prior wrap-up).
    expect(calls[finalizerIdx].labels).toContain('S');
  });

  it('does not double-run a terminal agent that was retried into the discussion queue', async () => {
    // Phase 1: the finalizer fails in wrap-up (401, non-retryable) → run errors.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
        Promise.resolve(requestKind(init) === 'finalizer' ? new Response('unauthorized', { status: 401 }) : okChat()),
      ),
    );
    const { pg, finalizer } = buildPlayground({ cycle: false, maxTurns: 50 });
    useDomainStore.setState({ playground: pg });
    await startRun();
    expect(useRuntimeStore.getState().status).toBe('error');

    // Phase 2: retry just the finalizer with a healthy provider. It runs once via
    // the seeded discussion turn; the wrap-up phase must NOT run it a second time.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(okChat())));
    retryAgentTurn(finalizer.id);
    await vi.waitFor(() => expect(useRuntimeStore.getState().status).toBe('completed'));

    const transcript = useDomainStore.getState().playground!.transcript;
    const finalizerCompleted = transcript.filter((m) => m.agentId === finalizer.id && m.status === 'completed');
    expect(finalizerCompleted).toHaveLength(1);
  });

  it('skips the wrap-up phase entirely when the user stops the run', async () => {
    // Stop the run during the first request; the loop aborts before wrap-up.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        stopRun();
        return Promise.resolve(okChat());
      }),
    );
    const { pg, summarizer, finalizer } = buildPlayground({ cycle: false, maxTurns: 50 });
    useDomainStore.setState({ playground: pg });

    await startRun();

    const transcript = useDomainStore.getState().playground!.transcript;
    expect(useRuntimeStore.getState().status).toBe('stopped');
    // Neither terminal agent ran.
    expect(transcript.some((m) => m.agentId === summarizer.id)).toBe(false);
    expect(transcript.some((m) => m.agentId === finalizer.id)).toBe(false);
  });
});
