/**
 * Coerce common LLM shape drift into the GeneratedAgentDraft Zod contract.
 * Domain types stay strict — this runs only at the LLM JSON boundary.
 */

export function coerceString(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string | number | boolean =>
        typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
      )
      .map(String)
      .join('\n');
  }
  return value;
}

/** Join string arrays as markdown-ish bullets (fixes stanceNotes-as-array). */
export function coerceBulletString(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string | number | boolean =>
        typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
      )
      .map((item) => {
        const s = String(item).trim();
        if (!s) return s;
        return s.startsWith('-') ? s : `- ${s}`;
      })
      .filter(Boolean)
      .join('\n');
  }
  return coerceString(value);
}

export function coerceBoundedNumber(value: unknown, min: number, max: number): unknown {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(max, Math.max(min, value));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
  }
  return value;
}

/** null / non-objects → undefined so optional nested blocks are omitted. */
export function coerceRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

const CHAR_NUMBER_KEYS = [
  'verbosity',
  'creativity',
  'assertiveness',
  'skepticism',
  'cooperation',
] as const;

/**
 * Walk only the known draft shape and coerce harmless type drift.
 * Unknown / unrecoverable values are left alone for Zod to reject.
 */
export function normalizeGeneratedAgentDraft(raw: unknown): unknown {
  const root = coerceRecord(raw);
  if (!root) return raw;

  const out: Record<string, unknown> = { ...root };

  for (const key of ['name', 'description', 'role', 'systemInstruction'] as const) {
    if (key in out) out[key] = coerceString(out[key]);
  }

  if ('persona' in out) {
    const persona = coerceRecord(out.persona);
    if (persona === undefined) {
      delete out.persona;
    } else {
      out.persona = {
        ...persona,
        realName: coerceString(persona.realName),
        knownFor: coerceString(persona.knownFor),
        stanceNotes: coerceBulletString(persona.stanceNotes),
      };
    }
  }

  if ('characteristics' in out) {
    const chars = coerceRecord(out.characteristics);
    if (chars === undefined) {
      delete out.characteristics;
    } else {
      const next: Record<string, unknown> = { ...chars };
      if ('tone' in next) next.tone = coerceString(next.tone);
      for (const key of CHAR_NUMBER_KEYS) {
        if (key in next) next[key] = coerceBoundedNumber(next[key], 0, 100);
      }
      out.characteristics = next;
    }
  }

  if (Array.isArray(out.skills)) {
    out.skills = out.skills.map((skill) => {
      const s = coerceRecord(skill);
      if (!s) return skill;
      return {
        ...s,
        name: coerceString(s.name),
        description: coerceString(s.description),
        instruction: coerceString(s.instruction),
      };
    });
  }

  return out;
}
