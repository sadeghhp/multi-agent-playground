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

  it('injects no kind directive for a participant (the default)', () => {
    const agent = createAgent({ name: 'A', systemInstruction: 'x' });
    expect(agent.kind).toBe('participant');
    const prompt = buildSystemPrompt({ agent, conversation: defaultConversationSettings(), history: [] });
    expect(prompt).not.toMatch(/You are the (moderator|summarizer|finalizer)/);
  });

  it('injects the kind contract for moderator, summarizer, and finalizer', () => {
    const conversation = defaultConversationSettings();
    const moderator = buildSystemPrompt({ agent: createAgent({ name: 'M', kind: 'moderator', systemInstruction: 'x' }), conversation, history: [] });
    expect(moderator).toContain('You are the moderator');

    const summarizer = buildSystemPrompt({ agent: createAgent({ name: 'S', kind: 'summarizer', systemInstruction: 'x' }), conversation, history: [] });
    expect(summarizer).toContain('You are the summarizer');

    const finalizer = buildSystemPrompt({ agent: createAgent({ name: 'F', kind: 'finalizer', systemInstruction: 'x' }), conversation, history: [] });
    expect(finalizer).toContain('You are the finalizer');
    expect(finalizer).toMatch(/last|final word/i);
  });

  it('forces history on for moderator/summarizer/finalizer even when includeHistory is off (#3)', () => {
    const history = [msg('x', 'X', 'a prior point was made', 1)];
    for (const kind of ['moderator', 'summarizer', 'finalizer'] as const) {
      const base = createAgent();
      const agent = createAgent({
        name: 'A',
        kind,
        systemInstruction: 'do',
        runtime: { ...base.runtime, includeHistory: false },
      });
      const messages = assembleMessages({ agent, conversation: defaultConversationSettings(), history });
      const flat = messages.map((m) => m.content).join('\n');
      expect(flat).toContain('a prior point was made');
    }
  });

  it('still drops history for a participant when includeHistory is off (#3 — unchanged)', () => {
    const history = [msg('x', 'X', 'a prior point was made', 1)];
    const base = createAgent();
    const agent = createAgent({ name: 'A', systemInstruction: 'do', runtime: { ...base.runtime, includeHistory: false } });
    const messages = assembleMessages({ agent, conversation: defaultConversationSettings(), history });
    const flat = messages.map((m) => m.content).join('\n');
    expect(flat).not.toContain('a prior point was made');
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

  it('injects a first-person digital-shadow contract with stance notes', () => {
    const agent = createAgent({
      name: 'Thomas Nagel',
      role: 'Digital shadow of Thomas Nagel',
      personaMode: 'digital-shadow',
      persona: {
        realName: 'Thomas Nagel',
        knownFor: 'Philosophy of mind',
        stanceNotes: '- Subjective experience cannot be reduced to physical description',
        citationStyle: 'in-character',
      },
      systemInstruction: 'Defend the subjective character of experience.',
    });
    const prompt = buildSystemPrompt({ agent, conversation: defaultConversationSettings(), history: [] });
    expect(prompt).toContain('digital shadow of Thomas Nagel');
    expect(prompt).toContain('Speak in first person');
    expect(prompt).toContain('Do not refer to yourself in third person');
    expect(prompt).toContain("Advocate");
    expect(prompt).toContain('Subjective experience cannot be reduced');
    expect(prompt).toContain('I argued that');
    expect(prompt).not.toContain('You are Agent: Thomas Nagel.');
  });

  it('uses attributed citation language when citationStyle is attributed', () => {
    const agent = createAgent({
      name: 'Thomas Nagel',
      personaMode: 'digital-shadow',
      persona: {
        realName: 'Thomas Nagel',
        knownFor: '',
        stanceNotes: '',
        citationStyle: 'attributed',
      },
    });
    const prompt = buildSystemPrompt({ agent, conversation: defaultConversationSettings(), history: [] });
    expect(prompt).toContain('attribute it clearly');
    expect(prompt).not.toContain('cite it in first person');
  });

  it('keeps role-agent identity for personaMode role', () => {
    const agent = createAgent({ name: "Nagel's Advocate", role: 'Philosophical Explainer' });
    const prompt = buildSystemPrompt({ agent, conversation: defaultConversationSettings(), history: [] });
    expect(prompt).toContain("You are Agent: Nagel's Advocate.");
    expect(prompt).not.toContain('digital shadow of');
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

  it('opens shadow agents in character on the first turn', () => {
    const agent = createAgent({
      name: 'Thomas Nagel',
      personaMode: 'digital-shadow',
      persona: {
        realName: 'Thomas Nagel',
        knownFor: '',
        stanceNotes: '',
        citationStyle: 'in-character',
      },
    });
    const conversation = { ...defaultConversationSettings(), subject: 'What is consciousness?' };
    const task = buildTaskPrompt({ agent, conversation, history: [], isFirstTurn: true });
    expect(task).toContain('in character as Thomas Nagel');
    expect(task).not.toContain('the way a person would');
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
    // F11: the agent's OWN prior turn is an unprefixed assistant message, so the
    // model isn't trained to echo a `[Name]:` prefix into its next reply.
    const own = messages.find((m) => m.role === 'assistant');
    expect(own?.content).toBe('my prior turn');
    expect(messages.some((m) => m.content.includes('[A]:'))).toBe(false);
    expect(messages[messages.length - 1].role).toBe('user'); // the task turn
  });

  it('does not duplicate source output already present in the history block (F10)', () => {
    const agent = createAgent({ name: 'Critic', systemInstruction: 'x' });
    const incoming: Connection = { id: 'c', source: 'author', target: agent.id, enabled: true, type: 'review', priority: 0 };
    const history = [msg('author', 'Author', 'The moon is made of cheese.', 1)];
    const messages = assembleMessages({
      agent,
      conversation: defaultConversationSettings(),
      history,
      incoming,
      sourceAgentName: 'Author',
      sourceAgentId: 'author',
      sourceOutput: 'The moon is made of cheese.',
    });
    const occurrences = messages.filter((m) => m.content.includes('The moon is made of cheese.')).length;
    expect(occurrences).toBe(1);
  });

  it('still embeds source output when it has scrolled out of history (F10)', () => {
    const agent = createAgent({ name: 'Critic', systemInstruction: 'x' });
    const incoming: Connection = { id: 'c', source: 'author', target: agent.id, enabled: true, type: 'review', priority: 0 };
    const messages = assembleMessages({
      agent,
      conversation: defaultConversationSettings(),
      history: [msg('other', 'B', 'unrelated later chatter', 5)],
      incoming,
      sourceAgentName: 'Author',
      sourceAgentId: 'author',
      sourceOutput: 'The moon is made of cheese.',
    });
    expect(messages.some((m) => m.content.includes("Author's most recent response"))).toBe(true);
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

  // F14: failed/empty turns must not consume window slots meant for real context.
  it('does not count empty (failed) messages against the window', () => {
    const transcript = [
      msg('a', 'A', 'real one', 1),
      { ...msg('a', 'A', '', 2), status: 'failed' as const },
      { ...msg('a', 'A', '', 3), status: 'failed' as const },
      msg('a', 'A', 'real two', 4),
      msg('a', 'A', 'real three', 5),
    ];
    const bounded = boundHistory(transcript, 3);
    expect(bounded.map((m) => m.content)).toEqual(['real one', 'real two', 'real three']);
  });
});

describe('buildTaskPrompt user directive freshness (F13)', () => {
  it('imposes a fresh directive as a hard instruction', () => {
    const agent = createAgent({ name: 'A' });
    const task = buildTaskPrompt({
      agent,
      conversation: { ...defaultConversationSettings(), subject: 'S' },
      history: [],
      pendingUserDirective: 'argue the other side',
      userDirectiveIsFresh: true,
    });
    expect(task).toContain('you must address it directly');
    expect(task).toContain('argue the other side');
  });

  it('downgrades a stale directive to context', () => {
    const agent = createAgent({ name: 'A' });
    const task = buildTaskPrompt({
      agent,
      conversation: { ...defaultConversationSettings(), subject: 'S' },
      history: [],
      pendingUserDirective: 'argue the other side',
      userDirectiveIsFresh: false,
    });
    expect(task).not.toContain('you must address it directly');
    expect(task).toContain('keep it in mind');
    expect(task).toContain('argue the other side');
  });
});
