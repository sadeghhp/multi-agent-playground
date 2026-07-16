import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no IndexedDB; stub persistence.
vi.mock('../../persistence/db', () => import('../../test/persistenceDbMock'));

import { createAgent, createPlayground } from '../../domain/factories';
import { loadAllPlaygrounds, savePlayground } from '../../persistence/db';
import { useDomainStore } from '../domainStore';

beforeEach(() => {
  useDomainStore.setState({ playground: null, index: [], saveStatus: 'saved' });
  window.localStorage.clear();
});

describe('duplicatePlayground', () => {
  it('gives the copy fresh playground/agent ids but preserves the global provider reference', () => {
    const store = useDomainStore.getState();
    store.newPlayground('Original');

    const providerId = 'pv_global_1';
    const base = createAgent();
    store.addAgent(createAgent({ name: 'A', llm: { ...base.llm, providerId, model: 'm' } }));

    const original = useDomainStore.getState().playground!;
    expect(original.agents[0].llm.providerId).toBe(providerId);

    useDomainStore.getState().duplicatePlayground();
    const copy = useDomainStore.getState().playground!;

    // Distinct playground + agent ids…
    expect(copy.id).not.toBe(original.id);
    expect(copy.agents[0].id).not.toBe(original.agents[0].id);
    // …but providers are application-global, so the reference is shared unchanged.
    expect(copy.agents[0].llm.providerId).toBe(providerId);
    expect(copy.name).toBe('Original (copy)');
  });
});

describe('flushPending on playground switch (H2)', () => {
  it('persists the outgoing playground before switching, keeping its unsaved edits', () => {
    const store = useDomainStore.getState();
    store.newPlayground('A');
    const a = createAgent({ name: 'Agent A' });
    store.addAgent(a); // marks unsaved and arms the debounced save
    expect(useDomainStore.getState().saveStatus).toBe('unsaved');
    const outgoing = useDomainStore.getState().playground!;
    vi.mocked(savePlayground).mockClear();

    // Switch within the debounce window — A's edits must be flushed, not dropped.
    store.newPlayground('B');

    expect(savePlayground).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(savePlayground).mock.calls[0][0];
    expect(saved.id).toBe(outgoing.id);
    expect(saved.agents.find((x) => x.id === a.id)).toBeDefined();
    // The new playground is active afterwards.
    expect(useDomainStore.getState().playground!.name).toBe('B');
  });

  it('does not flush when there are no unsaved edits', () => {
    const store = useDomainStore.getState();
    store.newPlayground('A');
    useDomainStore.setState({ saveStatus: 'saved' });
    vi.mocked(savePlayground).mockClear();

    store.loadPlayground('nonexistent'); // a switch entry point

    expect(savePlayground).not.toHaveBeenCalled();
  });

  it('persists an edit made while loadPlayground is still awaiting the DB read (M-4 regression)', async () => {
    const store = useDomainStore.getState();
    store.newPlayground('A');
    // Settle the initial "new playground" save so we start from a clean, saved state.
    useDomainStore.setState({ saveStatus: 'saved' });
    vi.mocked(savePlayground).mockClear();

    const outgoingId = useDomainStore.getState().playground!.id;
    const other = createPlayground('B');

    // Hold loadAllPlaygrounds pending so we can land an edit on the outgoing
    // playground while loadPlayground('B') is still awaiting it.
    let resolveLoad: ((pgs: ReturnType<typeof createPlayground>[]) => void) | undefined;
    vi.mocked(loadAllPlaygrounds).mockImplementation(
      () => new Promise((resolve) => (resolveLoad = resolve)),
    );

    const switchPromise = store.loadPlayground(other.id);

    // Edit the still-active outgoing playground during the await window.
    const lateAgent = createAgent({ name: 'Late Edit' });
    store.addAgent(lateAgent);
    expect(useDomainStore.getState().saveStatus).toBe('unsaved');

    resolveLoad!([other]);
    await switchPromise;

    // The late edit must have been persisted, not silently discarded.
    expect(savePlayground).toHaveBeenCalledWith(
      expect.objectContaining({
        id: outgoingId,
        agents: expect.arrayContaining([expect.objectContaining({ id: lateAgent.id })]),
      }),
    );
    // The switch to B still completed.
    expect(useDomainStore.getState().playground!.id).toBe(other.id);

    vi.mocked(loadAllPlaygrounds).mockResolvedValue([]);
  });
});

describe('addConnection', () => {
  it('ignores a duplicate directed edge between the same pair', () => {
    const store = useDomainStore.getState();
    store.newPlayground('P');
    const a = createAgent({ name: 'A' });
    const b = createAgent({ name: 'B' });
    store.addAgent(a);
    store.addAgent(b);
    store.addConnection({ id: 'c1', source: a.id, target: b.id, enabled: true, type: 'conversation', priority: 0 });
    store.addConnection({ id: 'c2', source: a.id, target: b.id, enabled: true, type: 'review', priority: 0 });
    expect(useDomainStore.getState().playground!.connections).toHaveLength(1);
  });
});

describe('unassignProvider', () => {
  it('clears the provider reference from agents in the active playground', () => {
    const store = useDomainStore.getState();
    store.newPlayground('P');
    const providerId = 'pv_x';
    const base = createAgent();
    store.addAgent(createAgent({ name: 'A', llm: { ...base.llm, providerId, model: 'm' } }));

    store.unassignProvider(providerId);
    const pg = useDomainStore.getState().playground!;
    expect(pg.agents[0].llm.providerId).toBeNull();
  });
});

describe('removeAgent', () => {
  it('removes connected edges and preserves transcript, tagging it deleted (spec §9.4)', () => {
    const store = useDomainStore.getState();
    store.newPlayground('P');
    const a = createAgent({ name: 'A' });
    const b = createAgent({ name: 'B' });
    store.addAgent(a);
    store.addAgent(b);
    store.addConnection({ id: 'c1', source: a.id, target: b.id, enabled: true, type: 'conversation', priority: 0 });
    store.appendTranscript({
      id: 'm1', turn: 1, agentId: a.id, agentName: 'A', agentDeleted: false, role: '', language: 'en', model: 'm',
      providerId: null, content: 'hi', status: 'completed', sourceAgentId: null, connectionType: null, timestamp: 0,
    });

    store.removeAgent(a.id);
    const pg = useDomainStore.getState().playground!;
    expect(pg.agents.find((x) => x.id === a.id)).toBeUndefined();
    expect(pg.connections).toHaveLength(0); // connected edge removed
    expect(pg.transcript).toHaveLength(1); // history preserved
    expect(pg.transcript[0].agentDeleted).toBe(true); // tagged
  });
});

describe('skill library actions', () => {
  it('adds, updates, and removes library skills', () => {
    const store = useDomainStore.getState();
    store.newPlayground('P');
    const seeded = useDomainStore.getState().playground!.skillLibrary.length;

    store.addLibrarySkill({ id: 'lib_1', name: 'custom', description: '', instruction: '' });
    expect(useDomainStore.getState().playground!.skillLibrary).toHaveLength(seeded + 1);

    store.updateLibrarySkill('lib_1', { instruction: 'do the thing' });
    expect(
      useDomainStore.getState().playground!.skillLibrary.find((s) => s.id === 'lib_1')!.instruction,
    ).toBe('do the thing');

    store.removeLibrarySkill('lib_1');
    expect(
      useDomainStore.getState().playground!.skillLibrary.find((s) => s.id === 'lib_1'),
    ).toBeUndefined();
  });

  it('setSkillLibrary replaces the whole catalog (import/merge)', () => {
    const store = useDomainStore.getState();
    store.newPlayground('P');
    store.setSkillLibrary([{ id: 'lib_x', name: 'only', description: '', instruction: '' }]);
    const lib = useDomainStore.getState().playground!.skillLibrary;
    expect(lib).toHaveLength(1);
    expect(lib[0].id).toBe('lib_x');
  });
});

describe('hydrate resilience (L-10 regression)', () => {
  it('does not throw and degrades to an empty index when loadAllPlaygrounds rejects', async () => {
    vi.mocked(loadAllPlaygrounds).mockRejectedValueOnce(new Error('IDB unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(useDomainStore.getState().hydrate()).resolves.toBeUndefined();
    expect(useDomainStore.getState().index).toEqual([]);

    vi.mocked(loadAllPlaygrounds).mockResolvedValue([]);
    vi.restoreAllMocks();
  });
});

describe('applyArrangement', () => {
  it('atomically replaces connections and applies kind/position/conversation patches', () => {
    const store = useDomainStore.getState();
    store.newPlayground('Arrange');
    const a = createAgent({ id: 'a', name: 'A' });
    const b = createAgent({ id: 'b', name: 'B' });
    store.addAgent(a);
    store.addAgent(b);
    store.addConnection({ id: 'old', source: 'b', target: 'a', enabled: true, type: 'conversation', priority: 0 });

    useDomainStore.getState().applyArrangement({
      connections: [{ id: 'new1', source: 'a', target: 'b', enabled: true, type: 'review', priority: 2 }],
      agentPatches: [
        { id: 'a', position: { x: 80, y: 80 } },
        { id: 'b', kind: 'summarizer', position: { x: 360, y: 80 } },
      ],
      conversationPatch: { startingAgentId: 'a', conversationMode: 'debate', maxTotalTurns: 24 },
    });

    const pg = useDomainStore.getState().playground!;
    expect(pg.connections).toHaveLength(1);
    expect(pg.connections[0]).toMatchObject({ id: 'new1', type: 'review', priority: 2 });
    expect(pg.agents.find((x) => x.id === 'a')!.position).toEqual({ x: 80, y: 80 });
    expect(pg.agents.find((x) => x.id === 'b')!.kind).toBe('summarizer');
    expect(pg.conversation.startingAgentId).toBe('a');
    expect(pg.conversation.conversationMode).toBe('debate');
    expect(pg.conversation.maxTotalTurns).toBe(24);
    expect(pg.updatedAt).toBeGreaterThan(0);
  });

  it('reverts exactly when called with the inverse snapshot', () => {
    const store = useDomainStore.getState();
    store.newPlayground('Revert');
    const a = createAgent({ id: 'a', name: 'A', position: { x: 10, y: 20 } });
    const b = createAgent({ id: 'b', name: 'B', kind: 'participant', position: { x: 30, y: 40 } });
    store.addAgent(a);
    store.addAgent(b);
    store.addConnection({ id: 'orig', source: 'a', target: 'b', enabled: true, type: 'handoff', priority: 1 });
    store.updateConversation({ startingAgentId: 'a', maxTotalTurns: 12 });

    const before = useDomainStore.getState().playground!;
    const snapshot = {
      connections: before.connections.map((c) => ({ ...c })),
      agentPatches: before.agents.map((x) => ({ id: x.id, kind: x.kind, position: { ...x.position } })),
      conversationPatch: {
        startingAgentId: before.conversation.startingAgentId,
        conversationMode: before.conversation.conversationMode,
        maxTotalTurns: before.conversation.maxTotalTurns,
        maxResponsesPerAgent: before.conversation.maxResponsesPerAgent,
      },
    };

    useDomainStore.getState().applyArrangement({
      connections: [{ id: 'n1', source: 'b', target: 'a', enabled: true, type: 'review', priority: 0 }],
      agentPatches: [
        { id: 'a', position: { x: 999, y: 999 } },
        { id: 'b', kind: 'finalizer', position: { x: 500, y: 500 } },
      ],
      conversationPatch: { startingAgentId: 'b', conversationMode: 'debate', maxTotalTurns: 30 },
    });
    useDomainStore.getState().applyArrangement(snapshot);

    const after = useDomainStore.getState().playground!;
    expect(after.connections).toEqual(before.connections);
    expect(after.agents.map((x) => ({ id: x.id, kind: x.kind, position: x.position }))).toEqual(
      before.agents.map((x) => ({ id: x.id, kind: x.kind, position: x.position })),
    );
    expect(after.conversation.startingAgentId).toBe('a');
    expect(after.conversation.maxTotalTurns).toBe(12);
  });
});
