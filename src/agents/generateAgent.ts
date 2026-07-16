import { z } from 'zod';
import {
  ColorCategory,
  PersonaCitationStyle,
  PersonaMode,
  type Agent,
  type LlmConfig,
  type PersonaConfig,
  type Skill,
} from '../domain/schema';
import { defaultCharacteristics, defaultLlmConfig } from '../domain/factories';
import { defaultPersonaConfig } from '../domain/persona';
import { newSkillId } from '../domain/ids';
import { ProviderError, retryEligible } from '../providers/errors';
import { sendChat } from '../providers/openaiAdapter';
import type { ChatMessage } from '../providers/types';
import type { Provider } from '../domain/schema';
import { parseGeneratedAgentDraftFromText } from './parseGeneratedAgentDraft';

/**
 * Agent generator. Turns a free-text description into a complete agent draft
 * (name, role, system instruction, characteristics, skills) via the given
 * provider. Mirrors enhancePrompt.ts's shape, scaled from one text field to a
 * structured JSON contract enforced by prompt instructions + zod validation —
 * there is no response_format/structured-output support in the provider layer.
 */

const GeneratedSkill = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(160).default(''),
  instruction: z.string().min(1).max(600),
});

const GeneratedPersona = z.object({
  realName: z.string().max(80).default(''),
  knownFor: z.string().max(200).default(''),
  stanceNotes: z.string().max(800).default(''),
  citationStyle: PersonaCitationStyle.default('in-character'),
});

export const GeneratedAgentDraft = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(300).default(''),
  role: z.string().min(1).max(80),
  systemInstruction: z.string().min(1).max(2000),
  language: z.enum(['en', 'fa', 'fr']).default('en'),
  // Optional (no default): omit ≠ "role", so enrich can preserve an existing
  // digital-shadow when the model forgets the field.
  personaMode: PersonaMode.optional(),
  persona: GeneratedPersona.optional(),
  characteristics: z
    .object({
      tone: z.string().max(40).default('neutral'),
      verbosity: z.number().min(0).max(100).default(50),
      creativity: z.number().min(0).max(100).default(50),
      assertiveness: z.number().min(0).max(100).default(50),
      skepticism: z.number().min(0).max(100).default(50),
      cooperation: z.number().min(0).max(100).default(50),
    })
    .default({}),
  colorCategory: ColorCategory.default('blue'),
  // Prompt asks for 1-3; the cap of 6 is a defensive backstop against a
  // runaway model, not a product requirement.
  skills: z.array(GeneratedSkill).max(6).default([]),
});
export type GeneratedAgentDraft = z.infer<typeof GeneratedAgentDraft>;

/**
 * Enrich variant of the draft contract. Enrichment revises an EXISTING agent, so
 * a field the model omits must mean "leave it unchanged" — not "reset to the
 * default". The create-path defaults (language 'en', all characteristics 50,
 * colorCategory 'blue', empty description/skills) would silently wipe tuned
 * values on any partial model reply, so here those fields are optional with no
 * default and the caller (enrichedDraftToAgentOverrides) applies them only when
 * present. `personaMode`/`persona` are already optional on the base schema for
 * the same reason. Required identity fields (name/role/systemInstruction) stay
 * required so an empty/garbage reply is still rejected.
 */
export const EnrichAgentDraft = GeneratedAgentDraft.extend({
  description: z.string().max(300).optional(),
  language: z.enum(['en', 'fa', 'fr']).optional(),
  colorCategory: ColorCategory.optional(),
  characteristics: z
    .object({
      tone: z.string().max(40).optional(),
      verbosity: z.number().min(0).max(100).optional(),
      creativity: z.number().min(0).max(100).optional(),
      assertiveness: z.number().min(0).max(100).optional(),
      skepticism: z.number().min(0).max(100).optional(),
      cooperation: z.number().min(0).max(100).optional(),
    })
    .optional(),
  skills: z.array(GeneratedSkill).max(6).optional(),
});
export type EnrichAgentDraft = z.infer<typeof EnrichAgentDraft>;

const GENERATE_SYSTEM_PROMPT = [
  'You are an agent designer. You turn a short natural-language description into',
  'a single AI agent configuration for a multi-agent conversation tool.',
  '',
  'Return ONLY a single JSON object with exactly these fields — no markdown',
  'fences, no commentary before or after, no trailing text. Keep string values',
  'concise (especially systemInstruction) so the whole object fits in one reply:',
  '{',
  '  "name": string,                // short display name, e.g. "Skeptical Analyst"',
  '  "description": string,         // one sentence summary of the agent, may be empty',
  '  "role": string,                // short role label, e.g. "Financial analyst"',
  '  "systemInstruction": string,   // the instruction the agent will act on; be specific and concrete',
  '  "language": "en" | "fa" | "fr",// language the agent converses in; default "en" unless the description implies otherwise',
  '  "personaMode": "role" | "digital-shadow",',
  '  "persona": {                   // required when personaMode is "digital-shadow"; omit or empty for role agents',
  '    "realName": string,          // full name of the real person',
  '    "knownFor": string,          // one-line public summary',
  '    "stanceNotes": string,       // short bullets of core public positions',
  '    "citationStyle": "in-character" | "attributed"  // default "in-character"',
  '  },',
  '  "characteristics": {',
  '    "tone": string,              // short adjective, e.g. "formal", "direct", "neutral"',
  '    "verbosity": number,         // 0-100: 0-33 concise, 34-66 balanced, 67-100 thorough/detailed',
  '    "creativity": number,        // 0-100: 0-33 conventional, 34-66 balanced, 67-100 creative/original',
  '    "assertiveness": number,     // 0-100: 0-33 tentative/hedging, 34-66 balanced, 67-100 direct/confident',
  '    "skepticism": number,        // 0-100: 0-33 trusting, 34-66 balanced, 67-100 challenges claims/demands evidence',
  '    "cooperation": number        // 0-100: 0-33 independent judgement, 34-66 balanced, 67-100 seeks consensus',
  '  },',
  '  "colorCategory": "slate" | "blue" | "green" | "amber" | "red" | "violet" | "teal",',
  '  "skills": [                    // usually 1-3 declared capabilities, not executable tools',
  '    { "name": string, "description": string, "instruction": string }',
  '  ]',
  '}',
  '',
  'Persona intent (choose carefully — do not confuse these):',
  '- DIGITAL SHADOW when the user asks to mimic, be, speak as, digitally shadow, or role-play a',
  '  named real person ("mimic Thomas Nagel", "as Ada Lovelace", "digital shadow of …").',
  '  Then: personaMode="digital-shadow"; name = the person\'s real name (NOT "X\'s Advocate");',
  '  role = "Digital shadow of {realName}"; systemInstruction in first person (I argue…);',
  '  fill persona.realName, knownFor, stanceNotes; citationStyle "in-character" unless asked otherwise.',
  '- ROLE / ADVOCATE when the user asks to advocate for, explain, criticise, or summarise a',
  '  person\'s views from the outside ("Nagel\'s advocate", "philosophical explainer of X").',
  '  Then: personaMode="role"; third-person commentary is fine; omit persona or leave it empty.',
  '- Otherwise default personaMode="role".',
  '',
  'Example, for the description "a skeptical reviewer who challenges claims":',
  '{"name":"Critic","description":"Skeptically reviews claims and evidence.","role":"Skeptical reviewer","systemInstruction":"Critically evaluate the previous responses. Challenge unsupported claims and identify weaknesses.","language":"en","personaMode":"role","characteristics":{"tone":"direct","verbosity":50,"creativity":40,"assertiveness":70,"skepticism":85,"cooperation":35},"colorCategory":"red","skills":[{"name":"critique","description":"Critical review","instruction":"Focus on factual weaknesses and logical gaps."}]}',
].join('\n');

function buildUserMessage(description: string): string {
  return `Generate an agent for the following description:\n\n${description.trim()}`;
}

/** Headroom for a full agent draft; reasoning models often spend many tokens thinking first. */
const GENERATE_MAX_OUTPUT_TOKENS = 8192;

/**
 * Reasoning models (Qwen, DeepSeek, etc.) often embed thinking in the visible
 * content as XML-ish tags. Those blocks frequently contain `{...}` examples that
 * would otherwise steal the first brace match from the real draft.
 */
export function stripReasoningArtifacts(raw: string): string {
  return raw
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<reasoning\b[^>]*>[\s\S]*?<\/reasoning>/gi, '')
    .replace(/<\/(?:think|thinking|reasoning)\s*>/gi, '')
    .trim();
}

/**
 * Extract a balanced `{...}` starting at `start`, respecting JSON string escapes
 * so braces inside string values do not end the object early.
 */
function extractBalancedObject(text: string, start: number): string | null {
  if (text[start] !== '{') return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Strip reasoning tags and markdown fences, then extract the outermost balanced
 * {...} object — models often wrap JSON in a preamble/trailing note even when
 * told not to. Unlike cleanEnhancedText, this never unwraps quotes: that would
 * corrupt JSON string values.
 */
export function cleanJsonText(raw: string): string {
  let text = stripReasoningArtifacts(raw);

  const fence = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i);
  if (fence) text = fence[1].trim();

  const start = text.indexOf('{');
  if (start === -1) return text;

  return extractBalancedObject(text, start) ?? text;
}

/**
 * Parse the first JSON object that validates as parseable. Tries cleanJsonText
 * first, then every `{` start — so a thinking preamble that discusses `{schema}`
 * examples does not permanently poison extraction.
 */
export function parseJsonObject(raw: string): unknown {
  const primary = cleanJsonText(raw);
  try {
    return JSON.parse(primary);
  } catch {
    // fall through
  }

  const text = stripReasoningArtifacts(raw);
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    const candidate = extractBalancedObject(text, i);
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // try the next `{`
    }
  }
  throw new SyntaxError('No valid JSON object found in model response');
}

export interface GenerateAgentOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Streaming preview passthrough only — never parsed mid-stream. */
  onToken?: (chunk: string) => void;
  /** Reasoning/thinking token passthrough for reasoning models — never parsed. */
  onReasoningToken?: (chunk: string) => void;
}

export interface GenerateAgentResult {
  ok: boolean;
  draft?: GeneratedAgentDraft;
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
 * Ask the provider to generate a full agent draft from a free-text
 * description. Returns a result object; never throws for provider/network/
 * parse failures.
 */
export async function generateAgentDraft(
  description: string,
  provider: Provider,
  model: string,
  options: GenerateAgentOptions = {},
): Promise<GenerateAgentResult> {
  const start = Date.now();

  if (!description.trim()) {
    return {
      ok: false,
      durationMs: 0,
      errorKind: 'empty-description',
      errorSummary: 'Describe the agent you want first.',
    };
  }
  if (!model.trim()) {
    return {
      ok: false,
      durationMs: 0,
      errorKind: 'no-model',
      errorSummary: 'No model selected for generation.',
    };
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: GENERATE_SYSTEM_PROMPT },
    { role: 'user', content: buildUserMessage(description) },
  ];

  try {
    const res = await sendChat(
      provider,
      { model, messages, temperature: 0.4, maxOutputTokens: GENERATE_MAX_OUTPUT_TOKENS },
      {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        onToken: options.onToken,
        onReasoningToken: options.onReasoningToken,
      },
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

    const parsed = parseGeneratedAgentDraftFromText(res.text);
    if (!parsed.ok) {
      if (parsed.failure === 'syntax') {
        const truncated = res.finishReason === 'length';
        return {
          ok: false,
          durationMs: Date.now() - start,
          errorKind: 'invalid-json',
          errorSummary: truncated
            ? 'The model ran out of output tokens before finishing valid JSON. Try again, or use a shorter description.'
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
      errorSummary: pe?.message ?? 'Unknown error while generating the agent.',
      errorDetail: pe?.detail,
      retryEligible: pe ? retryEligible(pe.kind) : false,
    };
  }
}

/**
 * Resolve persona mode for a create-from-draft path. Omitted → role.
 * Enrich uses a separate path that can preserve the previous agent's mode.
 */
export function resolvePersonaMode(
  draft: Pick<GeneratedAgentDraft, 'personaMode'>,
  fallback: Agent['personaMode'] = 'role',
): Agent['personaMode'] {
  return draft.personaMode ?? fallback;
}

/** Map draft persona fields onto Agent.persona when in digital-shadow mode. */
export function personaFromDraft(
  draft: Pick<GeneratedAgentDraft, 'persona' | 'name'>,
  mode: Agent['personaMode'],
): PersonaConfig | undefined {
  if (mode !== 'digital-shadow') return undefined;
  const p = draft.persona;
  return defaultPersonaConfig({
    realName: p?.realName?.trim() || draft.name.trim(),
    knownFor: p?.knownFor ?? '',
    stanceNotes: p?.stanceNotes ?? '',
    citationStyle: p?.citationStyle ?? 'in-character',
  });
}

/** Map a generated draft onto the overrides createAgent() expects. */
export function draftToAgentOverrides(
  draft: GeneratedAgentDraft,
  llmOverride?: Partial<LlmConfig>,
): Partial<Agent> {
  const skills: Skill[] = draft.skills.map((s) => ({
    id: newSkillId(),
    name: s.name,
    description: s.description,
    instruction: s.instruction,
    enabled: true,
  }));

  const personaMode = resolvePersonaMode(draft, 'role');
  const persona = personaFromDraft(draft, personaMode);

  return {
    name: draft.name,
    description: draft.description,
    role: draft.role,
    systemInstruction: draft.systemInstruction,
    language: draft.language,
    personaMode,
    ...(persona ? { persona } : {}),
    colorCategory: draft.colorCategory,
    characteristics: { ...defaultCharacteristics(), ...draft.characteristics },
    skills,
    ...(llmOverride ? { llm: { ...defaultLlmConfig(), ...llmOverride } } : {}),
  };
}
