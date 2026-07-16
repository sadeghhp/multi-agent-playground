import { describe, expect, it } from 'vitest';
import { createAgent } from '../../domain/factories';
import type { Agent } from '../../domain/schema';
import {
  ArrangementDraft,
  buildArrangeUserMessage,
  normalizeArrangement,
  parseArrangementDraftFromText,
} from '../smartArrange';

function roster(): Agent[] {
  return [
    createAgent({ id: 'ag_r', name: 'Researcher', role: 'Researcher' }),
    createAgent({ id: 'ag_c', name: 'Critic', role: 'Critic' }),
    createAgent({ id: 'ag_a', name: 'Analyst', role: 'Analyst' }),
    createAgent({ id: 'ag_s', name: 'Summarizer', role: 'Summarizer', kind: 'summarizer' }),
  ];
}

function draft(overrides: Partial<ArrangementDraft> = {}): ArrangementDraft {
  return ArrangementDraft.parse({
    startingAgentId: 'ag_r',
    connections: [
      { source: 'ag_r', target: 'ag_c', type: 'review' },
      { source: 'ag_c', target: 'ag_a' },
      { source: 'ag_a', target: 'ag_r' },
    ],
    ...overrides,
  });
}

describe('parseArrangementDraftFromText', () => {
  it('parses a clean JSON reply', () => {
    const raw = JSON.stringify({
      startingAgentId: 'ag_r',
      connections: [{ source: 'ag_r', target: 'ag_c' }],
      rationale: 'r',
    });
    const result = parseArrangementDraftFromText(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.connections[0].type).toBe('conversation'); // defaulted
      expect(result.draft.connections[0].priority).toBe(0);
    }
  });

  it('parses JSON wrapped in fences and prose', () => {
    const raw =
      'Here is the arrangement:\n```json\n' +
      JSON.stringify({ startingAgentId: 'ag_r', connections: [{ source: 'ag_r', target: 'ag_c' }] }) +
      '\n```\nHope this helps!';
    expect(parseArrangementDraftFromText(raw).ok).toBe(true);
  });

  it('reports syntax failure for non-JSON', () => {
    const result = parseArrangementDraftFromText('no json here');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toBe('syntax');
  });

  it('reports schema failure for JSON that misses the contract', () => {
    const result = parseArrangementDraftFromText(JSON.stringify({ startingAgentId: 'x', connections: [] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure).toBe('schema');
  });
});

describe('buildArrangeUserMessage', () => {
  it('lists only enabled agents, without system instructions', () => {
    const agents = roster();
    agents[1] = { ...agents[1], runtime: { ...agents[1].runtime, enabled: false } };
    agents[0] = { ...agents[0], systemInstruction: 'SECRET INSTRUCTION TEXT' };
    const msg = buildArrangeUserMessage('Topic', 'Goal', agents);
    expect(msg).toContain('Subject: Topic');
    expect(msg).toContain('Objective: Goal');
    expect(msg).toContain('id: ag_r');
    expect(msg).not.toContain('id: ag_c'); // disabled
    expect(msg).not.toContain('SECRET INSTRUCTION TEXT');
    expect(msg).toContain('kind: summarizer');
  });
});

describe('normalizeArrangement', () => {
  it('passes a valid draft through with no notes', () => {
    const result = normalizeArrangement(draft(), roster());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.startingAgentId).toBe('ag_r');
      expect(result.plan.connections).toHaveLength(3);
      expect(result.plan.notes).toHaveLength(0);
      expect(result.plan.connections.every((c) => c.enabled)).toBe(true);
    }
  });

  it('drops connections and kind corrections with unknown ids, with notes', () => {
    const result = normalizeArrangement(
      draft({
        connections: [
          { source: 'ag_r', target: 'ag_c', type: 'conversation', priority: 0 },
          { source: 'ag_r', target: 'ag_ghost', type: 'conversation', priority: 0 },
        ],
        kindCorrections: [{ agentId: 'ag_ghost', kind: 'summarizer' }],
      }),
      roster(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.connections.filter((c) => c.target === 'ag_ghost')).toHaveLength(0);
      expect(result.plan.kindCorrections).toHaveLength(0);
      expect(result.plan.notes.length).toBeGreaterThan(0);
    }
  });

  it('dedupes ordered pairs keeping the higher priority', () => {
    const result = normalizeArrangement(
      draft({
        connections: [
          { source: 'ag_r', target: 'ag_c', type: 'conversation', priority: 1 },
          { source: 'ag_r', target: 'ag_c', type: 'review', priority: 5 },
        ],
      }),
      roster(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const rc = result.plan.connections.filter((c) => c.source === 'ag_r' && c.target === 'ag_c');
      expect(rc).toHaveLength(1);
      expect(rc[0].priority).toBe(5);
    }
  });

  it('strips edges touching terminal kinds, including post-correction kinds', () => {
    const result = normalizeArrangement(
      draft({
        connections: [
          { source: 'ag_r', target: 'ag_c', type: 'conversation', priority: 0 },
          { source: 'ag_c', target: 'ag_s', type: 'conversation', priority: 0 }, // into summarizer
          { source: 'ag_r', target: 'ag_a', type: 'conversation', priority: 0 },
        ],
        // Analyst corrected to finalizer → the edge into it must also be stripped.
        kindCorrections: [{ agentId: 'ag_a', kind: 'finalizer' }],
      }),
      roster(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.connections.some((c) => c.target === 'ag_s')).toBe(false);
      expect(result.plan.connections.some((c) => c.target === 'ag_a')).toBe(false);
      expect(result.plan.notes.some((n) => n.includes('wrap-up'))).toBe(true);
    }
  });

  it('falls back when the starting agent is terminal or unknown', () => {
    const terminalStart = normalizeArrangement(draft({ startingAgentId: 'ag_s' }), roster());
    expect(terminalStart.ok).toBe(true);
    if (terminalStart.ok) {
      expect(terminalStart.plan.startingAgentId).toBe('ag_r'); // first valid edge source
      expect(terminalStart.plan.notes.some((n) => n.includes('Start moved'))).toBe(true);
    }

    const unknownStart = normalizeArrangement(draft({ startingAgentId: 'ag_ghost' }), roster());
    expect(unknownStart.ok).toBe(true);
    if (unknownStart.ok) expect(unknownStart.plan.startingAgentId).toBe('ag_r');
  });

  it('adds repair edges so every enabled non-terminal agent is reachable', () => {
    const result = normalizeArrangement(
      draft({
        connections: [{ source: 'ag_r', target: 'ag_c', type: 'conversation', priority: 0 }],
      }),
      roster(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Analyst was unreachable → repair edge from the start at priority -1.
      const repair = result.plan.connections.find((c) => c.target === 'ag_a');
      expect(repair).toMatchObject({ source: 'ag_r', priority: -1, type: 'conversation' });
      expect(result.plan.notes.some((n) => n.includes('reachable'))).toBe(true);
      // Terminal summarizer needs no repair edge.
      expect(result.plan.connections.some((c) => c.target === 'ag_s')).toBe(false);
    }
  });

  it('does not add redundant repair edges when one repair unlocks a chain', () => {
    // Start r; only edge c→a exists. Repairing r→c makes a reachable through c.
    const result = normalizeArrangement(
      draft({
        connections: [
          { source: 'ag_c', target: 'ag_a', type: 'conversation', priority: 0 },
          { source: 'ag_r', target: 'ag_r', type: 'conversation', priority: 0 }, // keep r valid as source
        ],
      }),
      roster(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.connections.filter((c) => c.target === 'ag_a')).toHaveLength(1); // only c→a
      expect(result.plan.connections.filter((c) => c.source === 'ag_r' && c.target === 'ag_c')).toHaveLength(1);
    }
  });

  it('fails when nothing usable survives', () => {
    const result = normalizeArrangement(
      draft({
        startingAgentId: 'ag_ghost',
        connections: [{ source: 'ag_ghost', target: 'ag_phantom', type: 'conversation', priority: 0 }],
      }),
      roster(),
    );
    expect(result.ok).toBe(false);
  });
});
