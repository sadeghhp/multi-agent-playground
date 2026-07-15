import { SCHEMA_VERSION } from '../domain/schema';

/**
 * Schema migration boundary (spec §7.1, §15.3). Persisted and imported
 * playgrounds carry a schemaVersion; this is where we upgrade older shapes to
 * the current one before zod validation.
 *
 * v1 → v2: providers moved from being embedded in each playground to an
 * application-global registry. We only need to re-stamp the version here — the
 * providers themselves are handled per caller: the IndexedDB upgrade hoists
 * embedded providers into the global store (persistence/db.ts), and imports read
 * the still-embedded providers off the export schema before merging them.
 *
 * v2 → v3: agents gained optional personaMode / persona fields. Zod defaults
 * fill personaMode: 'role' for records that omit them; we only re-stamp.
 *
 * v3 → v4: agents gained a `kind` lifecycle discriminator. Zod defaults fill
 * kind: 'participant' for records that omit it; we only re-stamp.
 */

export interface MigrationResult {
  ok: boolean;
  data?: unknown;
  reason?: string;
}

export function migrateToCurrent(raw: unknown): MigrationResult {
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: 'Playground data is not an object.' };
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== 'number') {
    return { ok: false, reason: 'Missing or invalid schemaVersion.' };
  }
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `This file was created by a newer version (schema ${version}). Update the app to open it.`,
    };
  }
  let data = raw;
  if (version < 2) {
    // v1 → v2: re-stamp the version. `providers` (if present) is left on the
    // object so import can read it; the DB upgrade strips it from stored records
    // and zod drops it when parsing against the provider-less Playground schema.
    data = { ...(data as object), schemaVersion: 2 };
  }
  if ((data as { schemaVersion: number }).schemaVersion < 3) {
    // v2 → v3: persona fields are optional with defaults; re-stamp only.
    data = { ...(data as object), schemaVersion: 3 };
  }
  if ((data as { schemaVersion: number }).schemaVersion < 4) {
    // v3 → v4: agent `kind` has a zod default ('participant'); re-stamp only.
    data = { ...(data as object), schemaVersion: 4 };
  }
  return { ok: true, data };
}
