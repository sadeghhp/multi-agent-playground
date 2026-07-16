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
  it('titles with the subject and renders turns as speaker + words only', () => {
    const md = conversationToMarkdown(demoPlayground());
    expect(md).toContain('# Test subject');
    expect(md).toContain('## Turn 1');
    expect(md).toContain('## Turn 2');
    expect(md).toContain('**Researcher:**');
    expect(md).toContain('**Critic:**');
    expect(md).toContain('Opening idea.');
    expect(md).toContain('A rebuttal.');
  });

  it('drops all metadata, thinking, and tool internals', () => {
    const md = conversationToMarkdown(demoPlayground());
    // The visible answer only — inline thinking stripped, never re-surfaced.
    expect(md).not.toContain('<think>');
    expect(md).not.toContain('secret plan');
    expect(md).not.toContain('<details>');
    // No model / timing / token / role / objective / export banner.
    expect(md).not.toContain('test-model');
    expect(md).not.toContain('42');
    expect(md).not.toContain('(researcher)');
    expect(md).not.toMatch(/Objective/i);
    expect(md).not.toMatch(/Exported/i);
    // Tool call internals are gone.
    expect(md).not.toContain('Found it.');
    expect(md).not.toContain('wikipedia');
  });

  it('renders a failed turn as a brief no-response note, not an error dump', () => {
    const md = conversationToMarkdown(demoPlayground());
    expect(md).toContain('_(no response)_');
    expect(md).not.toContain('timeout');
  });

  it('labels a user interjection group as Interjection, not a turn', () => {
    const pg = demoPlayground();
    pg.transcript = [
      msg({ id: 'a', turn: 1, agentId: 'x', agentName: 'Researcher', content: 'Idea.' }),
      msg({ id: 'u', turn: 2, agentId: null, agentName: 'You', role: 'user', content: 'Consider X.' }),
    ];
    const md = conversationToMarkdown(pg);
    expect(md).toContain('## Interjection');
    expect(md).toContain('**You:**');
    expect(md).toContain('Consider X.');
  });
});

describe('conversationToPlainText', () => {
  it('renders the subject then turns with speakers and words only', () => {
    const txt = conversationToPlainText(demoPlayground());
    expect(txt.startsWith('Test subject')).toBe(true);
    expect(txt).toContain('Turn 1');
    expect(txt).toContain('Researcher:');
    expect(txt).toContain('Opening idea.');
    expect(txt).toContain('(no response)');
    // No internals or metadata.
    expect(txt).not.toContain('secret plan');
    expect(txt).not.toContain('Found it.');
    expect(txt).not.toContain('test-model');
    expect(txt).not.toContain('timeout');
  });
});

describe('conversationToJson', () => {
  it('is a clean subject + turns model, not a full transcript dump', () => {
    const parsed = JSON.parse(conversationToJson(demoPlayground()));
    expect(parsed.subject).toBe('Test subject');
    expect(parsed).not.toHaveProperty('objective');
    expect(parsed).not.toHaveProperty('exportedAt');
    expect(parsed.turns).toHaveLength(2);
    expect(parsed.turns[0]).toEqual({
      turn: 1,
      messages: [{ speaker: 'Researcher', text: 'Opening idea.' }],
    });
    // No model/token/tool fields leak through.
    expect(JSON.stringify(parsed)).not.toContain('wikipedia');
    expect(JSON.stringify(parsed)).not.toContain('test-model');
  });
});

describe('exportBaseName', () => {
  it('derives the file name from the subject', () => {
    expect(exportBaseName(demoPlayground())).toBe('Test subject-conversation');
  });
});
