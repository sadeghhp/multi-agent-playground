import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../persistence/db', () => ({
  saveLibraryAgent: vi.fn().mockResolvedValue(undefined),
  loadAllLibraryAgents: vi.fn().mockResolvedValue([]),
  deleteLibraryAgent: vi.fn().mockResolvedValue(undefined),
}));

import { createAgent } from '../../domain/factories';
import { loadAllLibraryAgents, saveLibraryAgent } from '../../persistence/db';
import { useAgentLibraryStore } from '../agentLibraryStore';

beforeEach(() => {
  useAgentLibraryStore.setState({ library: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('hydrate resilience (L-10 regression)', () => {
  it('does not throw and degrades to an empty library when loadAllLibraryAgents rejects', async () => {
    vi.mocked(loadAllLibraryAgents).mockRejectedValueOnce(new Error('IDB unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(useAgentLibraryStore.getState().hydrate()).resolves.toBeUndefined();
    expect(useAgentLibraryStore.getState().library).toEqual([]);

    vi.mocked(loadAllLibraryAgents).mockResolvedValue([]);
  });
});

describe('saveAgent ordering (L-21 regression)', () => {
  it('orders by call order, not by which concurrent save settles first', async () => {
    let resolveFirst!: () => void;
    vi.mocked(saveLibraryAgent).mockImplementationOnce(
      () => new Promise((resolve) => (resolveFirst = () => resolve(undefined))),
    );
    vi.mocked(saveLibraryAgent).mockImplementationOnce(() => Promise.resolve());

    const store = useAgentLibraryStore.getState();
    const first = createAgent({ name: 'First' });
    const second = createAgent({ name: 'Second' });

    const p1 = store.saveAgent(first); // save is held pending
    const p2 = store.saveAgent(second); // this save's DB write settles first

    await p2;
    // Second was called after First but must still appear after it in the
    // list — call order, not DB-write-completion order.
    expect(useAgentLibraryStore.getState().library.map((s) => s.name)).toEqual(['Second', 'First']);

    resolveFirst();
    await p1;
    expect(useAgentLibraryStore.getState().library.map((s) => s.name)).toEqual(['Second', 'First']);
  });
});
