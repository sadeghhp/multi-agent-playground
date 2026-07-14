import { type IDBPDatabase, openDB } from 'idb';
import {
  type Playground,
  Playground as PlaygroundSchema,
  type SavedAgent,
  SavedAgent as SavedAgentSchema,
} from '../domain/schema';
import { migrateToCurrent } from './migrate';
import { clearCredential, loadCredential, saveCredential } from './credentialStore';

/**
 * IndexedDB persistence for full playgrounds (spec §15.1). API keys are stripped
 * from the stored record and kept in the credential store instead (spec §8.4),
 * so the DB blob never contains secrets and session-only keys vanish with the tab.
 *
 * The same connection also backs the cross-playground agent library ("pool") in
 * the LIBRARY_STORE. Both stores are created by the single upgrade callback
 * below — never open a second connection to this DB from another module, or two
 * upgrade callbacks would race over which stores exist.
 */

const DB_NAME = 'multi-agent-playground';
const DB_VERSION = 2;
const STORE = 'playgrounds';
const LIBRARY_STORE = 'agentLibrary';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      // Guarded creates so this runs correctly whether the DB is brand new or a
      // v1 database gaining the library store on upgrade to v2.
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(LIBRARY_STORE)) {
          db.createObjectStore(LIBRARY_STORE, { keyPath: 'id' });
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
  const raw = await db.get(STORE, id);
  const pg = raw ? parseStored(raw) : undefined;
  if (pg) pg.providers.forEach((p) => clearCredential(p.id));
  await db.delete(STORE, id);
}

// ---------------------------------------------------------------------------
// Agent library ("pool") — cross-playground saved agents (FR: save/dispose).
// Records are self-contained agent snapshots with no credentials, so unlike
// playgrounds they need no credential stripping/rehydration.
// ---------------------------------------------------------------------------

export async function saveLibraryAgent(saved: SavedAgent): Promise<void> {
  const db = await getDb();
  await db.put(LIBRARY_STORE, saved);
}

export async function loadAllLibraryAgents(): Promise<SavedAgent[]> {
  const db = await getDb();
  const all = await db.getAll(LIBRARY_STORE);
  const result: SavedAgent[] = [];
  for (const raw of all) {
    // Tolerate corruption exactly like parseStored: skip a bad record, never
    // let it crash hydration of the whole library.
    const parsed = SavedAgentSchema.safeParse(raw);
    if (parsed.success) result.push(parsed.data);
    else console.warn('Skipping corrupted library agent record:', parsed.error.issues[0]?.message);
  }
  return result;
}

export async function deleteLibraryAgent(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(LIBRARY_STORE, id);
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
