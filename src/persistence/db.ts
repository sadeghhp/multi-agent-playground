import { type IDBPDatabase, type IDBPTransaction, openDB } from 'idb';
import {
  type Playground,
  type Provider,
  type SavedAgent,
  Playground as PlaygroundSchema,
  Provider as ProviderSchema,
  SavedAgent as SavedAgentSchema,
} from '../domain/schema';
import { migrateToCurrent } from './migrate';
import { clearCredential, loadCredential, saveCredential } from './credentialStore';

/**
 * IndexedDB persistence (spec §15.1). Three object stores:
 *   - `playgrounds`: full playground records (no providers as of schema v2).
 *   - `providers`: the application-global provider registry (schema v2). Any
 *     playground can reference these by id, so providers created once are reused
 *     everywhere.
 *   - `agentLibrary`: the cross-playground agent library ("pool").
 *
 * API keys are never written to any store: they're stripped and kept in the
 * credential store instead (spec §8.4), keyed by provider id, so the DB blob
 * never contains secrets and session-only keys vanish with the tab.
 *
 * All stores are created by the single upgrade callback below — never open a
 * second connection to this DB from another module, or two upgrade callbacks
 * would race over which stores exist.
 */

const DB_NAME = 'multi-agent-playground';
const DB_VERSION = 2;
const STORE = 'playgrounds';
const PROVIDER_STORE = 'providers';
const LIBRARY_STORE = 'agentLibrary';

let dbPromise: Promise<IDBPDatabase> | null = null;
let dbInstance: IDBPDatabase | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      // Guarded creates so this runs correctly whether the DB is brand new or a
      // v1 database gaining the provider/library stores on upgrade to v2.
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(PROVIDER_STORE)) {
          db.createObjectStore(PROVIDER_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(LIBRARY_STORE)) {
          db.createObjectStore(LIBRARY_STORE, { keyPath: 'id' });
        }
        // v1 → v2: hoist providers that were embedded in each playground into the
        // global registry, then strip them from the playground record. Runs once.
        if (oldVersion > 0 && oldVersion < 2) {
          await hoistEmbeddedProviders(tx);
        }
      },
      // Another tab holding an older-version connection open would otherwise
      // leave this open() request pending forever (and, worse, cache that dead
      // promise below). Close our handle so the other tab's upgrade can proceed
      // instead of silently hanging.
      blocked() {
        console.warn('IndexedDB upgrade blocked by another open tab; close other tabs and reload.');
      },
      blocking() {
        console.warn('A newer tab wants to upgrade the database; closing this connection.');
        dbInstance?.close();
        dbInstance = null;
        dbPromise = null;
      },
      terminated() {
        console.warn('IndexedDB connection was unexpectedly terminated.');
        dbInstance = null;
        dbPromise = null;
      },
    });
    dbPromise
      .then((db) => {
        dbInstance = db;
      })
      .catch(() => {
        // Let the next getDb() call retry instead of permanently reusing a
        // rejected promise (a single transient open failure must not
        // permanently disable persistence for the rest of the session).
        dbPromise = null;
      });
  }
  return dbPromise;
}

/**
 * One-time migration: read providers off every stored playground (schema v1),
 * write them to the global provider store (deduped by id — ids were unique
 * across playgrounds), and rewrite each playground without its `providers` field
 * and stamped as v2. Credentials already live in the credential store keyed by
 * provider id, so hoisting the metadata keeps them resolvable.
 */
async function hoistEmbeddedProviders(
  tx: IDBPTransaction<unknown, string[], 'versionchange'>,
): Promise<void> {
  const pgStore = tx.objectStore(STORE);
  const provStore = tx.objectStore(PROVIDER_STORE);
  const records = (await pgStore.getAll()) as unknown[];
  const seen = new Set<string>();
  for (const rec of records) {
    if (typeof rec !== 'object' || rec === null) continue;
    const record = rec as { id?: unknown; providers?: unknown };
    const providers = Array.isArray(record.providers) ? record.providers : [];
    for (const p of providers) {
      const pid = (p as { id?: unknown })?.id;
      if (typeof pid !== 'string' || seen.has(pid)) continue;
      seen.add(pid);
      // Stored records never carried apiKey, but drop it defensively.
      const { apiKey: _drop, ...rest } = p as Record<string, unknown>;
      await provStore.put(rest);
    }
    const { providers: _providers, ...withoutProviders } = record as Record<string, unknown>;
    await pgStore.put({ ...withoutProviders, schemaVersion: 2 });
  }
}

// ---------------------------------------------------------------------------
// Playgrounds
// ---------------------------------------------------------------------------

export async function savePlayground(pg: Playground): Promise<void> {
  const db = await getDb();
  await db.put(STORE, pg);
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
  // Providers are global as of v2, so deleting a playground must NOT touch
  // provider records or their credentials — other playgrounds may still use them.
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
    // Route through the same version migration as playgrounds first — a
    // library agent saved under an older schemaVersion is stale, not
    // corrupted, and must not be silently dropped on the next version bump.
    const migrated = migrateToCurrent(raw);
    if (!migrated.ok) {
      console.warn('Skipping unreadable library agent record:', migrated.reason);
      continue;
    }
    // Tolerate corruption exactly like parseStored: skip a bad record, never
    // let it crash hydration of the whole library.
    const parsed = SavedAgentSchema.safeParse(migrated.data);
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
 * Validate a stored playground record, tolerating corruption (spec §21, §7.7).
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
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Providers (application-global registry, schema v2)
// ---------------------------------------------------------------------------

/** Strip the API key before persisting — it's routed to the credential store instead. */
function stripApiKey(p: Provider): Omit<Provider, 'apiKey'> {
  const { apiKey: _drop, ...rest } = p;
  return rest;
}

/** Rehydrate the API key from the credential store after loading. */
function rehydrateProvider(p: Provider): Provider {
  const apiKey = loadCredential(p.id);
  return apiKey ? { ...p, apiKey } : p;
}

export async function saveProvider(p: Provider): Promise<void> {
  const db = await getDb();
  // Write the IDB record first — only save the credential once that succeeds,
  // so a failing IDB write can never leave a credential stored for a provider
  // record that was never actually persisted.
  await db.put(PROVIDER_STORE, stripApiKey(p));
  if (p.apiKey !== undefined) {
    saveCredential(p.id, p.apiKey, p.credentialStorage);
  }
}

export async function loadAllProviders(): Promise<Provider[]> {
  const db = await getDb();
  const all = await db.getAll(PROVIDER_STORE);
  const result: Provider[] = [];
  for (const raw of all) {
    const parsed = ProviderSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn('Skipping corrupted provider record:', parsed.error.issues[0]?.message);
      continue;
    }
    result.push(rehydrateProvider(parsed.data));
  }
  return result;
}

export async function deleteProvider(id: string): Promise<void> {
  const db = await getDb();
  // Delete the IDB record first — only clear the credential once that
  // succeeds, so a failing IDB delete can't leave the provider record behind
  // with its credential already wiped.
  await db.delete(PROVIDER_STORE, id);
  clearCredential(id);
}
