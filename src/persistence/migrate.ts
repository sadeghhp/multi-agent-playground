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
    data = { ...(raw as object), schemaVersion: 2 };
  }
  return { ok: true, data };
}
