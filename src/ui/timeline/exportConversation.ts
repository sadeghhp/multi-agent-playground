import type { Playground, TranscriptMessage } from '../../domain/schema';
import { extractInlineThinking } from '../../providers/openaiAdapter';
import { formatDuration } from '../formatDuration';
import { groupByTurn } from './turnGroups';

/**
 * Pure conversation-export builders for the timeline (Markdown, plain text,
 * JSON). Kept free of DOM/store access so they are unit-testable; the timeline
 * hands the result to fileDownload/clipboard.
 */

/** Answer text with any inline <think> fences stripped (mirrors the timeline body). */
function answerText(msg: TranscriptMessage): string {
  return extractInlineThinking(msg.content).text.trim();
}

/** Reasoning from both the dedicated field and inline fences, like the UI shows. */
function reasoningText(msg: TranscriptMessage): string {
  const split = extractInlineThinking(msg.content);
  return [msg.reasoning, split.reasoning].filter(Boolean).join('\n\n').trim();
}

function headerLine(msg: TranscriptMessage): string {
  const parts = [msg.agentName];
  if (msg.role) parts.push(`(${msg.role})`);
  const meta = [
    msg.model || null,
    new Date(msg.timestamp).toLocaleString(),
    msg.durationMs != null ? formatDuration(msg.durationMs) : null,
    msg.totalTokens != null ? `${msg.totalTokens} tok` : null,
  ].filter(Boolean);
  return `${parts.join(' ')} — ${meta.join(' · ')}`;
}

function preambleLines(pg: Playground): string[] {
  const lines: string[] = [];
  if (pg.conversation.subject) lines.push(`Subject: ${pg.conversation.subject}`);
  if (pg.conversation.objective) lines.push(`Objective: ${pg.conversation.objective}`);
  return lines;
}

/**
 * Markdown export: turn headings, one section per message with metadata, the
 * visible answer as-is (agent output is already Markdown), and reasoning/tool
 * calls tucked into <details> so the document stays readable but loses nothing.
 */
export function conversationToMarkdown(pg: Playground): string {
  const out: string[] = [`# ${pg.name || 'Untitled playground'} — conversation`, ''];
  const pre = preambleLines(pg);
  if (pre.length > 0) out.push(...pre.map((l) => `> ${l}`), '');
  out.push(`_Exported ${new Date().toLocaleString()} · ${pg.transcript.length} messages_`, '');

  for (const group of groupByTurn(pg.transcript)) {
    out.push(`## Turn ${group.turn}`, '');
    for (const msg of group.messages) {
      out.push(`### ${headerLine(msg)}`, '');
      if (msg.status === 'failed') {
        out.push(`**Failed:** ${msg.error ?? 'unknown error'}`, '');
        continue;
      }
      const reasoning = reasoningText(msg);
      if (reasoning) {
        out.push('<details><summary>Thinking</summary>', '', reasoning, '', '</details>', '');
      }
      for (const t of msg.toolTrace ?? []) {
        out.push(
          `<details><summary>Tool: ${t.tool}${t.ok ? '' : ' (failed)'}</summary>`,
          '',
          `Input: \`${t.input || '(none)'}\``,
          '',
          t.result,
          '',
          '</details>',
          '',
        );
      }
      out.push(answerText(msg) || '_(no visible answer)_', '');
    }
  }
  return out.join('\n').trimEnd() + '\n';
}

/**
 * Plain-text export: a clean read of the conversation — turn banners, speaker
 * headers, and answers only (no reasoning/tool internals).
 */
export function conversationToPlainText(pg: Playground): string {
  const rule = '='.repeat(64);
  const out: string[] = [`${pg.name || 'Untitled playground'} — conversation`, ...preambleLines(pg), rule];

  for (const group of groupByTurn(pg.transcript)) {
    out.push('', `--- Turn ${group.turn} ---`);
    for (const msg of group.messages) {
      out.push('', headerLine(msg));
      out.push(
        msg.status === 'failed'
          ? `FAILED: ${msg.error ?? 'unknown error'}`
          : answerText(msg) || '(no visible answer)',
      );
    }
  }
  return out.join('\n').trimEnd() + '\n';
}

/** JSON export: full-fidelity transcript plus conversation context. */
export function conversationToJson(pg: Playground): string {
  return JSON.stringify(
    {
      playground: pg.name,
      subject: pg.conversation.subject,
      objective: pg.conversation.objective,
      exportedAt: new Date().toISOString(),
      messages: pg.transcript,
    },
    null,
    2,
  );
}

/** Safe download base name for the playground (extension added by the caller). */
export function exportBaseName(pg: Playground): string {
  return `${pg.name || 'conversation'}-transcript`;
}
