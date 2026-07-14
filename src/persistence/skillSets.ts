import { z } from 'zod';
import { LibrarySkill, type LibrarySkill as LibrarySkillType } from '../domain/schema';
import { newSkillId } from '../domain/ids';
import { MAX_IMPORT_BYTES } from './serialization';

/**
 * Skill-set import/export (spec §7.2, §15.3). A "skill set" is a portable list
 * of declared skills — used both for the whole library catalog and for a single
 * agent's skills. Skills are declarative, so files carry no secrets.
 *
 * Skills are exported in the LibrarySkill shape (no per-agent `enabled` /
 * `libraryId`); the importer regenerates every id so an import never collides
 * with existing skills and never re-links to a foreign library entry.
 */

const SKILL_SET_VERSION = 1 as const;

const SkillSetFile = z.object({
  version: z.literal(SKILL_SET_VERSION),
  skills: z.array(LibrarySkill).default([]),
});

/** Serialize skills to a portable JSON string. Strips ids down to the library shape. */
export function exportSkillSet(
  skills: { name: string; description?: string; instruction?: string; id?: string }[],
): string {
  const payload = {
    version: SKILL_SET_VERSION,
    skills: skills.map((s) => ({
      id: s.id ?? newSkillId(),
      name: s.name,
      description: s.description ?? '',
      instruction: s.instruction ?? '',
    })),
  };
  return JSON.stringify(payload, null, 2);
}

export interface SkillSetImportResult {
  ok: boolean;
  skills: LibrarySkillType[];
  error?: string;
}

/**
 * Parse and validate an imported skill-set JSON string. Every skill gets a fresh
 * id so the result can be appended anywhere without collisions.
 */
export function importSkillSet(text: string): SkillSetImportResult {
  if (text.length > MAX_IMPORT_BYTES) {
    return { ok: false, skills: [], error: 'File is too large to import.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, skills: [], error: 'File is not valid JSON.' };
  }

  const result = SkillSetFile.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    return {
      ok: false,
      skills: [],
      error: `Invalid skill set: ${first?.path.join('.')} ${first?.message}`.trim(),
    };
  }

  const skills = result.data.skills.map((s) => ({ ...s, id: newSkillId() }));
  return { ok: true, skills };
}
