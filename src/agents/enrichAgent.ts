import type { Agent, Provider } from '../domain/schema';
import { newSkillId } from '../domain/ids';
import { ProviderError, retryEligible } from '../providers/errors';
import { sendChat } from '../providers/openaiAdapter';
import type { ChatMessage } from '../providers/types';
import {
  personaFromDraft,
  resolvePersonaMode,
  type EnrichAgentDraft,
} from './generateAgent';
import { parseEnrichAgentDraftFromText } from './parseGeneratedAgentDraft';

/**
 * Agent enricher. Takes an existing agent plus free-text "here's new
 * information about this agent" notes, and asks the model to mature the
 * agent's full spec (role, system instruction, characteristics, skills)
 * around that new information. Shares its JSON contract and parsing with
 * generateAgent.ts — the difference is the prompt gives the model the
 * agent's current configuration to revise rather than starting blank.
 */

const ENRICH_SYSTEM_PROMPT = [
  'You are an agent designer. You are given the current configuration of an',
  'existing AI agent and new information the user has learned about it. Update',
  'the agent configuration to incorporate the new information: refine the role',
  'and system instruction where the new information calls for it, adjust',
  'behavioural characteristics if warranted, and add, edit, or remove declared',
  'skills to reflect the agent\'s matured capabilities. Preserve everything the',
  'new information does not touch — do not invent unrelated changes.',
  '',
  'Preserve personaMode and persona unless the new information explicitly changes',
  'persona intent (e.g. switching from an advocate/explainer to a digital shadow,',
  'or the reverse). For digital-shadow agents, keep first-person systemInstruction',
  'voice and do not rename them to "X\'s Advocate".',
  '',
  'Return ONLY a single JSON object with exactly these fields — no markdown',
  'fences, no commentary before or after, no trailing text. Keep string values',
  'concise (especially systemInstruction) so the whole object fits in one reply:',
  '{',
  '  "name": string,',
  '  "description": string,',
  '  "role": string,',
  '  "systemInstruction": string,',
  '  "language": "en" | "fa" | "fr",',
  '  "personaMode": "role" | "digital-shadow",',
  '  "persona": {                   // when personaMode is "digital-shadow"',
  '    "realName": string,',
  '    "knownFor": string,',
  '    "stanceNotes": string,',
  '    "citationStyle": "in-character" | "attributed"',
  '  },',
  '  "characteristics": {',
  '    "tone": string,',
  '    "verbosity": number,       // 0-100',
  '    "creativity": number,      // 0-100',
  '    "assertiveness": number,   // 0-100',
  '    "skepticism": number,      // 0-100',
  '    "cooperation": number      // 0-100',
  '  },',
  '  "colorCategory": "slate" | "blue" | "green" | "amber" | "red" | "violet" | "teal",',
  '  "skills": [',
  '    { "name": string, "description": string, "instruction": string }',
  '  ]',
  '}',
].join('\n');

function buildUserMessage(agent: Agent, newInfo: string): string {
  const current = {
    name: agent.name,
    description: agent.description,
    role: agent.role,
    systemInstruction: agent.systemInstruction,
    language: agent.language,
    personaMode: agent.personaMode,
    persona: agent.persona,
    characteristics: agent.characteristics,
    colorCategory: agent.colorCategory,
    skills: agent.skills.map((s) => ({ name: s.name, description: s.description, instruction: s.instruction })),
  };
  return [
    'Current agent configuration (JSON):',
    JSON.stringify(current, null, 2),
    '',
    'New information to incorporate:',
    newInfo.trim(),
    '',
    'Output the updated agent configuration now, as a single JSON object matching the schema.',
  ].join('\n');
}

/** Headroom for a full agent draft; reasoning models often spend many tokens thinking first. */
const ENRICH_MAX_OUTPUT_TOKENS = 8192;

export interface EnrichAgentOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Model to use; defaults to the agent's configured model. */
  model?: string;
}

export interface EnrichAgentResult {
  ok: boolean;
  draft?: EnrichAgentDraft;
  model?: string;
  durationMs: number;
  errorKind?: string;
  errorSummary?: string;
  errorDetail?: string;
  /** Raw model output, set when the reply couldn't be parsed into a draft. */
  rawText?: string;
  retryEligible?: boolean;
}

/**
 * Ask the provider to mature this agent's configuration around new free-text
 * information. Returns a result object; never throws for provider/network/
 * parse failures.
 */
export async function enrichAgentDraft(
  agent: Agent,
  newInfo: string,
  provider: Provider,
  options: EnrichAgentOptions = {},
): Promise<EnrichAgentResult> {
  const start = Date.now();

  if (!newInfo.trim()) {
    return {
      ok: false,
      durationMs: 0,
      errorKind: 'empty-info',
      errorSummary: 'Describe what changed or what you learned about this agent first.',
    };
  }

  const model = options.model?.trim() || agent.llm.model;
  if (!model) {
    return {
      ok: false,
      durationMs: 0,
      errorKind: 'no-model',
      errorSummary: 'No model selected for this agent.',
    };
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: ENRICH_SYSTEM_PROMPT },
    { role: 'user', content: buildUserMessage(agent, newInfo) },
  ];

  try {
    const res = await sendChat(
      provider,
      { model, messages, temperature: 0.4, maxOutputTokens: ENRICH_MAX_OUTPUT_TOKENS },
      { signal: options.signal, timeoutMs: options.timeoutMs },
    );

    if (!res.text.trim()) {
      return {
        ok: false,
        durationMs: Date.now() - start,
        errorKind: 'empty-response',
        errorSummary: res.reasoning
          ? 'The model spent its whole response reasoning and never produced a visible answer.'
          : 'The model returned an empty response.',
        rawText: res.reasoning || undefined,
      };
    }

    const parsed = parseEnrichAgentDraftFromText(res.text);
    if (!parsed.ok) {
      if (parsed.failure === 'syntax') {
        const truncated = res.finishReason === 'length';
        return {
          ok: false,
          durationMs: Date.now() - start,
          errorKind: 'invalid-json',
          errorSummary: truncated
            ? 'The model ran out of output tokens before finishing valid JSON. Try again, or shorten the new information.'
            : parsed.errorSummary,
          rawText: res.text,
          retryEligible: truncated,
        };
      }
      return {
        ok: false,
        durationMs: Date.now() - start,
        errorKind: 'invalid-json',
        errorSummary: parsed.errorSummary,
        errorDetail: parsed.errorDetail,
        rawText: res.text,
      };
    }

    return { ok: true, draft: parsed.draft, model: res.model, durationMs: Date.now() - start };
  } catch (err) {
    const pe = err instanceof ProviderError ? err : null;
    return {
      ok: false,
      durationMs: Date.now() - start,
      errorKind: pe?.kind ?? 'unknown',
      errorSummary: pe?.message ?? 'Unknown error while enriching the agent.',
      errorDetail: pe?.detail,
      retryEligible: pe ? retryEligible(pe.kind) : false,
    };
  }
}

/**
 * Map an enriched draft onto Agent overrides, preserving skill identity
 * (id, libraryId, enabled) for skills the draft kept by name so existing
 * library links and toggles survive a re-enrichment.
 */
export function enrichedDraftToAgentOverrides(agent: Agent, draft: EnrichAgentDraft): Partial<Agent> {
  // Preserve existing digital-shadow mode when the model omits personaMode.
  const personaMode = resolvePersonaMode(draft, agent.personaMode);
  let persona: Agent['persona'];
  if (personaMode === 'digital-shadow') {
    // Only rebuild persona from the draft when the model supplied it; otherwise
    // keep the agent's existing grounding (stance notes, etc.).
    persona = draft.persona
      ? personaFromDraft(draft, personaMode)
      : agent.persona ?? personaFromDraft(draft, personaMode);
  } else {
    persona = undefined;
  }

  // Enrich preserves anything the model didn't return: only fields present on
  // the draft override the agent. `characteristics` merges key-by-key so a
  // partial block leaves the untouched sliders alone; an omitted block leaves
  // them all alone. `skills`/`language`/`description`/`colorCategory` apply only
  // when the model actually supplied them.
  const overrides: Partial<Agent> = {
    name: draft.name,
    role: draft.role,
    systemInstruction: draft.systemInstruction,
    personaMode,
    persona,
  };
  if (draft.description !== undefined) overrides.description = draft.description;
  if (draft.language !== undefined) overrides.language = draft.language;
  if (draft.colorCategory !== undefined) overrides.colorCategory = draft.colorCategory;
  if (draft.characteristics !== undefined) {
    overrides.characteristics = { ...agent.characteristics, ...draft.characteristics };
  }
  if (draft.skills !== undefined) {
    const existingByName = new Map(agent.skills.map((s) => [s.name.trim().toLowerCase(), s]));
    overrides.skills = draft.skills.map((s) => {
      const existing = existingByName.get(s.name.trim().toLowerCase());
      return {
        id: existing?.id ?? newSkillId(),
        name: s.name,
        description: s.description,
        instruction: s.instruction,
        enabled: existing?.enabled ?? true,
        libraryId: existing?.libraryId,
      };
    });
  }
  return overrides;
}
