import type { Agent, Playground, Provider } from '../domain/schema';
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
 * configured. Returns null when nothing usable is configured.
 */
export function pickInsightAgent(pg: Playground): Agent | null {
  const usable = pg.agents.filter(
    (a) => a.runtime.enabled && a.llm.providerId && a.llm.model,
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
  agent: Agent,
  provider: Provider,
  options: InsightOptions = {},
): Promise<InsightResult> {
  const start = Date.now();
  const messages: ChatMessage[] = [
    { role: 'system', content: INSIGHT_SYSTEM[kind] },
    { role: 'user', content: buildUserMessage(kind, pg) },
  ];

  try {
    const res = await sendChat(
      provider,
      {
        model: agent.llm.model,
        messages,
        temperature: 0.3,
        // Room for a long-run synthesis even if the borrowed agent is tuned short.
        maxOutputTokens: Math.max(agent.llm.maxOutputTokens, 2048),
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
