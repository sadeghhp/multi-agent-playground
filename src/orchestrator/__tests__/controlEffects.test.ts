import { describe, expect, it } from 'vitest';
import { createAgent } from '../../domain/factories';
import type { Agent } from '../../domain/schema';
import {
  applyControlEffects,
  createControlBudget,
  createNoopTurnControl,
  createTurnControl,
  MAX_DIRECTED_PER_AGENT_PER_RUN,
  promoteToFront,
  type ControlBudget,
  type QueueItem,
} from '../controlEffects';

function agents(...list: Agent[]): Map<string, Agent> {
  return new Map(list.map((a) => [a.id, a]));
}

function makeCtrl(opts: {
  caller: Agent;
  all: Agent[];
  depth?: number;
  budget?: ControlBudget;
  responses?: Record<string, number>;
  disabled?: string[];
}) {
  return createTurnControl({
    caller: opts.caller,
    itemDirectiveDepth: opts.depth ?? 0,
    runBudget: opts.budget ?? createControlBudget(),
    agentsById: agents(...opts.all),
    isDisabledForRun: (id) => (opts.disabled ?? []).includes(id),
    responsesOf: (id) => opts.responses?.[id] ?? 0,
    responseLimitFor: () => 3,
  });
}

describe('TurnControl.push — directed-question budgets', () => {
  const mod = createAgent({ name: 'Mod', kind: 'moderator' });
  const alice = createAgent({ name: 'Alice' });
  const summarizer = createAgent({ name: 'Sum', kind: 'summarizer' });

  const ask = (target: Agent, question = 'why?') =>
    ({ kind: 'direct-question', targetAgentId: target.id, question, routeReplyBack: false }) as const;

  it('accepts a valid directed question', () => {
    const ctrl = makeCtrl({ caller: mod, all: [mod, alice] });
    expect(ctrl.push(ask(alice))).toBeNull();
    expect(ctrl.effects).toHaveLength(1);
  });

  it('rejects unknown, self, and terminal targets with model-facing errors', () => {
    const ctrl = makeCtrl({ caller: mod, all: [mod, alice, summarizer] });
    expect(
      ctrl.push({ kind: 'direct-question', targetAgentId: 'nope', question: 'q', routeReplyBack: false }),
    ).toMatch(/^ERROR: that agent does not exist/);
    expect(ctrl.push(ask(mod))).toMatch(/^ERROR: you cannot direct a question at yourself/);
    const terminalErr = ctrl.push(ask(summarizer));
    expect(terminalErr).toMatch(/is a summarizer and only speaks after the discussion ends/);
    // A moderator is pointed at end_discussion instead.
    expect(terminalErr).toContain('end_discussion');
    expect(ctrl.effects).toHaveLength(0);
  });

  it('rejects disabled and response-capped targets', () => {
    const ctrl = makeCtrl({ caller: mod, all: [mod, alice], disabled: [alice.id] });
    expect(ctrl.push(ask(alice))).toMatch(/is not participating in this run/);

    const ctrl2 = makeCtrl({ caller: mod, all: [mod, alice], responses: { [alice.id]: 3 } });
    expect(ctrl2.push(ask(alice))).toMatch(/reached its response limit/);
  });

  it('allows at most one directed question per turn', () => {
    const bob = createAgent({ name: 'Bob' });
    const ctrl = makeCtrl({ caller: mod, all: [mod, alice, bob] });
    expect(ctrl.push(ask(alice))).toBeNull();
    expect(ctrl.push(ask(bob))).toMatch(/at most 1 question per turn/);
  });

  it('enforces the per-run per-target cap from the committed budget', () => {
    const budget = createControlBudget();
    budget.directedAt[alice.id] = MAX_DIRECTED_PER_AGENT_PER_RUN;
    const ctrl = makeCtrl({ caller: mod, all: [mod, alice], budget });
    expect(ctrl.push(ask(alice))).toMatch(/already been directed 3 questions this run/);
  });

  it('rejects a duplicate question already committed this run (whitespace/case-insensitive)', () => {
    const budget = createControlBudget();
    budget.askedPairs.add(`${mod.id}→${alice.id}:why though?`);
    const ctrl = makeCtrl({ caller: mod, all: [mod, alice], budget });
    expect(ctrl.push(ask(alice, '  Why   THOUGH? '))).toMatch(/already asked "Alice" that exact question/);
  });

  it('caps the override-chain depth so directed answers cannot chain forever', () => {
    const ctrl = makeCtrl({ caller: alice, all: [mod, alice], depth: 2 });
    expect(ctrl.push(ask(mod))).toMatch(/already answers a directed question/);
  });
});

describe('TurnControl.push — set-topic / end-discussion', () => {
  const mod = createAgent({ name: 'Mod', kind: 'moderator' });

  it('accepts one topic per turn and rejects empty/second topics', () => {
    const ctrl = makeCtrl({ caller: mod, all: [mod] });
    expect(ctrl.push({ kind: 'set-topic', topic: '  ' })).toMatch(/must not be empty/);
    expect(ctrl.push({ kind: 'set-topic', topic: 'costs' })).toBeNull();
    expect(ctrl.push({ kind: 'set-topic', topic: 'benefits' })).toMatch(/at most one topic per turn/);
  });

  it('accepts end-discussion once per turn', () => {
    const ctrl = makeCtrl({ caller: mod, all: [mod] });
    expect(ctrl.push({ kind: 'end-discussion', reason: 'done' })).toBeNull();
    expect(ctrl.push({ kind: 'end-discussion' })).toMatch(/already ended the discussion/);
  });

  it('drain empties the effect list', () => {
    const ctrl = makeCtrl({ caller: mod, all: [mod] });
    ctrl.push({ kind: 'set-topic', topic: 'x' });
    expect(ctrl.drain()).toHaveLength(1);
    expect(ctrl.effects).toHaveLength(0);
    expect(ctrl.drain()).toHaveLength(0);
  });

  it('noop control rejects everything and applies nothing', () => {
    const ctrl = createNoopTurnControl();
    expect(ctrl.push({ kind: 'set-topic', topic: 'x' })).toMatch(/^ERROR:/);
    expect(ctrl.drain()).toHaveLength(0);
  });
});

describe('applyControlEffects — queue surgery', () => {
  const mod = createAgent({ name: 'Mod', kind: 'moderator' });
  const alice = createAgent({ name: 'Alice' });
  const bob = createAgent({ name: 'Bob' });

  const noLog = () => {};

  function baseOpts(queue: QueueItem[], queued: Set<string>) {
    return {
      item: { agentId: mod.id, connectionId: null, sourceAgentId: null } as QueueItem,
      callerName: mod.name,
      queue,
      queued,
      runBudget: createControlBudget(),
      agentsById: agents(mod, alice, bob),
      log: noLog,
    };
  }

  it('unshifts a directed question to the queue front and commits the budget', () => {
    const queue: QueueItem[] = [{ agentId: bob.id, connectionId: 'c1', sourceAgentId: mod.id }];
    const queued = new Set([bob.id]);
    const opts = baseOpts(queue, queued);
    const { suppressGraphEnqueue } = applyControlEffects({
      ...opts,
      effects: [{ kind: 'direct-question', targetAgentId: alice.id, question: 'why?', routeReplyBack: false }],
    });
    expect(suppressGraphEnqueue).toBe(false);
    expect(queue.map((q) => q.agentId)).toEqual([alice.id, bob.id]);
    expect(queue[0].directive).toMatchObject({
      type: 'agent-question',
      fromAgentId: mod.id,
      fromName: 'Mod',
      text: 'why?',
      depth: 1,
    });
    expect(queue[0].directive!.replyToAgentId).toBeUndefined();
    expect(opts.runBudget.directedAt[alice.id]).toBe(1);
    expect(opts.runBudget.askedPairs.size).toBe(1);
  });

  it('sets replyToAgentId for a round-trip ask and bumps depth from the item directive', () => {
    const queue: QueueItem[] = [];
    const queued = new Set<string>();
    const opts = baseOpts(queue, queued);
    applyControlEffects({
      ...opts,
      item: {
        agentId: alice.id,
        connectionId: null,
        sourceAgentId: null,
        directive: { type: 'agent-question', fromAgentId: mod.id, fromName: 'Mod', text: 'q', depth: 1 },
      },
      callerName: alice.name,
      effects: [{ kind: 'direct-question', targetAgentId: bob.id, question: 'and you?', routeReplyBack: true }],
    });
    expect(queue[0].directive).toMatchObject({ replyToAgentId: alice.id, depth: 2 });
  });

  it('promotes an already-queued target instead of duplicating it', () => {
    const queue: QueueItem[] = [
      { agentId: bob.id, connectionId: 'c1', sourceAgentId: mod.id },
      { agentId: alice.id, connectionId: 'c2', sourceAgentId: mod.id },
    ];
    const queued = new Set([bob.id, alice.id]);
    applyControlEffects({
      ...baseOpts(queue, queued),
      effects: [{ kind: 'direct-question', targetAgentId: alice.id, question: 'why?', routeReplyBack: false }],
    });
    expect(queue.map((q) => q.agentId)).toEqual([alice.id, bob.id]);
    expect(queue.filter((q) => q.agentId === alice.id)).toHaveLength(1);
    expect(queued.size).toBe(2);
  });

  it('end-discussion clears the queue and suppresses graph enqueueing', () => {
    const queue: QueueItem[] = [
      { agentId: bob.id, connectionId: 'c1', sourceAgentId: mod.id },
      { agentId: alice.id, connectionId: 'c2', sourceAgentId: mod.id },
    ];
    const queued = new Set([bob.id, alice.id]);
    const { suppressGraphEnqueue } = applyControlEffects({
      ...baseOpts(queue, queued),
      effects: [{ kind: 'end-discussion', reason: 'objective met' }],
    });
    expect(suppressGraphEnqueue).toBe(true);
    expect(queue).toHaveLength(0);
    expect(queued.size).toBe(0);
  });

  it('set-topic changes nothing in the queue', () => {
    const queue: QueueItem[] = [{ agentId: bob.id, connectionId: 'c1', sourceAgentId: mod.id }];
    const queued = new Set([bob.id]);
    const { suppressGraphEnqueue } = applyControlEffects({
      ...baseOpts(queue, queued),
      effects: [{ kind: 'set-topic', topic: 'costs' }],
    });
    expect(suppressGraphEnqueue).toBe(false);
    expect(queue).toHaveLength(1);
  });
});

describe('promoteToFront', () => {
  it('keeps the one-entry-per-agent invariant', () => {
    const a: QueueItem = { agentId: 'a', connectionId: null, sourceAgentId: null };
    const b: QueueItem = { agentId: 'b', connectionId: null, sourceAgentId: null };
    const queue = [a, b];
    const queued = new Set(['a', 'b']);
    promoteToFront(queue, queued, { agentId: 'b', connectionId: null, sourceAgentId: 'a' });
    expect(queue.map((q) => q.agentId)).toEqual(['b', 'a']);
    expect(queue).toHaveLength(2);
  });
});
