import {
  GeneratedAgentDraft,
  parseJsonObject,
  type GeneratedAgentDraft as Draft,
} from './generateAgent';
import { normalizeGeneratedAgentDraft } from './normalizeGeneratedAgentDraft';

export type ParseGeneratedAgentDraftResult =
  | { ok: true; draft: Draft }
  | {
      ok: false;
      errorKind: 'invalid-json';
      /** syntax = JSON/extraction failure; shape = Zod rejected after normalize */
      failure: 'syntax' | 'shape';
      errorSummary: string;
      errorDetail?: string;
    };

/**
 * Shared LLM-boundary parse: extract JSON → coerce known shape drift → Zod validate.
 * Used by generate, enrich, and UI "Recover draft".
 */
export function parseGeneratedAgentDraftFromText(rawText: string): ParseGeneratedAgentDraftResult {
  let parsed: unknown;
  try {
    parsed = parseJsonObject(rawText);
  } catch {
    return {
      ok: false,
      errorKind: 'invalid-json',
      failure: 'syntax',
      errorSummary: 'The model did not return valid JSON.',
    };
  }

  const result = GeneratedAgentDraft.safeParse(normalizeGeneratedAgentDraft(parsed));
  if (!result.success) {
    return {
      ok: false,
      errorKind: 'invalid-json',
      failure: 'shape',
      errorSummary: "The model's JSON did not match the expected agent shape.",
      errorDetail: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }

  return { ok: true, draft: result.data };
}
