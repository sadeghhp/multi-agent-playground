import { describe, expect, it } from 'vitest';
import { exportSkillSet, importSkillSet } from '../skillSets';
import { MAX_IMPORT_BYTES } from '../serialization';

describe('exportSkillSet / importSkillSet', () => {
  it('round-trips skills and regenerates ids on import', () => {
    const skills = [
      { id: 'sk_a', name: 'analysis', description: 'd1', instruction: 'i1' },
      { id: 'sk_b', name: 'critique', description: 'd2', instruction: 'i2' },
    ];
    const json = exportSkillSet(skills);
    expect(json).toContain('"version"');

    const res = importSkillSet(json);
    expect(res.ok).toBe(true);
    expect(res.skills).toHaveLength(2);
    // Content preserved…
    expect(res.skills.map((s) => s.name)).toEqual(['analysis', 'critique']);
    expect(res.skills[0].instruction).toBe('i1');
    // …but ids are fresh so an import never collides with existing skills.
    expect(res.skills[0].id).not.toBe('sk_a');
    expect(res.skills[1].id).not.toBe('sk_b');
  });

  it('exports skills missing optional fields with defaults', () => {
    const json = exportSkillSet([{ name: 'bare' }]);
    const res = importSkillSet(json);
    expect(res.ok).toBe(true);
    expect(res.skills[0]).toMatchObject({ name: 'bare', description: '', instruction: '' });
  });

  it('rejects non-JSON', () => {
    const res = importSkillSet('{ not json');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/valid JSON/i);
  });

  it('rejects a structurally invalid skill set', () => {
    const res = importSkillSet(JSON.stringify({ version: 1, skills: [{ description: 'no name' }] }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid skill set/i);
  });

  it('rejects a wrong version', () => {
    const res = importSkillSet(JSON.stringify({ version: 2, skills: [] }));
    expect(res.ok).toBe(false);
  });

  it('rejects oversized files', () => {
    const res = importSkillSet('x'.repeat(MAX_IMPORT_BYTES + 1));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/too large/i);
  });
});
