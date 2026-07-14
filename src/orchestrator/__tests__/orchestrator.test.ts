import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no IndexedDB — stub the persistence layer so autosave is a no-op.
vi.mock('../../persistence/db', () => ({
  savePlayground: vi.fn().mockResolvedValue(undefined),
  loadPlayground: vi.fn().mockResolvedValue(undefined),
  loadAllPlaygrounds: vi.fn().mockResolvedValue([]),
  deletePlayground: vi.fn().mockResolvedValue(undefined),
  saveProvider: vi.fn().mockResolvedValue(undefined),
  loadAllProviders: vi.fn().mockResolvedValue([]),
  deleteProvider: vi.fn().mockResolvedValue(undefined),
}));

import { createAgent, createPlayground, createProvider } from '../../domain/factories';
import type { Playground } from '../../domain/schema';
import { useDomainStore } from '../../store/domainStore';
import { useProviderStore } from '../../store/providerStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { startRun, stopRun } from '../orchestrator';

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

/** An SSE chat response that emits `text` one space-delimited word per chunk. */
function sseChat(text: string) {
  const words = text.split(' ');
  const chunks = words.map(
    (w, i) => `data: {"choices":[{"delta":{"content":${JSON.stringify((i ? ' ' : '') + w)}}}]}\n\n`,
  );
  chunks.push('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n');
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

/** Two agents A<->B in a cycle, both using a localhost provider. */
function cyclePlayground(maxTurns: number, maxPerAgent: number): Playground {
  const pg = createPlayground('Test');
  const provider = createProvider({
    displayName: 'Local',
    baseUrl: 'http://localhost:11434',
    authMethod: 'none',
    models: ['test'],
  });
  const base = createAgent();
  const a = createAgent({
    name: 'A',
    role: 'r',
    systemInstruction: 'do',
    llm: { ...base.llm, providerId: provider.id, model: 'test' },
  });
  const b = createAgent({
    name: 'B',
    role: 'r',
    systemInstruction: 'do',
    llm: { ...base.llm, providerId: provider.id, model: 'test' },
  });
  // Providers are application-global now; register it in the provider store so
  // the orchestrator can resolve agent.llm.providerId against the live registry.
  useProviderStore.setState({ providers: [provider] });
  pg.agents.push(a, b);
  pg.connections.push(
    { id: 'c1', source: a.id, target: b.id, enabled: true, type: 'conversation', priority: 0 },
    { id: 'c2', source: b.id, target: a.id, enabled: true, type: 'conversation', priority: 0 },
  );
  pg.conversation = {
    ...pg.conversation,
    subject: 'topic',
    startingAgentId: a.id,
    maxTotalTurns: maxTurns,
    maxResponsesPerAgent: maxPerAgent,
  };
  return pg;
}

beforeEach(() => {
  useRuntimeStore.getState().reset();
  useProviderStore.setState({ providers: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('orchestrator cycle controls', () => {
  it('bounds a cyclic graph by max total turns', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(okChat())));
    const pg = cyclePlayground(5, 10);
    useDomainStore.setState({ playground: pg });

    await startRun();

    const runtime = useRuntimeStore.getState();
    const transcript = useDomainStore.getState().playground!.transcript;
    // Never exceeds the turn cap even though the graph cycles forever.
    expect(runtime.currentTurn).toBeLessThanOrEqual(5);
    expect(transcript.length).toBeLessThanOrEqual(5);
    expect(transcript.length).toBeGreaterThan(0);
  });

  it('bounds by max responses per agent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(okChat())));
    const pg = cyclePlayground(50, 2);
    useDomainStore.setState({ playground: pg });

    await startRun();

    const responses = useRuntimeStore.getState().responsesPerAgent;
    for (const count of Object.values(responses)) {
      expect(count).toBeLessThanOrEqual(2);
    }
    // With 2 agents each capped at 2, the run must terminate on its own.
    expect(useRuntimeStore.getState().status).toBe('completed');
  });

  it('attributes a provider failure to the correct agent and stops on error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 })));
    const pg = cyclePlayground(10, 5);
    useDomainStore.setState({ playground: pg });

    await startRun();

    const errors = useRuntimeStore.getState().errors;
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].agentId).toBe(pg.agents[0].id); // A, the starting agent
    expect(useRuntimeStore.getState().status).toBe('error');
  });

  it('records a sanitized request snapshot per message (spec §13.3)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(okChat())));
    const pg = cyclePlayground(1, 5);
    useDomainStore.setState({ playground: pg });

    await startRun();

    const transcript = useDomainStore.getState().playground!.transcript;
    const snapshots = useRuntimeStore.getState().requestSnapshots;
    const first = transcript[0];
    const snap = snapshots[first.id];
    expect(snap).toBeDefined();
    expect(snap.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(snap.model).toBe('test');
    expect(snap.messages[0].role).toBe('system');
    // No credentials anywhere in the snapshot.
    expect(JSON.stringify(snap)).not.toMatch(/authorization|bearer|api[-_]?key/i);
  });

  it('skips disabled agents', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(okChat())));
    const pg = cyclePlayground(10, 5);
    pg.agents[1].runtime.enabled = false; // disable B
    useDomainStore.setState({ playground: pg });

    await startRun();

    const transcript = useDomainStore.getState().playground!.transcript;
    // Only A ever responds; B is disabled so the run ends after A hits its own cap.
    expect(transcript.every((m) => m.agentId === pg.agents[0].id)).toBe(true);
  });
});

describe('orchestrator streaming', () => {
  it('fills streamingText as tokens arrive, then clears it when the turn finalizes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(sseChat('streamed reply here'))));
    const pg = cyclePlayground(1, 5);
    useDomainStore.setState({ playground: pg });
    const agentId = pg.agents[0].id;

    // Observe intermediate live-buffer states without timing hacks.
    const seen: string[] = [];
    const unsub = useRuntimeStore.subscribe((s) => {
      const t = s.streamingText[agentId];
      if (t) seen.push(t);
    });

    await startRun();
    unsub();

    // The buffer grew as deltas arrived (partial text was visible mid-turn)...
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe('streamed reply here');
    // ...and finalizing the message cleared the live buffer.
    expect(useRuntimeStore.getState().streamingText).toEqual({});
    // The assembled stream became the finalized transcript entry.
    const transcript = useDomainStore.getState().playground!.transcript;
    expect(transcript[0].content).toBe('streamed reply here');
  });
});

describe('orchestrator cancellation', () => {
  it('stop aborts the in-flight request and marks the run stopped', async () => {
    // fetch that only settles when its signal aborts.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            const signal = init.signal!;
            signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    const pg = cyclePlayground(10, 5);
    useDomainStore.setState({ playground: pg });

    const runPromise = startRun();
    // Let the loop reach the awaiting fetch, then stop.
    await new Promise((r) => setTimeout(r, 10));
    stopRun();
    await runPromise;

    expect(useRuntimeStore.getState().status).toBe('stopped');
    // No completed message was recorded for the aborted turn.
    const transcript = useDomainStore.getState().playground!.transcript;
    expect(transcript.filter((m) => m.status === 'completed').length).toBe(0);
  });

  it('does not let a stopped run corrupt a newly started run (stop, then immediately start)', async () => {
    // Run A: fetch that only settles (by rejecting) once its signal aborts.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            const signal = init.signal!;
            signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ),
    );
    const pgA = cyclePlayground(10, 5);
    useDomainStore.setState({ playground: pgA });

    const runPromiseA = startRun();
    // Let run A's loop reach the awaiting fetch.
    await new Promise((r) => setTimeout(r, 10));
    stopRun();

    // Immediately (before run A's aborted fetch promise has even settled) start
    // a second run — this is the "click Stop then Start" race. Run B's own
    // fetch is held pending (not resolved yet) so we can deterministically
    // observe the store's state *while run B is still genuinely mid-turn*,
    // which is the exact window run A's stale cleanup must not corrupt.
    let resolveB!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise<Response>((resolve) => (resolveB = resolve))),
    );
    const pgB = cyclePlayground(1, 5);
    useDomainStore.setState({ playground: pgB });
    const runPromiseB = startRun();
    // Run B's own startRun() call synchronously registers its runId in the
    // store before its first await, so this is safe to read immediately.
    const runIdB = useRuntimeStore.getState().runId;
    expect(runIdB).not.toBeNull();

    // Flush the microtask queue (a macrotask boundary guarantees every pending
    // microtask — including run A's multi-hop abort/catch chain — has run) so
    // run A's stale tail has every chance to execute before we check state.
    // Run B is still awaiting its own (held-pending) fetch at this point.
    await new Promise((r) => setTimeout(r, 10));
    expect(useRuntimeStore.getState().runId).toBe(runIdB);
    expect(useRuntimeStore.getState().status).toBe('running');
    expect(useRuntimeStore.getState().activeAgentId).toBe(pgB.agents[0].id);

    // Now let run B's turn actually complete.
    resolveB(okChat());
    await runPromiseA;
    await runPromiseB;

    expect(useRuntimeStore.getState().runId).toBe(runIdB);
    expect(useRuntimeStore.getState().status).toBe('completed');
    const transcriptB = useDomainStore.getState().playground!.transcript;
    expect(transcriptB.some((m) => m.status === 'completed')).toBe(true);
  });
});
