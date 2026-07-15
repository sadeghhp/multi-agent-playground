import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createAgent, createPlayground, createProvider } from '../../domain/factories';
import { loadCredential } from '../credentialStore';

/**
 * Real IndexedDB round-trip (via fake-indexeddb), exercising the actual db.ts
 * paths that every other suite mocks: the provider registry, credential stripping
 * on save, rehydration on load, the corrupted-record skip, and the v1 → v2
 * provider hoist. Covers FR-7 and the §21 credential guarantee end-to-end.
 *
 * db.ts memoizes its connection at module scope, so we reset modules and import
 * it fresh per test after installing a clean IndexedDB — otherwise the cached
 * connection points at a previous test's (now-replaced) factory.
 */

type DbModule = typeof import('../db');

function installFreshIndexedDb() {
  vi.resetModules();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
}

async function freshDb(): Promise<DbModule> {
  installFreshIndexedDb();
  return import('../db');
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
});

function providerWithKey() {
  return createProvider({
    displayName: 'Local',
    baseUrl: 'http://localhost:11434',
    apiKey: 'secret-123',
    credentialStorage: 'session',
  });
}

/** Read a raw stored record straight from IndexedDB, bypassing db.ts. */
function rawGet(store: string, id: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('multi-agent-playground');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(store, 'readonly');
      const getReq = tx.objectStore(store).get(id);
      getReq.onsuccess = () => resolve(getReq.result);
      getReq.onerror = () => reject(getReq.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe('playground round-trip', () => {
  it('saves and restores a playground (FR-7)', async () => {
    const db = await freshDb();
    const pg = createPlayground('DB Test');
    pg.agents.push(createAgent({ name: 'A' }));
    await db.savePlayground(pg);
    const loaded = await db.loadPlayground(pg.id);
    expect(loaded?.name).toBe('DB Test');
    expect(loaded?.agents[0].name).toBe('A');
  });

  it('deleting a playground does NOT clear a global provider credential', async () => {
    const db = await freshDb();
    const provider = providerWithKey();
    await db.saveProvider(provider);
    const pg = createPlayground('DB Test');
    await db.savePlayground(pg);

    await db.deletePlayground(pg.id);
    expect(await db.loadPlayground(pg.id)).toBeUndefined();
    // The provider is global; its credential must survive the playground deletion.
    expect(loadCredential(provider.id)).toBe('secret-123');
  });

  it('skips a corrupted record instead of throwing (§21 recovery)', async () => {
    const db = await freshDb();
    const pg = createPlayground('DB Test');
    await db.savePlayground(pg);

    // Poke a structurally invalid record directly into the store.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('multi-agent-playground');
      req.onsuccess = () => {
        const idb = req.result;
        const tx = idb.transaction('playgrounds', 'readwrite');
        tx.objectStore('playgrounds').put({ id: 'pg_broken', schemaVersion: 2 /* missing everything */ });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const all = await db.loadAllPlaygrounds();
    expect(all.some((p) => p.id === pg.id)).toBe(true);
    expect(all.some((p) => p.id === 'pg_broken')).toBe(false);
  });
});

describe('provider registry', () => {
  it('strips the API key from the stored blob and rehydrates it on load (§21)', async () => {
    const db = await freshDb();
    const provider = providerWithKey();
    await db.saveProvider(provider);

    const raw = await rawGet('providers', provider.id);
    expect(JSON.stringify(raw)).not.toContain('secret-123');

    // The key was routed to session storage...
    expect(loadCredential(provider.id)).toBe('secret-123');
    // ...and comes back on load.
    const loaded = await db.loadAllProviders();
    expect(loaded.find((p) => p.id === provider.id)?.apiKey).toBe('secret-123');
  });

  it('deleteProvider removes the record and clears its credential', async () => {
    const db = await freshDb();
    const provider = providerWithKey();
    await db.saveProvider(provider);
    expect((await db.loadAllProviders()).some((p) => p.id === provider.id)).toBe(true);

    await db.deleteProvider(provider.id);
    expect((await db.loadAllProviders()).some((p) => p.id === provider.id)).toBe(false);
    expect(loadCredential(provider.id)).toBeUndefined();
  });

  describe('credential/IDB atomicity (M-8 regression)', () => {
    afterEach(() => {
      vi.doUnmock('idb');
    });

    it('does not save a credential when the underlying IDB write fails', async () => {
      installFreshIndexedDb();
      vi.doMock('idb', async (importOriginal) => {
        const actual = await importOriginal<typeof import('idb')>();
        return {
          ...actual,
          openDB: async (...args: Parameters<typeof actual.openDB>) => {
            const real = await actual.openDB(...args);
            return new Proxy(real, {
              get(target, prop, receiver) {
                if (prop === 'put') {
                  return (storeName: string, value: unknown) =>
                    storeName === 'providers'
                      ? Promise.reject(new Error('put failed'))
                      : target.put(storeName, value);
                }
                // idb's own method wrappers rely on `this` being their own proxy
                // (they internally unwrap it) — binding to `target` here keeps
                // every other call working through this outer proxy.
                const value = Reflect.get(target, prop, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            });
          },
        };
      });

      const db = await import('../db');
      const provider = providerWithKey();

      await expect(db.saveProvider(provider)).rejects.toThrow('put failed');
      // The failed IDB write must leave no orphaned credential behind.
      expect(loadCredential(provider.id)).toBeUndefined();
    });

    it('does not clear the credential when the underlying IDB delete fails', async () => {
      installFreshIndexedDb();
      vi.doMock('idb', async (importOriginal) => {
        const actual = await importOriginal<typeof import('idb')>();
        return {
          ...actual,
          openDB: async (...args: Parameters<typeof actual.openDB>) => {
            const real = await actual.openDB(...args);
            return new Proxy(real, {
              get(target, prop, receiver) {
                if (prop === 'delete') {
                  return (storeName: string, key: string) =>
                    storeName === 'providers'
                      ? Promise.reject(new Error('delete failed'))
                      : target.delete(storeName, key);
                }
                const value = Reflect.get(target, prop, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
              },
            });
          },
        };
      });

      const db = await import('../db');
      const provider = providerWithKey();
      await db.saveProvider(provider);
      expect(loadCredential(provider.id)).toBe('secret-123');

      await expect(db.deleteProvider(provider.id)).rejects.toThrow('delete failed');
      // The failed IDB delete must leave the still-referenced credential intact.
      expect(loadCredential(provider.id)).toBe('secret-123');
    });
  });
});

describe('getDb resilience', () => {
  afterEach(() => {
    vi.doUnmock('idb');
  });

  it('retries after a failed open instead of permanently caching the rejection (H-1 regression)', async () => {
    installFreshIndexedDb();
    let calls = 0;
    vi.doMock('idb', async (importOriginal) => {
      const actual = await importOriginal<typeof import('idb')>();
      return {
        ...actual,
        openDB: (...args: Parameters<typeof actual.openDB>) => {
          calls += 1;
          if (calls === 1) return Promise.reject(new Error('boom: simulated open failure'));
          return actual.openDB(...args);
        },
      };
    });

    const db = await import('../db');
    const pg = createPlayground('Retry Test');

    await expect(db.savePlayground(pg)).rejects.toThrow('boom');
    // A second call must retry openDB rather than reusing the dead promise —
    // without the fix this would reject with the same cached error forever.
    await db.savePlayground(pg);
    const loaded = await db.loadPlayground(pg.id);
    expect(loaded?.name).toBe('Retry Test');
    expect(calls).toBe(2);
  });
});

describe('v1 → v2 migration', () => {
  it('hoists providers embedded in v1 playgrounds into the global registry', async () => {
    installFreshIndexedDb();

    // Build a schema-v1 record with an embedded provider and seed it into a
    // version-1 database, exactly like a pre-upgrade user would have on disk.
    const base = createPlayground('Old');
    const provider = createProvider({ displayName: 'Hoisted', baseUrl: 'http://localhost:11434' });
    const v1Record = { ...base, schemaVersion: 1, providers: [provider] };

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('multi-agent-playground', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('playgrounds', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const idb = req.result;
        const tx = idb.transaction('playgrounds', 'readwrite');
        tx.objectStore('playgrounds').put(v1Record);
        tx.oncomplete = () => {
          idb.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    // Opening via db.ts triggers the v2 upgrade, which runs the hoist.
    const db = await import('../db');

    const providers = await db.loadAllProviders();
    expect(providers.some((p) => p.id === provider.id)).toBe(true);

    // The playground still loads and its record no longer carries providers.
    const loaded = await db.loadPlayground(base.id);
    expect(loaded?.name).toBe('Old');
    const raw = (await rawGet('playgrounds', base.id)) as Record<string, unknown>;
    expect(raw.providers).toBeUndefined();
    expect(raw.schemaVersion).toBe(2);
  });
});

describe('conversation runs', () => {
  function makeRun(playgroundId: string, version: number, id = `run_${version}`) {
    const pg = createPlayground('Runs');
    return {
      id,
      playgroundId,
      version,
      parentRunId: version > 1 ? `run_${version - 1}` : null,
      startedAt: Date.now() + version,
      endedAt: Date.now() + version + 1000,
      status: 'completed' as const,
      conversation: pg.conversation,
      transcript: [],
      events: [],
      messageCountAtStart: 0,
    };
  }

  it('saves, lists by playground in version order, and deletes a run', async () => {
    const db = await freshDb();
    const pg = createPlayground('Runs Test');
    await db.savePlayground(pg);

    const run1 = makeRun(pg.id, 1);
    const run2 = makeRun(pg.id, 2);
    await db.saveRun(run1);
    await db.saveRun(run2);

    const listed = await db.listRuns(pg.id);
    expect(listed.map((r) => r.version)).toEqual([1, 2]);

    await db.deleteRun(run1.id);
    expect(await db.getRun(run1.id)).toBeUndefined();
    expect((await db.listRuns(pg.id)).map((r) => r.version)).toEqual([2]);
  });

  it('cascades run deletion when a playground is deleted', async () => {
    const db = await freshDb();
    const pg = createPlayground('Cascade');
    await db.savePlayground(pg);
    await db.saveRun(makeRun(pg.id, 1));

    await db.deletePlayground(pg.id);
    expect(await db.listRuns(pg.id)).toEqual([]);
  });

  it('creates conversationRuns when upgrading a v4 DB that lacked the store', async () => {
    installFreshIndexedDb();

    // Simulate a browser that reached IDB v4 without conversationRuns (e.g. a
    // partial local bump). Opening the current module must still create it.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('multi-agent-playground', 4);
      req.onupgradeneeded = () => {
        const idb = req.result;
        idb.createObjectStore('playgrounds', { keyPath: 'id' });
        idb.createObjectStore('providers', { keyPath: 'id' });
        idb.createObjectStore('agentLibrary', { keyPath: 'id' });
        idb.createObjectStore('runPresets', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });

    const db = await import('../db');
    const pg = createPlayground('Upgrade');
    await db.savePlayground(pg);
    await db.saveRun(makeRun(pg.id, 1));
    expect((await db.listRuns(pg.id)).map((r) => r.version)).toEqual([1]);
  });
});
