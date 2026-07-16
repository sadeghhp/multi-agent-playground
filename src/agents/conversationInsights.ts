import type { Agent, Playground, Provider } from '../domain/schema';
import type { LlmSettings } from '../domain/llmSettings';
import { ProviderError, retryEligible } from '../providers/errors';
import { extractInlineThinking, sendChat } from '../providers/openaiAdapter';
import type { ChatMessage } from '../providers/types';
import { visibleAnswerText } from './promptAssembly';

/**
 * On-demand conversation insights for the timeline (spec extension): a one-shot
 * "summarize" or "review" of the current transcript, generated outside the run
 * loop so it never touches the transcript or scheduling. Mirrors
 * enhancePrompt.ts: a thin wrapper around sendChat that never throws to the UI.
 */

export type InsightKind = 'summary' | 'review';

const INSIGHT_SYSTEM: Record<InsightKind, string> = {
  summary: [
    'You summarize a multi-agent discussion transcript.',
    'Produce a concise, faithful summary of what was actually said — the main positions, points of agreement, and points still in dispute, attributing them to the agents that made them.',
    'Include only content present in the transcript: add no new opinions, arguments, or filler, and do not resolve disputes yourself.',
    'Answer in Markdown. Start with a one-paragraph overview, then short sections or bullets.',
  ].join(' '),
  review: [
    'You review the quality of a multi-agent discussion transcript.',
    'Assess whether the stated objective was met, what each agent concretely contributed, which claims went unchallenged or unsupported, and what remains unresolved.',
    'Ground every observation in the transcript — quote or paraphrase specific turns; do not invent content.',
    'End with 2-4 concrete suggestions for how to steer the next rounds (e.g. what to ask, which agent to press).',
    'Answer in Markdown with short sections.',
  ].join(' '),
};

/** Insight prompts read the whole conversation, but bounded so a very long run
 * cannot overflow the model (mirrors the orchestrator's terminal budget). */
const INSIGHT_HISTORY_CHAR_BUDGET = 48_000;

/** Render the transcript for the prompt: newest-fitting window of completed,
 * visible answers (plus user interjections), oldest first. */
export function renderTranscriptForInsight(pg: Playground): string {
  const lines: string[] = [];
  let used = 0;
  for (let i = pg.transcript.length - 1; i >= 0; i--) {
    const m = pg.transcript[i];
    if (m.status !== 'completed') continue;
    const answer = m.agentId === null ? m.content.trim() : visibleAnswerText(m);
    if (!answer) continue;
    const speaker = m.agentId === null ? 'User' : `${m.agentName}${m.role ? ` (${m.role})` : ''}`;
    const line = `[Turn ${m.turn}] ${speaker}:\n${answer}`;
    if (used + line.length > INSIGHT_HISTORY_CHAR_BUDGET && lines.length > 0) break;
    lines.push(line);
    used += line.length;
  }
  return lines.reverse().join('\n\n');
}

function buildUserMessage(kind: InsightKind, pg: Playground): string {
  const parts: string[] = [];
  if (pg.conversation.subject) parts.push(`Subject: ${pg.conversation.subject}`);
  if (pg.conversation.objective) parts.push(`Objective: ${pg.conversation.objective}`);
  parts.push('', 'Transcript:', renderTranscriptForInsight(pg), '');
  parts.push(kind === 'summary' ? 'Summarize the discussion now.' : 'Review the discussion now.');
  return parts.join('\n');
}

/**
 * The agent whose provider/model an insight call borrows: a summarizer is the
 * natural fit, then a finalizer/moderator (they already see the whole
 * conversation), then the starting agent, then any enabled agent with an LLM
 * configured. Requires the agent's provider to exist AND be enabled — a call
 * against a disabled provider would only fail live — so the caller can gate the
 * Summarize/Review buttons on a non-null result. Returns null when nothing
 * usable is configured.
 */
export function pickInsightAgent(pg: Playground, providers: Provider[]): Agent | null {
  const enabledProviderIds = new Set(
    providers.filter((p) => p.enabled).map((p) => p.id),
  );
  const usable = pg.agents.filter(
    (a) =>
      a.runtime.enabled &&
      a.llm.providerId &&
      enabledProviderIds.has(a.llm.providerId) &&
      a.llm.model,
  );
  const byKind = (kind: Agent['kind']) => usable.find((a) => a.kind === kind);
  return (
    byKind('summarizer') ??
    byKind('finalizer') ??
    byKind('moderator') ??
    usable.find((a) => a.id === pg.conversation.startingAgentId) ??
    usable[0] ??
    null
  );
}

/** The concrete provider/model an insight call runs against, once resolved. */
export interface InsightTarget {
  provider: Provider;
  model: string;
  maxOutputTokens: number;
}

/** Long-run synthesis needs room even if the borrowed agent is tuned short. */
const INSIGHT_MIN_OUTPUT_TOKENS = 2048;

/**
 * Resolve where a timeline insight should run. A provider/model explicitly set
 * in app settings wins — provided that provider still exists and is enabled and
 * a model is named — so the user can pin insights to a CORS-friendly endpoint.
 * Otherwise fall back to borrowing a suitable agent (see pickInsightAgent). An
 * invalid settings target (deleted/disabled provider, blank model) degrades to
 * the borrow path rather than failing, so the caller can gate the buttons on a
 * non-null result. Returns null when nothing usable is configured.
 */
export function resolveInsightTarget(
  pg: Playground,
  providers: Provider[],
  settings: LlmSettings,
): InsightTarget | null {
  if (settings.insightProviderId && settings.insightModel.trim()) {
    const provider = providers.find((p) => p.id === settings.insightProviderId);
    if (provider && provider.enabled) {
      return { provider, model: settings.insightModel, maxOutputTokens: INSIGHT_MIN_OUTPUT_TOKENS };
    }
  }
  const agent = pickInsightAgent(pg, providers);
  if (!agent) return null;
  const provider = providers.find((p) => p.id === agent.llm.providerId);
  if (!provider) return null;
  return {
    provider,
    model: agent.llm.model,
    maxOutputTokens: Math.max(agent.llm.maxOutputTokens, INSIGHT_MIN_OUTPUT_TOKENS),
  };
}

export interface InsightResult {
  ok: boolean;
  /** Cleaned Markdown insight on success. */
  text?: string;
  model?: string;
  durationMs: number;
  errorKind?: string;
  errorSummary?: string;
  retryEligible?: boolean;
}

export interface InsightOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Generate a summary/review of the current conversation. Never throws. */
export async function generateConversationInsight(
  kind: InsightKind,
  pg: Playground,
  target: InsightTarget,
  options: InsightOptions = {},
): Promise<InsightResult> {
  const start = Date.now();
  const messages: ChatMessage[] = [
    { role: 'system', content: INSIGHT_SYSTEM[kind] },
    { role: 'user', content: buildUserMessage(kind, pg) },
  ];

  try {
    const res = await sendChat(
      target.provider,
      {
        model: target.model,
        messages,
        temperature: 0.3,
        maxOutputTokens: target.maxOutputTokens,
      },
      { signal: options.signal, timeoutMs: options.timeoutMs },
    );
    const text = extractInlineThinking(res.text).text.trim();
    if (!text) {
      return {
        ok: false,
        durationMs: Date.now() - start,
        errorKind: 'empty-response',
        errorSummary: 'The model returned an empty response.',
      };
    }
    return { ok: true, text, model: res.model, durationMs: Date.now() - start };
  } catch (err) {
    const pe = err instanceof ProviderError ? err : null;
    return {
      ok: false,
      durationMs: Date.now() - start,
      errorKind: pe?.kind ?? 'unknown',
      errorSummary: pe?.message ?? 'Unknown error while generating the insight.',
      retryEligible: pe ? retryEligible(pe.kind) : false,
    };
  }
}
