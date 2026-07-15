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
    language: 'en',
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

  it('applies a run-level tone override on top of the agent characteristics', () => {
    const agent = createAgent({ name: 'A' });
    const conversation = { ...defaultConversationSettings(), toneOverride: 'playful' };
    const prompt = buildSystemPrompt({ agent, conversation, history: [] });
    expect(prompt).toContain('maintain a playful tone');
  });

  it('applies a run-level response-length directive', () => {
    const agent = createAgent({ name: 'A' });
    const conversation = { ...defaultConversationSettings(), responseLength: 'short' as const };
    const prompt = buildSystemPrompt({ agent, conversation, history: [] });
    expect(prompt).toContain('Keep your response short');
  });

  it('adds no length directive when responseLength is agent-default', () => {
    const agent = createAgent({ name: 'A' });
    const prompt = buildSystemPrompt({ agent, conversation: defaultConversationSettings(), history: [] });
    expect(prompt).not.toContain('Keep your response');
  });

  it('applies a run-level concise-factual directive that bans small talk and flattery', () => {
    const agent = createAgent({ name: 'A' });
    const conversation = { ...defaultConversationSettings(), chitchatPolicy: 'concise-factual' as const };
    const prompt = buildSystemPrompt({ agent, conversation, history: [] });
    expect(prompt).toContain('do not compliment, flatter, or praise');
    expect(prompt).toContain('do not open with greetings, small talk, or transitional filler');
  });

  it('adds no chit-chat directive when chitchatPolicy is agent-default', () => {
    const agent = createAgent({ name: 'A' });
    const prompt = buildSystemPrompt({ agent, conversation: defaultConversationSettings(), history: [] });
    expect(prompt).not.toContain('do not compliment');
  });

  it('overrides the agent\'s own language with a run-level language override', () => {
    const agent = createAgent({ name: 'A', language: 'en' });
    const conversation = { ...defaultConversationSettings(), languageOverride: 'fa' as const };
    const prompt = buildSystemPrompt({ agent, conversation, history: [] });
    expect(prompt).toContain('Persian (Farsi)');
    expect(prompt).not.toContain('Write all of your responses in English.');
  });

  it('keeps each agent\'s own language when languageOverride is agent-default', () => {
    const agent = createAgent({ name: 'A', language: 'fr' });
    const prompt = buildSystemPrompt({ agent, conversation: defaultConversationSettings(), history: [] });
    expect(prompt).toContain('in French');
  });

  it('applies a conversation-environment (mode) directive', () => {
    const agent = createAgent({ name: 'A' });
    const conversation = { ...defaultConversationSettings(), conversationMode: 'postmortem' as const };
    const prompt = buildSystemPrompt({ agent, conversation, history: [] });
    expect(prompt).toContain('blameless postmortem');
    expect(prompt).toContain('never individual');
  });

  it('adds no environment directive when conversationMode is open', () => {
    const agent = createAgent({ name: 'A' });
    const prompt = buildSystemPrompt({ agent, conversation: defaultConversationSettings(), history: [] });
    expect(prompt).not.toContain('brainstorming session');
    expect(prompt).not.toContain('blameless postmortem');
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

  it('opens the first turn with a natural kickoff instead of a field dump', () => {
    const agent = createAgent({ name: 'A' });
    const conversation = { ...defaultConversationSettings(), subject: 'Ship it?', objective: 'Decide' };
    const task = buildTaskPrompt({ agent, conversation, history: [], isFirstTurn: true });
    expect(task).toContain('opening a live discussion');
    expect(task).toContain('"Ship it?"');
    expect(task).toContain('Decide');
    expect(task).not.toContain('Subject: Ship it?');
    expect(task).not.toContain('Provide your response.');
  });

  it('embeds the source output for a review connection even without history', () => {
    const agent = createAgent({ name: 'Critic' });
    const incoming: Connection = { id: 'c', source: 'a', target: agent.id, enabled: true, type: 'review', priority: 0 };
    const task = buildTaskPrompt({
      agent,
      conversation: defaultConversationSettings(),
      history: [],
      incoming,
      sourceAgentName: 'Author',
      sourceOutput: 'The moon is made of cheese.',
    });
    expect(task).toContain('The moon is made of cheese.');
  });

  it('does not embed source output for a plain conversation connection', () => {
    const agent = createAgent({ name: 'B' });
    const incoming: Connection = { id: 'c', source: 'a', target: agent.id, enabled: true, type: 'conversation', priority: 0 };
    const task = buildTaskPrompt({
      agent,
      conversation: defaultConversationSettings(),
      history: [],
      incoming,
      sourceAgentName: 'Author',
      sourceOutput: 'secret text',
    });
    expect(task).not.toContain('secret text');
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

  it('feeds peers only the answer text, never reasoning or think tags', () => {
    const agent = createAgent({ name: 'A', systemInstruction: 'x' });
    const history: TranscriptMessage[] = [
      {
        ...msg('other', 'B', '<think>secret CoT</think>public answer', 1),
        reasoning: 'API reasoning that must stay private',
      },
      {
        ...msg('other', 'C', '', 2),
        reasoning: 'reasoning-only turn with no answer',
      },
    ];
    const messages = assembleMessages({ agent, conversation: defaultConversationSettings(), history });
    const flat = messages.map((m) => m.content).join('\n');
    expect(flat).toContain('[B]: public answer');
    expect(flat).not.toContain('secret CoT');
    expect(flat).not.toContain('API reasoning');
    expect(flat).not.toContain('reasoning-only');
    expect(flat).not.toContain('[C]:');
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
