import { z } from 'zod';
import {
  GeneratedAgentDraft,
  EnrichAgentDraft,
  parseJsonObject,
  type GeneratedAgentDraft as Draft,
  type EnrichAgentDraft as EnrichDraft,
} from './generateAgent';
import { normalizeGeneratedAgentDraft } from './normalizeGeneratedAgentDraft';

export type ParseDraftResult<T> =
  | { ok: true; draft: T }
  | {
      ok: false;
      errorKind: 'invalid-json';
      /** syntax = JSON/extraction failure; shape = Zod rejected after normalize */
      failure: 'syntax' | 'shape';
      errorSummary: string;
      errorDetail?: string;
    };

/** Back-compat alias for the generate-path result type. */
export type ParseGeneratedAgentDraftResult = ParseDraftResult<Draft>;

/**
 * Shared LLM-boundary parse: extract JSON → coerce known shape drift → Zod validate
 * against the given schema. Parameterized by schema so the create path enforces
 * full defaults while the enrich path preserves omitted fields.
 */
function parseDraftWithSchema<S extends z.ZodTypeAny>(
  rawText: string,
  schema: S,
): ParseDraftResult<z.infer<S>> {
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

  const result = schema.safeParse(normalizeGeneratedAgentDraft(parsed));
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

/**
 * Parse a full agent draft (create / "Recover draft"): omitted optional fields
 * are filled with their create-path defaults.
 */
export function parseGeneratedAgentDraftFromText(rawText: string): ParseDraftResult<Draft> {
  return parseDraftWithSchema(rawText, GeneratedAgentDraft);
}

/**
 * Parse an enrichment draft: omitted fields stay omitted (undefined) so the
 * caller preserves the existing agent's values instead of resetting them.
 */
export function parseEnrichAgentDraftFromText(rawText: string): ParseDraftResult<EnrichDraft> {
  return parseDraftWithSchema(rawText, EnrichAgentDraft);
}
