import { describe, expect, it } from 'vitest';
import { GeneratedAgentDraft } from '../generateAgent';
import {
  coerceBoundedNumber,
  coerceBulletString,
  coerceString,
  normalizeGeneratedAgentDraft,
} from '../normalizeGeneratedAgentDraft';

const BASE_DRAFT = {
  name: 'Thomas Nagel',
  description: 'Philosopher of mind',
  role: 'Digital shadow of Thomas Nagel',
  systemInstruction: 'I defend the irreducibility of subjective experience.',
  language: 'en',
  personaMode: 'digital-shadow',
  characteristics: {
    tone: 'precise',
    verbosity: 60,
    creativity: 40,
    assertiveness: 55,
    skepticism: 70,
    cooperation: 45,
  },
  colorCategory: 'blue',
  skills: [{ name: 'contrast', description: 'Compare views', instruction: 'Contrast with Chalmers and Dennett.' }],
};

describe('coerceString', () => {
  it('joins string arrays with newlines', () => {
    expect(coerceString(['a', 'b'])).toBe('a\nb');
  });

  it('stringifies numbers', () => {
    expect(coerceString(42)).toBe('42');
  });

  it('passes null/undefined through', () => {
    expect(coerceString(null)).toBeNull();
    expect(coerceString(undefined)).toBeUndefined();
  });
});

describe('coerceBulletString', () => {
  it('prefixes array items with dashes', () => {
    expect(coerceBulletString(['a', 'b'])).toBe('- a\n- b');
  });

  it('preserves existing dashes', () => {
    expect(coerceBulletString(['- a', 'b'])).toBe('- a\n- b');
  });
});

describe('coerceBoundedNumber', () => {
  it('parses string numbers and clamps', () => {
    expect(coerceBoundedNumber('85', 0, 100)).toBe(85);
    expect(coerceBoundedNumber('150', 0, 100)).toBe(100);
    expect(coerceBoundedNumber('-5', 0, 100)).toBe(0);
  });

  it('leaves unparseable values alone', () => {
    expect(coerceBoundedNumber('nope', 0, 100)).toBe('nope');
  });
});

describe('normalizeGeneratedAgentDraft', () => {
  it('coerces stanceNotes array into a bullet string that passes Zod', () => {
    const normalized = normalizeGeneratedAgentDraft({
      ...BASE_DRAFT,
      persona: {
        realName: 'Thomas Nagel',
        knownFor: 'Philosophy of mind',
        stanceNotes: ['Qualia are real', 'What is it like to be a bat?'],
        citationStyle: 'in-character',
      },
    });
    const result = GeneratedAgentDraft.safeParse(normalized);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.persona?.stanceNotes).toBe(
        '- Qualia are real\n- What is it like to be a bat?',
      );
    }
  });

  it('joins knownFor arrays', () => {
    const normalized = normalizeGeneratedAgentDraft({
      ...BASE_DRAFT,
      persona: {
        realName: 'Thomas Nagel',
        knownFor: ['Bat paper', 'Moral Luck'],
        stanceNotes: '',
        citationStyle: 'in-character',
      },
    });
    const result = GeneratedAgentDraft.safeParse(normalized);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.persona?.knownFor).toBe('Bat paper\nMoral Luck');
    }
  });

  it('coerces string characteristic numbers', () => {
    const normalized = normalizeGeneratedAgentDraft({
      ...BASE_DRAFT,
      characteristics: {
        ...BASE_DRAFT.characteristics,
        skepticism: '85',
      },
    });
    const result = GeneratedAgentDraft.safeParse(normalized);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.characteristics.skepticism).toBe(85);
    }
  });

  it('omits persona when null', () => {
    const normalized = normalizeGeneratedAgentDraft({
      ...BASE_DRAFT,
      personaMode: 'role',
      persona: null,
    }) as Record<string, unknown>;
    expect(normalized.persona).toBeUndefined();
    expect(GeneratedAgentDraft.safeParse(normalized).success).toBe(true);
  });

  it('still fails Zod when required fields are missing', () => {
    const normalized = normalizeGeneratedAgentDraft({
      description: 'no name',
      role: 'x',
      systemInstruction: 'y',
    });
    expect(GeneratedAgentDraft.safeParse(normalized).success).toBe(false);
  });

  // F: one malformed skill shouldn't sink the whole draft — drop it, keep the rest.
  it('drops invalid skill entries instead of failing the whole draft', () => {
    const normalized = normalizeGeneratedAgentDraft({
      ...BASE_DRAFT,
      skills: [
        { name: 'good', description: 'ok', instruction: 'Do the thing.' },
        'a bare string skill',
        { name: '', instruction: 'no name' },
        { name: 'no-instruction' },
      ],
    }) as Record<string, unknown>;
    expect(normalized.skills).toHaveLength(1);
    expect((normalized.skills as Array<{ name: string }>)[0].name).toBe('good');
    expect(GeneratedAgentDraft.safeParse(normalized).success).toBe(true);
  });
});
