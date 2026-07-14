import { type IDBPDatabase, openDB } from 'idb';
import { type Playground, Playground as PlaygroundSchema } from '../domain/schema';
import { migrateToCurrent } from './migrate';
import { clearCredential, loadCredential, saveCredential } from './credentialStore';

/**
 * IndexedDB persistence for full playgrounds (spec §15.1). API keys are stripped
 * from the stored record and kept in the credential store instead (spec §8.4),
 * so the DB blob never contains secrets and session-only keys vanish with the tab.
 */

const DB_NAME = 'multi-agent-playground';
const DB_VERSION = 1;
const STORE = 'playgrounds';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

/** Strip API keys before persisting; persist each key to its credential store. */
function prepareForStorage(pg: Playground): Playground {
  const providers = pg.providers.map((p) => {
    if (p.apiKey !== undefined) {
      saveCredential(p.id, p.apiKey, p.credentialStorage);
    }
    const { apiKey: _drop, ...rest } = p;
    return { ...rest };
  });
  return { ...pg, providers };
}

/** Rehydrate API keys from the credential store after loading. */
function rehydrate(pg: Playground): Playground {
  const providers = pg.providers.map((p) => {
    const apiKey = loadCredential(p.id);
    return apiKey ? { ...p, apiKey } : p;
  });
  return { ...pg, providers };
}

export async function savePlayground(pg: Playground): Promise<void> {
  const db = await getDb();
  await db.put(STORE, prepareForStorage(pg));
}

export async function loadPlayground(id: string): Promise<Playground | undefined> {
  const db = await getDb();
  const raw = await db.get(STORE, id);
  if (!raw) return undefined;
  return parseStored(raw);
}

export async function loadAllPlaygrounds(): Promise<Playground[]> {
  const db = await getDb();
  const all = await db.getAll(STORE);
  const result: Playground[] = [];
  for (const raw of all) {
    const pg = parseStored(raw);
    if (pg) result.push(pg);
  }
  return result;
}

export async function deletePlayground(id: string): Promise<void> {
  const db = await getDb();
  // Best-effort: also clear any stored credentials for this playground's providers.
  // Read provider ids straight off the raw record so credentials are still cleared
  // even when the record is too corrupt for parseStored to validate — otherwise the
  // key is stranded in session/localStorage with no record left to ever clean it up.
  const raw = await db.get(STORE, id);
  rawProviderIds(raw).forEach((pid) => clearCredential(pid));
  await db.delete(STORE, id);
}

/** Defensively pull provider ids from an unvalidated stored record. */
function rawProviderIds(raw: unknown): string[] {
  const providers = (raw as { providers?: unknown } | null | undefined)?.providers;
  if (!Array.isArray(providers)) return [];
  return providers
    .map((p) => (p as { id?: unknown })?.id)
    .filter((pid): pid is string => typeof pid === 'string');
}

/**
 * Validate a stored record, tolerating corruption (spec §21, §7.7 hardening).
 * A single bad record must not crash the whole app — it's skipped and reported.
 */
function parseStored(raw: unknown): Playground | undefined {
  const migrated = migrateToCurrent(raw);
  if (!migrated.ok) {
    console.warn('Skipping unreadable playground record:', migrated.reason);
    return undefined;
  }
  const parsed = PlaygroundSchema.safeParse(migrated.data);
  if (!parsed.success) {
    console.warn('Skipping corrupted playground record:', parsed.error.issues[0]?.message);
    return undefined;
  }
  return rehydrate(parsed.data);
}
