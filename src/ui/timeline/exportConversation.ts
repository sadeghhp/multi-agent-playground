import type { Playground, TranscriptMessage } from '../../domain/schema';
import { extractInlineThinking } from '../../providers/openaiAdapter';
import { groupByTurn, isInterjectionGroup, type TurnGroup } from './turnGroups';

/**
 * Pure conversation-export builders for the timeline. The output is a clean,
 * natural reading of the discussion: the subject as the title, then each turn
 * with its speakers and what they said — nothing else. No model/timing/token
 * metadata, no reasoning or tool internals, no export banner. Kept free of
 * DOM/store access so they stay unit-testable; the timeline hands the result to
 * fileDownload/clipboard.
 */

/** Visible answer text, inline <think> fences stripped (mirrors the timeline body). */
function answerText(msg: TranscriptMessage): string {
  if (msg.status === 'failed') return '';
  return extractInlineThinking(msg.content).text.trim();
}

/** Conversation title: the subject, falling back to the playground name. */
function conversationTitle(pg: Playground): string {
  return pg.conversation.subject.trim() || pg.name.trim() || 'Conversation';
}

/** Section heading for a group: "Turn N", or "Interjection" for a user aside. */
function groupHeading(group: TurnGroup): string {
  return isInterjectionGroup(group) ? 'Interjection' : `Turn ${group.turn}`;
}

/**
 * Markdown export: the subject as an H1, each turn as an H2, and every message
 * as a bold speaker line followed by what they said (already Markdown). Reads
 * like a clean conversation transcript.
 */
export function conversationToMarkdown(pg: Playground): string {
  const out: string[] = [`# ${conversationTitle(pg)}`, ''];
  for (const group of groupByTurn(pg.transcript)) {
    out.push(`## ${groupHeading(group)}`, '');
    for (const msg of group.messages) {
      out.push(`**${msg.agentName}:**`, '');
      out.push(answerText(msg) || '_(no response)_', '');
    }
  }
  return out.join('\n').trimEnd() + '\n';
}

/**
 * Plain-text export: the subject, then each turn with speakers and their words.
 * The same natural read as the Markdown, stripped of Markdown syntax markers.
 */
export function conversationToPlainText(pg: Playground): string {
  const out: string[] = [conversationTitle(pg)];
  for (const group of groupByTurn(pg.transcript)) {
    out.push('', groupHeading(group));
    for (const msg of group.messages) {
      out.push('', `${msg.agentName}:`, answerText(msg) || '(no response)');
    }
  }
  return out.join('\n').trimEnd() + '\n';
}

/**
 * JSON export: the same subject + turns model as a structure — each turn is its
 * speakers and what they said. Not a full-fidelity transcript dump; it mirrors
 * what the readable exports show.
 */
export function conversationToJson(pg: Playground): string {
  const turns = groupByTurn(pg.transcript).map((group) => ({
    turn: group.turn,
    messages: group.messages.map((m) => ({ speaker: m.agentName, text: answerText(m) })),
  }));
  return JSON.stringify({ subject: conversationTitle(pg), turns }, null, 2);
}

/** Safe download base name for the playground (extension added by the caller). */
export function exportBaseName(pg: Playground): string {
  return `${conversationTitle(pg)}-conversation`;
}
