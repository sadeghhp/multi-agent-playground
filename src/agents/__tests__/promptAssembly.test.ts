import { describe, expect, it } from 'vitest';
import { createAgent } from '../../domain/factories';
import { defaultConversationSettings } from '../../domain/factories';
import type { Connection, TranscriptMessage } from '../../domain/schema';
import {
  assembleMessages,
  boundHistory,
  buildSystemPrompt,
  buildTaskPrompt,
} from '../promptAssembly';
import { characteristicsToInstruction } from '../characteristics';

function msg(agentId: string, agentName: string, content: string, turn: number): TranscriptMessage {
  return {
    id: `m${turn}`,
    turn,
    agentId,
    agentName,
    agentDeleted: false,
    role: '',
    model: 'm',
    providerId: null,
    content,
    status: 'completed',
    sourceAgentId: null,
    connectionType: null,
    timestamp: 0,
  };
}

describe('characteristicsToInstruction', () => {
  it('emits directives only for non-mid bands', () => {
    const text = characteristicsToInstruction({
      tone: 'neutral',
      verbosity: 10,
      creativity: 50,
      assertiveness: 90,
      skepticism: 90,
      cooperation: 50,
    });
    expect(text).toMatch(/concise/i);
    expect(text).toMatch(/confidently/i);
    expect(text).toMatch(/challenge/i);
    // mid values (50) produce no directive
    expect(text).not.toMatch(/creative/i);
  });
});

describe('buildSystemPrompt', () => {
  it('includes identity, role, instruction, characteristics, and skills in order', () => {
    const agent = createAgent({
      name: 'Risk Reviewer',
      role: 'Identify risks',
      systemInstruction: 'Challenge unsupported assumptions.',
      characteristics: { tone: 'neutral', verbosity: 10, creativity: 50, assertiveness: 50, skepticism: 90, cooperation: 50 },
      skills: [{ id: 's1', name: 'risk analysis', description: '', instruction: 'Rank risks by severity.', enabled: true }],
    });
    const prompt = buildSystemPrompt({ agent, conversation: defaultConversationSettings(), history: [] });
    expect(prompt).toContain('You are Agent: Risk Reviewer.');
    expect(prompt).toContain('Role: Identify risks.');
    expect(prompt).toContain('Challenge unsupported assumptions.');
    expect(prompt).toContain('risk analysis');
    expect(prompt).toContain('Rank risks by severity.');
  });

  it('applies the review connection rule and instruction override', () => {
    const agent = createAgent({ name: 'Critic', systemInstruction: 'x' });
    const incoming: Connection = { id: 'c', source: 'a', target: agent.id, enabled: true, type: 'review', priority: 0, instructionOverride: 'Focus only on factual weaknesses.' };
    const prompt = buildSystemPrompt({ agent, conversation: defaultConversationSettings(), history: [], incoming });
    expect(prompt).toMatch(/review/i);
    expect(prompt).toContain('Focus only on factual weaknesses.');
  });

  it('defaults to an English language directive', () => {
    const agent = createAgent({ name: 'A' });
    expect(agent.language).toBe('en');
    const prompt = buildSystemPrompt({ agent, conversation: defaultConversationSettings(), history: [] });
    expect(prompt).toContain('Write all of your responses in English.');
  });

  it('injects a Persian directive when the agent language is fa', () => {
    const agent = createAgent({ name: 'A', language: 'fa' });
    const prompt = buildSystemPrompt({ agent, conversation: defaultConversationSettings(), history: [] });
    expect(prompt).toContain('Persian (Farsi)');
    expect(prompt).toContain('به زبان فارسی');
  });

  it('injects a French directive when the agent language is fr', () => {
    const agent = createAgent({ name: 'A', language: 'fr' });
    const prompt = buildSystemPrompt({ agent, conversation: defaultConversationSettings(), history: [] });
    expect(prompt).toContain('in French');
    expect(prompt).toContain('en français');
  });
});

describe('buildTaskPrompt', () => {
  it('includes subject and objective', () => {
    const agent = createAgent({ name: 'A' });
    const conversation = { ...defaultConversationSettings(), subject: 'Ship it?', objective: 'Decide' };
    const task = buildTaskPrompt({ agent, conversation, history: [] });
    expect(task).toContain('Subject: Ship it?');
    expect(task).toContain('Objective: Decide');
  });
});

describe('assembleMessages', () => {
  it('flattens history into attributed user/assistant messages', () => {
    const agent = createAgent({ name: 'A', systemInstruction: 'x' });
    const history = [msg('other', 'B', 'hello from B', 1), msg(agent.id, 'A', 'my prior turn', 2)];
    const messages = assembleMessages({ agent, conversation: defaultConversationSettings(), history });
    expect(messages[0].role).toBe('system');
    expect(messages.find((m) => m.content.includes('[B]: hello from B'))?.role).toBe('user');
    expect(messages.find((m) => m.content.includes('[A]: my prior turn'))?.role).toBe('assistant');
    expect(messages[messages.length - 1].role).toBe('user'); // the task turn
  });

  it('omits history when includeHistory is false', () => {
    const agent = createAgent({ name: 'A', systemInstruction: 'x' });
    agent.runtime.includeHistory = false;
    const history = [msg('other', 'B', 'hello', 1)];
    const messages = assembleMessages({ agent, conversation: defaultConversationSettings(), history });
    expect(messages.some((m) => m.content.includes('hello'))).toBe(false);
  });
});

describe('boundHistory', () => {
  it('limits by window size', () => {
    const transcript = Array.from({ length: 10 }, (_, i) => msg('a', 'A', `m${i}`, i));
    expect(boundHistory(transcript, 3)).toHaveLength(3);
  });

  it('limits by character budget', () => {
    const transcript = Array.from({ length: 10 }, (_, i) => msg('a', 'A', 'x'.repeat(1000), i));
    const bounded = boundHistory(transcript, 10, 2500);
    expect(bounded.length).toBeLessThanOrEqual(3);
    expect(bounded.length).toBeGreaterThan(0);
  });
});
