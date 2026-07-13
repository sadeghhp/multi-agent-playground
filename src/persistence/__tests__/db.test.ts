import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createAgent, createPlayground, createProvider } from '../../domain/factories';
import { loadCredential } from '../credentialStore';

/**
 * Real IndexedDB round-trip (via fake-indexeddb), exercising the actual db.ts
 * paths that every other suite mocks: credential stripping on save, rehydration
 * on load, and the corrupted-record skip. Covers FR-7 and the §21 credential
 * guarantee end-to-end.
 *
 * db.ts memoizes its connection at module scope, so we reset modules and import
 * it fresh per test after installing a clean IndexedDB — otherwise the cached
 * connection points at a previous test's (now-replaced) factory.
 */

type DbModule = typeof import('../db');

async function freshDb(): Promise<DbModule> {
  vi.resetModules();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
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

function pgWithKey() {
  const pg = createPlayground('DB Test');
  const provider = createProvider({
    displayName: 'Local',
    baseUrl: 'http://localhost:11434',
    apiKey: 'secret-123',
    credentialStorage: 'session',
  });
  pg.providers.push(provider);
  pg.agents.push(createAgent({ name: 'A' }));
  return { pg, provider };
}

/** Read a raw stored record straight from IndexedDB, bypassing db.ts. */
function rawGet(id: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('multi-agent-playground');
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('playgrounds', 'readonly');
      const getReq = tx.objectStore('playgrounds').get(id);
      getReq.onsuccess = () => resolve(getReq.result);
      getReq.onerror = () => reject(getReq.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe('db round-trip', () => {
  it('saves and restores a playground (FR-7)', async () => {
    const db = await freshDb();
    const { pg } = pgWithKey();
    await db.savePlayground(pg);
    const loaded = await db.loadPlayground(pg.id);
    expect(loaded?.name).toBe('DB Test');
    expect(loaded?.agents[0].name).toBe('A');
  });

  it('strips the API key from the stored blob and rehydrates it from the credential store (§21)', async () => {
    const db = await freshDb();
    const { pg, provider } = pgWithKey();
    await db.savePlayground(pg);

    const raw = await rawGet(pg.id);
    expect(JSON.stringify(raw)).not.toContain('secret-123');

    // The key was routed to session storage...
    expect(loadCredential(provider.id)).toBe('secret-123');
    // ...and comes back on load.
    const loaded = await db.loadPlayground(pg.id);
    expect(loaded?.providers[0].apiKey).toBe('secret-123');
  });

  it('lists all and deletes, clearing credentials', async () => {
    const db = await freshDb();
    const { pg, provider } = pgWithKey();
    await db.savePlayground(pg);
    expect((await db.loadAllPlaygrounds()).some((p) => p.id === pg.id)).toBe(true);

    await db.deletePlayground(pg.id);
    expect(await db.loadPlayground(pg.id)).toBeUndefined();
    expect(loadCredential(provider.id)).toBeUndefined();
  });

  it('skips a corrupted record instead of throwing (§21 recovery)', async () => {
    const db = await freshDb();
    const { pg } = pgWithKey();
    await db.savePlayground(pg);

    // Poke a structurally invalid record directly into the store.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('multi-agent-playground');
      req.onsuccess = () => {
        const idb = req.result;
        const tx = idb.transaction('playgrounds', 'readwrite');
        tx.objectStore('playgrounds').put({ id: 'pg_broken', schemaVersion: 1 /* missing everything */ });
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
