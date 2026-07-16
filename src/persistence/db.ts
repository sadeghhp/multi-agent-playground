import { type IDBPDatabase, type IDBPTransaction, openDB } from 'idb';
import {
  type ConversationRun,
  type Playground,
  type Provider,
  type RunPreset,
  type SavedAgent,
  ConversationRun as ConversationRunSchema,
  Playground as PlaygroundSchema,
  Provider as ProviderSchema,
  RunPreset as RunPresetSchema,
  SavedAgent as SavedAgentSchema,
} from '../domain/schema';
import {
  type ModelPrice,
  type UsageEntry,
  ModelPrice as ModelPriceSchema,
  UsageEntry as UsageEntrySchema,
} from '../domain/usage';
import type { ZodType } from 'zod';
import { migrateToCurrent } from './migrate';
import { clearCredential, loadCredential, saveCredential } from './credentialStore';

/**
 * Optional listener notified whenever a stored record is dropped on read because
 * it failed validation, so the UI can surface it (App wires this to a toast)
 * instead of the drop being visible only in the console. Kept as a plain
 * callback to avoid a db → store import cycle.
 */
let recordDropListener: ((detail: string) => void) | null = null;
export function setRecordDropListener(listener: ((detail: string) => void) | null): void {
  recordDropListener = listener;
}
function reportDroppedRecord(label: string, detail: string): void {
  console.warn(`Skipping ${label}:`, detail);
  recordDropListener?.(`A stored ${label} could not be loaded and was skipped.`);
}

/**
 * Validate a domain object before it is written, so corruption is caught where
 * it is introduced rather than silently dropped on the next load. Returns the
 * parsed (normalized) value to persist; throws with a precise path on failure.
 */
function assertValidForSave<T>(schema: ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Refusing to persist invalid ${label}: ${detail}`);
  }
  return parsed.data;
}

/**
 * IndexedDB persistence (spec §15.1). Object stores:
 *   - `playgrounds`, `providers`, `agentLibrary`, `runPresets`, `conversationRuns`
 *   - `usageLedger`: per-call token/cost accounting
 *   - `modelPrices`: editable USD/1M token prices
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
// v6 adds usageLedger + modelPrices. Prior bumps: v4/v5 conversationRuns.
const DB_VERSION = 6;
const STORE = 'playgrounds';
const PROVIDER_STORE = 'providers';
const LIBRARY_STORE = 'agentLibrary';
const RUN_PRESET_STORE = 'runPresets';
const CONVERSATION_RUN_STORE = 'conversationRuns';
const USAGE_LEDGER_STORE = 'usageLedger';
const MODEL_PRICES_STORE = 'modelPrices';

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
        if (!db.objectStoreNames.contains(RUN_PRESET_STORE)) {
          db.createObjectStore(RUN_PRESET_STORE, { keyPath: 'id' });
        }
        // Create stores if absent, and (crucially) create indexes based on
        // whether they already exist — NOT only when the store is first created.
        // An index added to an existing store in a later version must backfill on
        // upgrade, otherwise index reads (e.g. listRuns) would throw NotFoundError
        // on databases that predate the index.
        if (!db.objectStoreNames.contains(CONVERSATION_RUN_STORE)) {
          db.createObjectStore(CONVERSATION_RUN_STORE, { keyPath: 'id' });
        }
        const runStore = tx.objectStore(CONVERSATION_RUN_STORE);
        if (!runStore.indexNames.contains('by-playground')) {
          runStore.createIndex('by-playground', 'playgroundId');
        }
        if (!runStore.indexNames.contains('by-playground-version')) {
          runStore.createIndex('by-playground-version', ['playgroundId', 'version']);
        }
        if (!db.objectStoreNames.contains(USAGE_LEDGER_STORE)) {
          db.createObjectStore(USAGE_LEDGER_STORE, { keyPath: 'id' });
        }
        const usageStore = tx.objectStore(USAGE_LEDGER_STORE);
        if (!usageStore.indexNames.contains('by-at')) {
          usageStore.createIndex('by-at', 'at');
        }
        if (!db.objectStoreNames.contains(MODEL_PRICES_STORE)) {
          db.createObjectStore(MODEL_PRICES_STORE, { keyPath: 'id' });
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
  const seen = new Map<string, string>();
  for (const rec of records) {
    if (typeof rec !== 'object' || rec === null) continue;
    const record = rec as { id?: unknown; providers?: unknown };
    const providers = Array.isArray(record.providers) ? record.providers : [];
    for (const p of providers) {
      const pid = (p as { id?: unknown })?.id;
      if (typeof pid !== 'string') continue;
      // Stored records never carried apiKey, but drop it defensively.
      const { apiKey: _drop, ...rest } = p as Record<string, unknown>;
      const fingerprint = JSON.stringify(rest);
      const existing = seen.get(pid);
      if (existing !== undefined) {
        // First-writer-wins across playgrounds. In v1 the same id could have
        // diverged if the user edited it in one playground only — surface that
        // rather than silently discarding the later config.
        if (existing !== fingerprint) {
          console.warn(
            `Provider "${pid}" was embedded with differing config in multiple playgrounds; keeping the first and discarding the rest.`,
          );
        }
        continue;
      }
      seen.set(pid, fingerprint);
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
  await db.put(STORE, assertValidForSave(PlaygroundSchema, pg, 'playground'));
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
  await deleteRunsForPlayground(id);
}

// ---------------------------------------------------------------------------
// Agent library ("pool") — cross-playground saved agents (FR: save/dispose).
// Records are self-contained agent snapshots with no credentials, so unlike
// playgrounds they need no credential stripping/rehydration.
// ---------------------------------------------------------------------------

export async function saveLibraryAgent(saved: SavedAgent): Promise<void> {
  const db = await getDb();
  await db.put(LIBRARY_STORE, assertValidForSave(SavedAgentSchema, saved, 'library agent'));
}

export async function loadAllLibraryAgents(): Promise<SavedAgent[]> {
  const db = await getDb();
  const all = await db.getAll(LIBRARY_STORE);
  const result: SavedAgent[] = [];
  for (const raw of all) {
    // Route through the same version migration as playgrounds first — a
    // library agent saved under an older schemaVersion is stale, not
    // corrupted, and must not be silently dropped on the next version bump.
    const migrated = migrateToCurrent(raw, 'savedAgent');
    if (!migrated.ok) {
      reportDroppedRecord('library agent record', migrated.reason ?? 'unreadable');
      continue;
    }
    // Tolerate corruption exactly like parseStored: skip a bad record, never
    // let it crash hydration of the whole library.
    const parsed = SavedAgentSchema.safeParse(migrated.data);
    if (parsed.success) result.push(parsed.data);
    else reportDroppedRecord('library agent record', parsed.error.issues[0]?.message ?? 'invalid');
  }
  return result;
}

export async function deleteLibraryAgent(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(LIBRARY_STORE, id);
}

// ---------------------------------------------------------------------------
// Run presets — named, reusable "Run conversation" option bundles. Like
// library agents, self-contained (no credentials), so no stripping/rehydration.
// ---------------------------------------------------------------------------

export async function saveRunPreset(preset: RunPreset): Promise<void> {
  const db = await getDb();
  await db.put(RUN_PRESET_STORE, assertValidForSave(RunPresetSchema, preset, 'run preset'));
}

export async function loadAllRunPresets(): Promise<RunPreset[]> {
  const db = await getDb();
  const all = await db.getAll(RUN_PRESET_STORE);
  const result: RunPreset[] = [];
  for (const raw of all) {
    const migrated = migrateToCurrent(raw, 'runPreset');
    if (!migrated.ok) {
      reportDroppedRecord('run preset record', migrated.reason ?? 'unreadable');
      continue;
    }
    const parsed = RunPresetSchema.safeParse(migrated.data);
    if (parsed.success) result.push(parsed.data);
    else reportDroppedRecord('run preset record', parsed.error.issues[0]?.message ?? 'invalid');
  }
  return result;
}

export async function deleteRunPreset(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(RUN_PRESET_STORE, id);
}

// ---------------------------------------------------------------------------
// Conversation runs — versioned execution history per playground.
// ---------------------------------------------------------------------------

function parseConversationRun(raw: unknown): ConversationRun | undefined {
  const parsed = ConversationRunSchema.safeParse(raw);
  if (!parsed.success) {
    reportDroppedRecord('conversation run record', parsed.error.issues[0]?.message ?? 'invalid');
    return undefined;
  }
  return parsed.data;
}

export async function saveRun(run: ConversationRun): Promise<void> {
  const db = await getDb();
  await db.put(CONVERSATION_RUN_STORE, assertValidForSave(ConversationRunSchema, run, 'conversation run'));
}

export async function getRun(id: string): Promise<ConversationRun | undefined> {
  const db = await getDb();
  const raw = await db.get(CONVERSATION_RUN_STORE, id);
  if (!raw) return undefined;
  return parseConversationRun(raw);
}

export async function listRuns(playgroundId: string): Promise<ConversationRun[]> {
  const db = await getDb();
  const index = db.transaction(CONVERSATION_RUN_STORE).store.index('by-playground-version');
  const all = await index.getAll(IDBKeyRange.bound([playgroundId, 0], [playgroundId, Infinity]));
  const result: ConversationRun[] = [];
  for (const raw of all) {
    const run = parseConversationRun(raw);
    if (run) result.push(run);
  }
  result.sort((a, b) => a.version - b.version);
  return result;
}

export async function deleteRun(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(CONVERSATION_RUN_STORE, id);
}

export async function deleteRunsForPlayground(playgroundId: string): Promise<void> {
  const db = await getDb();
  // Delete over raw index keys, not parsed records — a corrupt run that
  // parseConversationRun would skip must still be removed, or it lingers forever.
  const tx = db.transaction(CONVERSATION_RUN_STORE, 'readwrite');
  const index = tx.store.index('by-playground');
  let cursor = await index.openKeyCursor(IDBKeyRange.only(playgroundId));
  while (cursor) {
    await tx.store.delete(cursor.primaryKey);
    cursor = await cursor.continue();
  }
  await tx.done;
}

/**
 * Validate a stored playground record, tolerating corruption (spec §21, §7.7).
 * A single bad record must not crash the whole app — it's skipped and reported.
 */
function parseStored(raw: unknown): Playground | undefined {
  const migrated = migrateToCurrent(raw, 'playground');
  if (!migrated.ok) {
    reportDroppedRecord('playground record', migrated.reason ?? 'unreadable');
    return undefined;
  }
  const parsed = PlaygroundSchema.safeParse(migrated.data);
  if (!parsed.success) {
    reportDroppedRecord('playground record', parsed.error.issues[0]?.message ?? 'invalid');
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
  const record = assertValidForSave(ProviderSchema, stripApiKey(p), 'provider');
  await db.put(PROVIDER_STORE, record);
  // Route the key to the store the provider's credentialStorage selects. When the
  // caller supplies an explicit apiKey use it; otherwise relocate any existing
  // key, so a storage-mode change (e.g. local→session) that omits the key can't
  // leave a stale copy behind in the other Web Storage backend.
  const key = p.apiKey !== undefined ? p.apiKey : loadCredential(p.id);
  if (key !== undefined) {
    saveCredential(p.id, key, p.credentialStorage);
  }
}

export async function loadAllProviders(): Promise<Provider[]> {
  const db = await getDb();
  const all = await db.getAll(PROVIDER_STORE);
  const result: Provider[] = [];
  for (const raw of all) {
    const parsed = ProviderSchema.safeParse(raw);
    if (!parsed.success) {
      reportDroppedRecord('provider record', parsed.error.issues[0]?.message ?? 'invalid');
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

// ---------------------------------------------------------------------------
// Usage ledger + model prices
// ---------------------------------------------------------------------------

export async function saveUsageEntry(entry: UsageEntry): Promise<void> {
  const db = await getDb();
  await db.put(USAGE_LEDGER_STORE, assertValidForSave(UsageEntrySchema, entry, 'usage entry'));
}

export async function loadAllUsageEntries(): Promise<UsageEntry[]> {
  const db = await getDb();
  const all = await db.getAll(USAGE_LEDGER_STORE);
  const result: UsageEntry[] = [];
  for (const raw of all) {
    const parsed = UsageEntrySchema.safeParse(raw);
    if (parsed.success) result.push(parsed.data);
    else reportDroppedRecord('usage entry', parsed.error.issues[0]?.message ?? 'invalid');
  }
  result.sort((a, b) => a.at - b.at);
  return result;
}

export async function clearUsageLedger(): Promise<void> {
  const db = await getDb();
  await db.clear(USAGE_LEDGER_STORE);
}

export async function deleteUsageSince(sinceMs: number): Promise<void> {
  const db = await getDb();
  // Delete over the raw `by-at` index range, not parsed records, so a corrupt
  // entry that loadAllUsageEntries would skip is still removed.
  const tx = db.transaction(USAGE_LEDGER_STORE, 'readwrite');
  const index = tx.store.index('by-at');
  let cursor = await index.openKeyCursor(IDBKeyRange.lowerBound(sinceMs));
  while (cursor) {
    await tx.store.delete(cursor.primaryKey);
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function saveModelPrice(price: ModelPrice): Promise<void> {
  const db = await getDb();
  await db.put(MODEL_PRICES_STORE, assertValidForSave(ModelPriceSchema, price, 'model price'));
}

export async function loadAllModelPrices(): Promise<ModelPrice[]> {
  const db = await getDb();
  const all = await db.getAll(MODEL_PRICES_STORE);
  const result: ModelPrice[] = [];
  for (const raw of all) {
    const parsed = ModelPriceSchema.safeParse(raw);
    if (parsed.success) result.push(parsed.data);
    else reportDroppedRecord('model price', parsed.error.issues[0]?.message ?? 'invalid');
  }
  return result;
}

export async function deleteModelPrice(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(MODEL_PRICES_STORE, id);
}
