import { describe, expect, it } from 'vitest';
import { Agent, ConversationRun, Playground, Provider, SCHEMA_VERSION, TranscriptMessage } from '../schema';
import { createPlayground, createProvider } from '../factories';

// F15: nested config blocks are defaulted so a record missing one still loads
// (parseStored) instead of being silently dropped.
describe('defensive nested-object defaults (F15)', () => {
  it('parses an Agent missing characteristics/llm/runtime/position', () => {
    const result = Agent.safeParse({ id: 'a1', name: 'A' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.characteristics.verbosity).toBe(50);
      expect(result.data.llm.maxOutputTokens).toBe(8192);
      expect(result.data.runtime.enabled).toBe(true);
      expect(result.data.position).toEqual({ x: 0, y: 0 });
    }
  });

  it('parses a Playground missing conversation/ui', () => {
    const result = Playground.safeParse({
      schemaVersion: SCHEMA_VERSION,
      id: 'pg1',
      name: 'P',
      createdAt: 1,
      updatedAt: 1,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.conversation.maxTotalTurns).toBe(12);
      expect(result.data.ui.bottomPanelHeight).toBe(260);
    }
  });
});

describe('executable tools fields (additive, no migration)', () => {
  it('parses a pre-tools Agent and defaults tools to []', () => {
    const result = Agent.safeParse({ id: 'a1', name: 'A' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.tools).toEqual([]);
  });

  it('round-trips an Agent with tools and a TranscriptMessage with a toolTrace', () => {
    const agent = Agent.parse({ id: 'a1', name: 'R', tools: ['wikipedia_search', 'calculator'] });
    expect(agent.tools).toEqual(['wikipedia_search', 'calculator']);

    const msg = TranscriptMessage.parse({
      id: 'm1',
      turn: 1,
      agentId: 'a1',
      agentName: 'R',
      timestamp: 1,
      toolTrace: [{ tool: 'wikipedia_search', input: '{"query":"x"}', result: '1. X — y', ok: true, durationMs: 12 }],
    });
    expect(msg.toolTrace).toHaveLength(1);
    expect(msg.toolTrace?.[0].tool).toBe('wikipedia_search');

    const withoutTrace = TranscriptMessage.parse({
      id: 'm2',
      turn: 2,
      agentId: 'a1',
      agentName: 'R',
      timestamp: 2,
    });
    expect(withoutTrace.toolTrace).toBeUndefined();
  });
});

describe('orchestration-control fields (additive, no migration)', () => {
  it('parses a pre-change TranscriptMessage without the new fields', () => {
    const msg = TranscriptMessage.parse({
      id: 'm1',
      turn: 1,
      agentId: 'a1',
      agentName: 'A',
      timestamp: 1,
    });
    expect(msg.targetAgentId).toBeUndefined();
    expect(msg.targetAgentName).toBeUndefined();
    expect(msg.topicChange).toBeUndefined();
    expect(msg.answeringTo).toBeUndefined();
  });

  it('round-trips directed/topic metadata', () => {
    const msg = TranscriptMessage.parse({
      id: 'm1',
      turn: 1,
      agentId: 'mod',
      agentName: 'Mod',
      timestamp: 1,
      targetAgentId: 'b1',
      targetAgentName: 'B',
      topicChange: 'the migration cost',
      answeringTo: 'You',
    });
    expect(msg.targetAgentId).toBe('b1');
    expect(msg.targetAgentName).toBe('B');
    expect(msg.topicChange).toBe('the migration cost');
    expect(msg.answeringTo).toBe('You');
  });

  it('keeps historical ConversationRun records loadable (unversioned invariant)', () => {
    const pg = createPlayground('Test');
    const result = ConversationRun.safeParse({
      id: 'run_1',
      playgroundId: pg.id,
      version: 1,
      parentRunId: null,
      startedAt: 1,
      endedAt: 2,
      status: 'completed',
      conversation: pg.conversation,
      transcript: [{ id: 'm1', turn: 1, agentId: 'a1', agentName: 'A', timestamp: 1 }],
      events: [],
      messageCountAtStart: 0,
    });
    expect(result.success).toBe(true);
  });
});

describe('ConversationRun schema', () => {
  it('parses a minimal run record', () => {
    const pg = createPlayground('Test');
    const result = ConversationRun.safeParse({
      id: 'run_1',
      playgroundId: pg.id,
      version: 1,
      parentRunId: null,
      startedAt: Date.now(),
      endedAt: null,
      status: 'running',
      conversation: pg.conversation,
      transcript: [],
      events: [],
      messageCountAtStart: 0,
    });
    expect(result.success).toBe(true);
  });
});

describe('Provider.baseUrl validation (L-7 regression)', () => {
  it('allows the not-yet-configured empty default', () => {
    const result = Provider.safeParse(createProvider({ baseUrl: '' }));
    expect(result.success).toBe(true);
  });

  it('allows a well-formed http(s) URL', () => {
    expect(Provider.safeParse(createProvider({ baseUrl: 'http://localhost:11434' })).success).toBe(true);
    expect(Provider.safeParse(createProvider({ baseUrl: 'https://api.example.com' })).success).toBe(true);
  });

  it('rejects an unusable baseUrl instead of accepting it silently', () => {
    const result = Provider.safeParse(createProvider({ baseUrl: 'not-a-url' }));
    expect(result.success).toBe(false);
  });
});
