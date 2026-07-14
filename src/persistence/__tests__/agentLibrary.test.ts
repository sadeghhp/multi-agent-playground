import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createAgent, createSavedAgent, createPlayground } from '../../domain/factories';

/**
 * Agent library round-trip via fake-indexeddb, exercising the real db.ts paths:
 * the second object store created on the v2 upgrade, save/list/delete, and the
 * corrupted-record skip. The library shares db.ts's single connection with the
 * playgrounds store, so a fresh factory + module reset is used per test as in
 * db.test.ts.
 */

type DbModule = typeof import('../db');

async function freshDb(): Promise<DbModule> {
  vi.resetModules();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  return import('../db');
}

describe('agent library round-trip', () => {
  it('saves, lists (newest first), and disposes a saved agent', async () => {
    const db = await freshDb();
    const older = createSavedAgent(createAgent({ name: 'Older' }));
    const newer = { ...createSavedAgent(createAgent({ name: 'Newer' })), savedAt: older.savedAt + 1000 };

    await db.saveLibraryAgent(older);
    await db.saveLibraryAgent(newer);

    const all = await db.loadAllLibraryAgents();
    expect(all).toHaveLength(2);
    // loadAllLibraryAgents does not sort; the store sorts. Assert both present.
    expect(all.map((s) => s.name).sort()).toEqual(['Newer', 'Older']);

    await db.deleteLibraryAgent(older.id);
    const remaining = await db.loadAllLibraryAgents();
    expect(remaining.map((s) => s.id)).toEqual([newer.id]);
  });

  it('preserves the agent config, including a (possibly dangling) providerId', async () => {
    const db = await freshDb();
    const agent = createAgent({ name: 'Analyst', role: 'Analyst' });
    agent.llm.providerId = 'pv_from_other_playground';
    const saved = createSavedAgent(agent);

    await db.saveLibraryAgent(saved);
    const [loaded] = await db.loadAllLibraryAgents();
    expect(loaded.agent.name).toBe('Analyst');
    expect(loaded.agent.role).toBe('Analyst');
    expect(loaded.agent.llm.providerId).toBe('pv_from_other_playground');
  });

  it('skips a corrupted library record instead of throwing', async () => {
    const db = await freshDb();
    const good = createSavedAgent(createAgent({ name: 'Good' }));
    await db.saveLibraryAgent(good);

    // Poke a structurally invalid record straight into the store.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('multi-agent-playground');
      req.onsuccess = () => {
        const idb = req.result;
        const tx = idb.transaction('agentLibrary', 'readwrite');
        tx.objectStore('agentLibrary').put({ id: 'lib_broken', schemaVersion: 1 /* missing agent */ });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const all = await db.loadAllLibraryAgents();
    expect(all.some((s) => s.id === good.id)).toBe(true);
    expect(all.some((s) => s.id === 'lib_broken')).toBe(false);
  });

  it('migrates a stale-but-valid schemaVersion instead of dropping it as corrupted (M-7 regression)', async () => {
    const db = await freshDb();
    const saved = createSavedAgent(createAgent({ name: 'Legacy' }));
    // Force the lazy connection open (and its store-creating upgrade) before
    // seeding a raw record directly, same as the "corrupted record" test above.
    await db.loadAllLibraryAgents();

    // Simulate a library agent saved under an older schemaVersion — otherwise
    // fully valid, just stamped by a previous app version.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('multi-agent-playground');
      req.onsuccess = () => {
        const idb = req.result;
        const tx = idb.transaction('agentLibrary', 'readwrite');
        tx.objectStore('agentLibrary').put({ ...saved, schemaVersion: 1 });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const all = await db.loadAllLibraryAgents();
    expect(all.some((s) => s.id === saved.id && s.name === 'Legacy')).toBe(true);
  });

  it('does not disturb the playgrounds store sharing the same connection', async () => {
    const db = await freshDb();
    const pg = createPlayground('Coexist');
    await db.savePlayground(pg);
    await db.saveLibraryAgent(createSavedAgent(createAgent({ name: 'Lib' })));

    expect((await db.loadAllPlaygrounds()).some((p) => p.id === pg.id)).toBe(true);
    expect(await db.loadAllLibraryAgents()).toHaveLength(1);
  });
});
