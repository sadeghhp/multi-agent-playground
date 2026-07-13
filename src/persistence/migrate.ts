import { SCHEMA_VERSION } from '../domain/schema';

/**
 * Schema migration boundary (spec §7.1, §15.3). Persisted and imported
 * playgrounds carry a schemaVersion; this is where we upgrade older shapes to
 * the current one before zod validation. For the MVP there is only version 1,
 * so this is a stub that rejects anything from the future and passes v1 through.
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
  // Future: switch(version) { case 0: raw = upgrade0to1(raw); /* fallthrough */ }
  return { ok: true, data: raw };
}
