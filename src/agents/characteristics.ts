import type { Characteristics } from '../domain/schema';

/**
 * Convert structured characteristics into an instruction fragment (spec §7.2).
 * No behavioural engine — just a deterministic mapping from 0..100 scales to
 * plain-language directives that get appended to the system prompt.
 */

function band(v: number, low: string, mid: string, high: string): string | null {
  if (v <= 33) return low;
  if (v >= 67) return high;
  return mid === '' ? null : mid;
}

export function characteristicsToInstruction(c: Characteristics): string {
  const parts: string[] = [];

  if (c.tone && c.tone.trim() && c.tone !== 'neutral') {
    parts.push(`Maintain a ${c.tone.trim()} tone.`);
  }

  const verbosity = band(
    c.verbosity,
    'Be concise and to the point.',
    '',
    'Provide thorough, detailed responses.',
  );
  if (verbosity) parts.push(verbosity);

  const creativity = band(
    c.creativity,
    'Prefer conventional, well-established reasoning.',
    '',
    'Offer creative and original ideas.',
  );
  if (creativity) parts.push(creativity);

  const assertiveness = band(
    c.assertiveness,
    'State views tentatively and acknowledge uncertainty.',
    '',
    'State positions directly and confidently.',
  );
  if (assertiveness) parts.push(assertiveness);

  const skepticism = band(
    c.skepticism,
    'Give other participants the benefit of the doubt.',
    '',
    'Challenge unsupported claims and demand evidence.',
  );
  if (skepticism) parts.push(skepticism);

  const cooperation = band(
    c.cooperation,
    'Prioritize independent judgement over consensus.',
    '',
    'Build on others’ contributions and seek common ground.',
  );
  if (cooperation) parts.push(cooperation);

  return parts.join(' ');
}
