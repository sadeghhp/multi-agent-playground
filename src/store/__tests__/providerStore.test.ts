import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no IndexedDB; stub persistence so store mutations are no-ops.
vi.mock('../../persistence/db', () => ({
  savePlayground: vi.fn().mockResolvedValue(undefined),
  loadPlayground: vi.fn().mockResolvedValue(undefined),
  loadAllPlaygrounds: vi.fn().mockResolvedValue([]),
  deletePlayground: vi.fn().mockResolvedValue(undefined),
  saveProvider: vi.fn().mockResolvedValue(undefined),
  loadAllProviders: vi.fn().mockResolvedValue([]),
  deleteProvider: vi.fn().mockResolvedValue(undefined),
}));

import { createAgent, createProvider } from '../../domain/factories';
import { loadAllProviders, saveProvider } from '../../persistence/db';
import { useDomainStore } from '../domainStore';
import { useProviderStore } from '../providerStore';

beforeEach(() => {
  useProviderStore.setState({ providers: [], hydrated: false });
  useDomainStore.setState({ playground: null, index: [], saveStatus: 'saved' });
});

describe('provider registry CRUD', () => {
  it('adds, updates, and removes providers', () => {
    const store = useProviderStore.getState();
    const p = createProvider({ displayName: 'A', baseUrl: 'http://localhost:1' });
    store.addProvider(p);
    expect(useProviderStore.getState().providers).toHaveLength(1);

    store.updateProvider(p.id, { displayName: 'A2' });
    expect(useProviderStore.getState().providers[0].displayName).toBe('A2');

    store.removeProvider(p.id);
    expect(useProviderStore.getState().providers).toHaveLength(0);
  });
});

describe('removeProvider → unassign in active playground', () => {
  it('clears the reference from agents in the open playground', () => {
    const domain = useDomainStore.getState();
    domain.newPlayground('P');
    const provider = createProvider({ displayName: 'P', baseUrl: 'http://localhost:2' });
    useProviderStore.getState().addProvider(provider);
    const base = createAgent();
    domain.addAgent(createAgent({ name: 'A', llm: { ...base.llm, providerId: provider.id, model: 'm' } }));

    useProviderStore.getState().removeProvider(provider.id);

    const pg = useDomainStore.getState().playground!;
    expect(pg.agents[0].llm.providerId).toBeNull();
  });
});

describe('ensureProvider', () => {
  it('reuses an existing provider that points at the same endpoint', () => {
    const store = useProviderStore.getState();
    const existing = createProvider({ displayName: 'Local', baseUrl: 'http://localhost:11434', path: '/v1/chat/completions' });
    store.addProvider(existing);

    const incoming = createProvider({ displayName: 'Local (again)', baseUrl: 'http://localhost:11434', path: '/v1/chat/completions' });
    const id = store.ensureProvider(incoming);

    expect(id).toBe(existing.id);
    expect(useProviderStore.getState().providers).toHaveLength(1);
  });

  it('adds a new provider when no endpoint matches', () => {
    const store = useProviderStore.getState();
    const incoming = createProvider({ displayName: 'New', baseUrl: 'http://localhost:9', path: '/v1/chat/completions' });
    const id = store.ensureProvider(incoming);
    expect(id).toBe(incoming.id);
    expect(useProviderStore.getState().providers).toHaveLength(1);
  });
});

describe('mergeProviders', () => {
  it('adds unknown providers and skips ones already present by id', () => {
    const store = useProviderStore.getState();
    const known = createProvider({ displayName: 'Known', baseUrl: 'http://localhost:3' });
    store.addProvider(known);

    const fresh = createProvider({ displayName: 'Fresh', baseUrl: 'http://localhost:4' });
    store.mergeProviders([{ ...known, displayName: 'Should not overwrite' }, fresh]);

    const providers = useProviderStore.getState().providers;
    expect(providers).toHaveLength(2);
    // The existing entry is untouched (dedupe by id, no overwrite).
    expect(providers.find((p) => p.id === known.id)?.displayName).toBe('Known');
    expect(providers.some((p) => p.id === fresh.id)).toBe(true);
  });
});

describe('flush race safety (M-1 regression)', () => {
  it('does not resave a provider removed while an earlier save in the same debounce batch is in flight', async () => {
    // The debounce timer/dirty-id set are module-scoped in providerStore.ts,
    // shared across every test in this file — let any leftover flush from an
    // earlier test settle first so it can't pollute this test's assertions.
    await new Promise((r) => setTimeout(r, 450));
    vi.mocked(saveProvider).mockClear();

    const a = createProvider({ displayName: 'A', baseUrl: 'http://localhost:5' });
    const b = createProvider({ displayName: 'B', baseUrl: 'http://localhost:6' });

    let resolveA: (() => void) | undefined;
    vi.mocked(saveProvider).mockImplementation((p) => {
      if (p.id === a.id) return new Promise<void>((resolve) => (resolveA = resolve));
      return Promise.resolve();
    });

    const store = useProviderStore.getState();
    store.addProvider(a);
    store.addProvider(b); // one debounced flush batch covers both a and b

    // Wait past the real debounce so flush() starts and calls saveProvider(a)
    // first — that call is now pending (held open via resolveA).
    await new Promise((r) => setTimeout(r, 450));
    expect(resolveA).toBeDefined();

    // Remove b while a's save is still in flight — the exact race window.
    store.removeProvider(b.id);

    // Let a's save resolve so the flush loop proceeds to (what was) b.
    resolveA?.();
    await new Promise((r) => setTimeout(r, 10));

    expect(vi.mocked(saveProvider)).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: b.id }),
    );

    vi.mocked(saveProvider).mockReset();
    vi.mocked(saveProvider).mockResolvedValue(undefined);
  });
});

describe('hydrate resilience (L-10 regression)', () => {
  it('does not throw and degrades to an empty registry when loadAllProviders rejects', async () => {
    vi.mocked(loadAllProviders).mockRejectedValueOnce(new Error('IDB unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(useProviderStore.getState().hydrate()).resolves.toBeUndefined();
    expect(useProviderStore.getState().providers).toEqual([]);
    expect(useProviderStore.getState().hydrated).toBe(true);

    vi.mocked(loadAllProviders).mockResolvedValue([]);
    vi.restoreAllMocks();
  });
});
