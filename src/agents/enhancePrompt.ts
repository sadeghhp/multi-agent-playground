import type { Agent, Provider } from '../domain/schema';
import { ProviderError, retryEligible } from '../providers/errors';
import { sendChat } from '../providers/openaiAdapter';
import type { ChatMessage } from '../providers/types';
import { characteristicsToInstruction } from './characteristics';

/**
 * System-prompt enhancer. Uses the agent's own LLM provider to rewrite its
 * free-text `systemInstruction` into a clearer, more effective version, while
 * keeping the agent's identity, role, characteristics and skills coherent.
 *
 * Mirrors testConnection.ts: a thin, testable wrapper around sendChat that never
 * throws to the UI — it returns a discriminated result the caller can render.
 */

const META_SYSTEM_PROMPT = [
  'You are a prompt engineer. You improve system prompts for AI agents.',
  'Rewrite the agent instruction you are given so it is clearer, more specific,',
  'and more effective, while preserving its original intent, the agent’s role,',
  'and any concrete constraints already present. Do not invent new capabilities',
  'or tools the agent was not given. Keep it reasonably concise.',
  '',
  'Return ONLY the rewritten instruction as plain text. Do not add a preamble,',
  'explanation, commentary, headings, quotes, or Markdown code fences.',
].join('\n');

/** Assemble the context the model needs to rewrite coherently. */
function buildUserMessage(agent: Agent): string {
  const lines: string[] = [];
  lines.push(`Agent name: ${agent.name || '(unnamed)'}`);
  if (agent.role.trim()) lines.push(`Role: ${agent.role.trim()}`);
  if (agent.description.trim()) lines.push(`Description: ${agent.description.trim()}`);
  const characteristics = characteristicsToInstruction(agent.characteristics);
  if (characteristics) lines.push(`Behavioural characteristics: ${characteristics}`);
  const skills = agent.skills.filter((s) => s.enabled).map((s) => s.name).filter(Boolean);
  if (skills.length > 0) lines.push(`Declared skills: ${skills.join(', ')}`);
  lines.push('');
  const current = agent.systemInstruction.trim();
  lines.push('Current system instruction to improve:');
  lines.push(current ? current : '(none — write a fitting instruction for the role above)');
  lines.push('');
  lines.push('Rewrite it now. Output only the improved instruction text.');
  return lines.join('\n');
}

/**
 * Strip the conversational wrappers models reflexively add even when told not to:
 * fenced code blocks, wrapping quotes, and a leading "Here is …:" line.
 */
export function cleanEnhancedText(raw: string): string {
  let text = raw.trim();

  // Unwrap a single fenced code block that spans the whole reply.
  const fence = text.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  if (fence) text = fence[1].trim();

  // Drop a leading "Sure! Here is the improved instruction:" style preamble line,
  // but only when real content follows it. Models commonly separate the preamble
  // from the real content with either a blank line OR just a single newline —
  // match either (`\n+`) rather than requiring a blank line specifically.
  const preamble = text.match(/^(?:sure[,!. ]|certainly[,!. ]|here(?:'s| is| are)\b|improved\b)[^\n]*\n+([\s\S]+)$/i);
  if (preamble && preamble[1].trim()) text = preamble[1].trim();

  // Unwrap symmetric surrounding quotes.
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith('“') && text.endsWith('”'))
  ) {
    text = text.slice(1, -1).trim();
  }

  return text;
}

export interface EnhancePromptResult {
  ok: boolean;
  /** Cleaned, ready-to-apply instruction on success. */
  text?: string;
  model?: string;
  durationMs: number;
  /** Sanitized error info on failure — never contains credentials. */
  errorKind?: string;
  errorSummary?: string;
  errorDetail?: string;
  retryEligible?: boolean;
}

export interface EnhancePromptOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Model to use; defaults to the agent's configured model. */
  model?: string;
}

/**
 * Ask the provider to rewrite this agent's system instruction. Returns a result
 * object; never throws for provider/network failures.
 */
export async function enhanceSystemInstruction(
  agent: Agent,
  provider: Provider,
  options: EnhancePromptOptions = {},
): Promise<EnhancePromptResult> {
  const start = Date.now();
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
    { role: 'system', content: META_SYSTEM_PROMPT },
    { role: 'user', content: buildUserMessage(agent) },
  ];

  try {
    const res = await sendChat(
      provider,
      {
        model,
        messages,
        temperature: 0.4,
        // Give the rewrite room — the agent's own maxOutputTokens (default 8192)
        // can still truncate a longer instruction mid-sentence (finishReason: 'length').
        maxOutputTokens: Math.max(agent.llm.maxOutputTokens, 2048),
      },
      { signal: options.signal, timeoutMs: options.timeoutMs },
    );

    const text = cleanEnhancedText(res.text);
    if (!text) {
      return {
        ok: false,
        durationMs: Date.now() - start,
        errorKind: 'empty-response',
        errorSummary: 'The model returned an empty instruction.',
      };
    }

    return { ok: true, text, model: res.model, durationMs: Date.now() - start };
  } catch (err) {
    const pe = err instanceof ProviderError ? err : null;
    return {
      ok: false,
      durationMs: Date.now() - start,
      errorKind: pe?.kind ?? 'unknown',
      errorSummary: pe?.message ?? 'Unknown error while enhancing the prompt.',
      errorDetail: pe?.detail,
      retryEligible: pe ? retryEligible(pe.kind) : false,
    };
  }
}
