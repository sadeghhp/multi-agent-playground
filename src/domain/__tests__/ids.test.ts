import { describe, expect, it } from 'vitest';
import {
  newAgentId,
  newConnectionId,
  newErrorId,
  newLibraryAgentId,
  newLogId,
  newMessageId,
  newPlaygroundId,
  newPriceId,
  newProviderId,
  newRunId,
  newRunPresetId,
  newSkillId,
  newUsageId,
} from '../ids';

// Random suffix alphabet: lowercase letters minus l/o, plus digits 2-9 (32 chars).
const SUFFIX_RE = /^[a-kmnp-z2-9]{8}$/;

const GENERATORS: [string, string, () => string][] = [
  ['pg', 'newPlaygroundId', newPlaygroundId],
  ['lib', 'newLibraryAgentId', newLibraryAgentId],
  ['rp', 'newRunPresetId', newRunPresetId],
  ['ag', 'newAgentId', newAgentId],
  ['cn', 'newConnectionId', newConnectionId],
  ['pv', 'newProviderId', newProviderId],
  ['sk', 'newSkillId', newSkillId],
  ['msg', 'newMessageId', newMessageId],
  ['run', 'newRunId', newRunId],
  ['log', 'newLogId', newLogId],
  ['err', 'newErrorId', newErrorId],
  ['usg', 'newUsageId', newUsageId],
  ['prc', 'newPriceId', newPriceId],
];

describe.each(GENERATORS)('%s (%s)', (prefix, _name, generate) => {
  it('produces "<prefix>_" followed by an 8-char alphanumeric suffix', () => {
    const id = generate();
    const [idPrefix, suffix] = id.split('_');
    expect(idPrefix).toBe(prefix);
    expect(suffix).toMatch(SUFFIX_RE);
  });

  it('never emits the ambiguous characters 0, 1, l, o', () => {
    const suffix = generate().slice(prefix.length + 1);
    expect(suffix).not.toMatch(/[01lo]/);
  });

  it('produces no duplicates across 5000 draws', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => generate()));
    expect(ids.size).toBe(5000);
  });
});
