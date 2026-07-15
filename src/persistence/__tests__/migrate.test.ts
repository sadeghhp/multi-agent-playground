import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '../../domain/schema';
import { migrateToCurrent } from '../migrate';

describe('migrateToCurrent', () => {
  it('rejects non-objects', () => {
    expect(migrateToCurrent(null).ok).toBe(false);
    expect(migrateToCurrent('x').ok).toBe(false);
  });

  it('rejects a missing schemaVersion', () => {
    const res = migrateToCurrent({ id: 'pg_1' });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/schemaVersion/i);
  });

  it('rejects a future schema version', () => {
    const res = migrateToCurrent({ schemaVersion: SCHEMA_VERSION + 10 });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/newer version/i);
  });

  it('re-stamps v1 to the current schema version', () => {
    const res = migrateToCurrent({ schemaVersion: 1, id: 'pg_1', name: 'Old' });
    expect(res.ok).toBe(true);
    expect((res.data as { schemaVersion: number }).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('re-stamps an older version to the current schema version (persona / kind fields)', () => {
    const res = migrateToCurrent({
      schemaVersion: 2,
      id: 'pg_1',
      agents: [{ id: 'a1', name: 'A' }],
    });
    expect(res.ok).toBe(true);
    expect((res.data as { schemaVersion: number }).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('leaves a current-version object intact', () => {
    const raw = { schemaVersion: SCHEMA_VERSION, id: 'pg_1' };
    const res = migrateToCurrent(raw);
    expect(res.ok).toBe(true);
    expect(res.data).toEqual(raw);
  });
});
