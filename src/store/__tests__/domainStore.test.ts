import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no IndexedDB; stub persistence.
vi.mock('../../persistence/db', () => ({
  savePlayground: vi.fn().mockResolvedValue(undefined),
  loadPlayground: vi.fn().mockResolvedValue(undefined),
  loadAllPlaygrounds: vi.fn().mockResolvedValue([]),
  deletePlayground: vi.fn().mockResolvedValue(undefined),
}));

import { createAgent, createProvider } from '../../domain/factories';
import { useDomainStore } from '../domainStore';

beforeEach(() => {
  useDomainStore.setState({ playground: null, index: [], saveStatus: 'saved' });
  window.localStorage.clear();
});

describe('duplicatePlayground', () => {
  it('gives the copy fresh playground/agent/provider ids and remaps references', () => {
    const store = useDomainStore.getState();
    store.newPlayground('Original');

    const provider = createProvider({ displayName: 'P', baseUrl: 'http://localhost:11434' });
    store.addProvider(provider);
    const base = createAgent();
    store.addAgent(createAgent({ name: 'A', llm: { ...base.llm, providerId: provider.id, model: 'm' } }));

    const original = useDomainStore.getState().playground!;
    const origProviderId = original.providers[0].id;
    const origAgentProviderRef = original.agents[0].llm.providerId;
    expect(origAgentProviderRef).toBe(origProviderId);

    useDomainStore.getState().duplicatePlayground();
    const copy = useDomainStore.getState().playground!;

    // Distinct playground + provider + agent ids (no cross-playground id sharing,
    // which would let deleting one clear the other's credentials).
    expect(copy.id).not.toBe(original.id);
    expect(copy.providers[0].id).not.toBe(origProviderId);
    expect(copy.agents[0].id).not.toBe(original.agents[0].id);
    // The agent's provider reference is remapped to the copy's provider.
    expect(copy.agents[0].llm.providerId).toBe(copy.providers[0].id);
    expect(copy.name).toBe('Original (copy)');
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

describe('removeProvider', () => {
  it('unassigns the provider from agents that used it', () => {
    const store = useDomainStore.getState();
    store.newPlayground('P');
    const provider = createProvider({ displayName: 'P' });
    store.addProvider(provider);
    const base = createAgent();
    const a = createAgent({ name: 'A', llm: { ...base.llm, providerId: provider.id, model: 'm' } });
    store.addAgent(a);

    store.removeProvider(provider.id);
    const pg = useDomainStore.getState().playground!;
    expect(pg.providers).toHaveLength(0);
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
      id: 'm1', turn: 1, agentId: a.id, agentName: 'A', agentDeleted: false, role: '', model: 'm',
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
