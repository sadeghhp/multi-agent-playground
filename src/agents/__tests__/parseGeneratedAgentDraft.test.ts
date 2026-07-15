import { describe, expect, it } from 'vitest';
import { parseGeneratedAgentDraftFromText } from '../parseGeneratedAgentDraft';

const VALID = {
  name: 'Critic',
  description: 'Skeptically reviews claims.',
  role: 'Skeptical reviewer',
  systemInstruction: 'Challenge unsupported claims.',
  language: 'en',
  characteristics: {
    tone: 'direct',
    verbosity: 50,
    creativity: 40,
    assertiveness: 70,
    skepticism: 85,
    cooperation: 35,
  },
  colorCategory: 'red',
  skills: [{ name: 'critique', description: 'Critical review', instruction: 'Focus on weaknesses.' }],
};

describe('parseGeneratedAgentDraftFromText', () => {
  it('parses valid JSON into a draft', () => {
    const result = parseGeneratedAgentDraftFromText(JSON.stringify(VALID));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.name).toBe('Critic');
  });

  it('normalizes stanceNotes arrays before validating', () => {
    const raw = JSON.stringify({
      ...VALID,
      name: 'Thomas Nagel',
      personaMode: 'digital-shadow',
      persona: {
        realName: 'Thomas Nagel',
        knownFor: 'Mind',
        stanceNotes: ['Qualia are real'],
        citationStyle: 'in-character',
      },
    });
    const result = parseGeneratedAgentDraftFromText(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.persona?.stanceNotes).toBe('- Qualia are real');
  });

  it('returns a syntax failure for non-JSON', () => {
    const result = parseGeneratedAgentDraftFromText('not json at all');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toBe('syntax');
      expect(result.errorKind).toBe('invalid-json');
    }
  });

  it('returns a shape failure with errorDetail for wrong schema', () => {
    const result = parseGeneratedAgentDraftFromText(JSON.stringify({ foo: 'bar' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toBe('shape');
      expect(result.errorDetail).toBeTruthy();
    }
  });
});
