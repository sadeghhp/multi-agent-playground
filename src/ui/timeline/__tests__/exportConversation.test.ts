import { describe, expect, it } from 'vitest';
import { createPlayground } from '../../../domain/factories';
import type { Playground, TranscriptMessage } from '../../../domain/schema';
import {
  conversationToJson,
  conversationToMarkdown,
  conversationToPlainText,
  exportBaseName,
} from '../exportConversation';

function msg(over: Partial<TranscriptMessage>): TranscriptMessage {
  return {
    id: 'm', turn: 1, agentId: null, agentName: 'Agent', agentDeleted: false,
    role: '', model: '', providerId: null, content: '', status: 'completed',
    sourceAgentId: null, connectionType: null, timestamp: 1_700_000_000_000,
    language: 'en',
    ...over,
  };
}

function demoPlayground(): Playground {
  const pg = createPlayground('Demo Playground');
  pg.conversation.subject = 'Test subject';
  pg.conversation.objective = 'Reach agreement';
  pg.transcript = [
    msg({
      id: 'a', turn: 1, agentId: 'x', agentName: 'Researcher', role: 'researcher',
      model: 'test-model', content: '<think>secret plan</think>Opening idea.',
      totalTokens: 42, durationMs: 1200,
    }),
    msg({
      id: 'b', turn: 2, agentId: 'y', agentName: 'Critic',
      content: 'A rebuttal.',
      toolTrace: [{ tool: 'wikipedia', input: '{"q":"x"}', result: 'Found it.', ok: true }],
    }),
    msg({ id: 'c', turn: 2, agentId: 'y', agentName: 'Critic', status: 'failed', error: 'timeout' }),
  ];
  return pg;
}

describe('conversationToMarkdown', () => {
  it('renders title, context, turn headings and per-message sections', () => {
    const md = conversationToMarkdown(demoPlayground());
    expect(md).toContain('# Demo Playground — conversation');
    expect(md).toContain('> Subject: Test subject');
    expect(md).toContain('> Objective: Reach agreement');
    expect(md).toContain('## Turn 1');
    expect(md).toContain('## Turn 2');
    expect(md).toContain('### Researcher (researcher)');
    expect(md).toContain('Opening idea.');
    expect(md).toContain('A rebuttal.');
  });

  it('strips inline thinking from the answer but preserves it in a details block', () => {
    const md = conversationToMarkdown(demoPlayground());
    expect(md).toContain('<details><summary>Thinking</summary>');
    expect(md).toContain('secret plan');
    // The visible answer must not carry the think fence inline.
    expect(md).not.toContain('<think>');
  });

  it('records tool calls and failed turns', () => {
    const md = conversationToMarkdown(demoPlayground());
    expect(md).toContain('<details><summary>Tool: wikipedia</summary>');
    expect(md).toContain('Found it.');
    expect(md).toContain('**Failed:** timeout');
  });
});

describe('conversationToPlainText', () => {
  it('renders a clean answers-only view with turn banners', () => {
    const txt = conversationToPlainText(demoPlayground());
    expect(txt).toContain('Demo Playground — conversation');
    expect(txt).toContain('--- Turn 1 ---');
    expect(txt).toContain('Opening idea.');
    expect(txt).toContain('FAILED: timeout');
    // No internals in the plain-text read.
    expect(txt).not.toContain('secret plan');
    expect(txt).not.toContain('Found it.');
  });
});

describe('conversationToJson', () => {
  it('round-trips the full transcript with context', () => {
    const parsed = JSON.parse(conversationToJson(demoPlayground()));
    expect(parsed.playground).toBe('Demo Playground');
    expect(parsed.subject).toBe('Test subject');
    expect(parsed.messages).toHaveLength(3);
    expect(parsed.messages[1].toolTrace[0].tool).toBe('wikipedia');
  });
});

describe('exportBaseName', () => {
  it('derives the name from the playground', () => {
    expect(exportBaseName(demoPlayground())).toBe('Demo Playground-transcript');
  });
});
