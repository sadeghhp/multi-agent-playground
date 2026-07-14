import { describe, expect, it } from 'vitest';
import {
  createAgent,
  createLibrarySkill,
  createPlayground,
  createProvider,
  duplicateAgent,
  SKILL_PRESETS,
} from '../factories';

describe('duplicateAgent', () => {
  it('assigns a new id and fresh skill ids, offsetting position (spec §9.3)', () => {
    const original = createAgent({
      name: 'A',
      skills: [{ id: 's1', name: 'x', description: '', instruction: '', enabled: true }],
      position: { x: 10, y: 20 },
    });
    const copy = duplicateAgent(original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.skills[0].id).not.toBe('s1');
    expect(copy.position).not.toEqual(original.position);
    expect(copy.name).toContain('copy');
  });
});

describe('skill library', () => {
  it('seeds a new playground from the built-in presets with fresh ids', () => {
    const pg = createPlayground('Seeded');
    expect(pg.skillLibrary).toHaveLength(SKILL_PRESETS.length);
    expect(pg.skillLibrary.map((s) => s.name)).toEqual(SKILL_PRESETS.map((p) => p.name));
    // Each seeded entry has a distinct id.
    const ids = new Set(pg.skillLibrary.map((s) => s.id));
    expect(ids.size).toBe(pg.skillLibrary.length);
  });

  it('createLibrarySkill applies defaults and a fresh id', () => {
    const a = createLibrarySkill({ name: 'x' });
    const b = createLibrarySkill({ name: 'x' });
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ name: 'x', description: '', instruction: '' });
  });
});

describe('provider duplication id safety', () => {
  it('a duplicate built by stripping id gets a distinct id', () => {
    const original = createProvider({ displayName: 'P', baseUrl: 'http://localhost:11434' });
    // Mirrors ProviderManager.handleDuplicate: strip id before spreading.
    const { id: _id, apiKey: _key, ...rest } = original;
    const copy = createProvider({ ...rest, displayName: 'P (copy)' });
    expect(copy.id).not.toBe(original.id);
    expect(copy.displayName).toBe('P (copy)');
  });
});
