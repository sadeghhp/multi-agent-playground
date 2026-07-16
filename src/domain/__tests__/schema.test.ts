import { describe, expect, it } from 'vitest';
import { Agent, ConversationRun, Playground, Provider, SCHEMA_VERSION } from '../schema';
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
