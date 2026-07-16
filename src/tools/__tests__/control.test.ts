import { describe, expect, it } from 'vitest';
import { createAgent, createAgentFromTemplate } from '../../domain/factories';
import { createControlBudget, createTurnControl, type TurnControl } from '../../orchestrator/controlEffects';
import type { Agent } from '../../domain/schema';
import { buildControlTools, grantedControlToolIds, type RosterEntry } from '../control';

function rosterOf(...agents: Agent[]): RosterEntry[] {
  return agents.map((a) => ({ id: a.id, name: a.name, kind: a.kind, enabled: a.runtime.enabled }));
}

function liveCtrl(caller: Agent, all: Agent[]): TurnControl {
  return createTurnControl({
    caller,
    itemDirectiveDepth: 0,
    runBudget: createControlBudget(),
    agentsById: new Map(all.map((a) => [a.id, a])),
    isDisabledForRun: () => false,
    responsesOf: () => 0,
    responseLimitFor: () => 3,
  });
}

describe('grantedControlToolIds — opt-in ∩ kind eligibility', () => {
  it('grants nothing without opt-in, regardless of kind', () => {
    expect(grantedControlToolIds(createAgent({ kind: 'moderator' }))).toEqual([]);
    expect(grantedControlToolIds(createAgent())).toEqual([]);
  });

  it('filters ineligible tools by kind', () => {
    const p = createAgent({ tools: ['ask_agent', 'end_discussion', 'set_topic', 'calculator'] });
    expect(grantedControlToolIds(p)).toEqual(['ask_agent']);

    const m = createAgent({ kind: 'moderator', tools: ['ask_agent', 'direct_question', 'end_discussion'] });
    expect(grantedControlToolIds(m)).toEqual(['direct_question', 'end_discussion']);

    const s = createAgent({ kind: 'summarizer', tools: ['ask_agent', 'direct_question', 'set_topic', 'end_discussion'] });
    expect(grantedControlToolIds(s)).toEqual([]);
    const f = createAgent({ kind: 'finalizer', tools: ['ask_agent', 'end_discussion'] });
    expect(grantedControlToolIds(f)).toEqual([]);
  });

  it('moderator and critic templates preload their kits', () => {
    const mod = createAgentFromTemplate('moderator');
    expect(grantedControlToolIds(mod)).toEqual(['direct_question', 'set_topic', 'end_discussion']);
    const critic = createAgentFromTemplate('critic');
    expect(grantedControlToolIds(critic)).toEqual(['ask_agent']);
  });
});

describe('buildControlTools', () => {
  it('builds only granted tools', () => {
    const mod = createAgent({ name: 'Mod', kind: 'moderator', tools: ['direct_question', 'end_discussion'] });
    const tools = buildControlTools({ agent: mod, roster: rosterOf(mod), ctrl: liveCtrl(mod, [mod]) });
    expect(tools.map((t) => t.id).sort()).toEqual(['direct_question', 'end_discussion']);

    const plain = createAgent({ name: 'P' });
    expect(buildControlTools({ agent: plain, roster: [], ctrl: liveCtrl(plain, [plain]) })).toEqual([]);
  });

  it('embeds addressable agent names in the directed-tool description (self and terminal excluded)', () => {
    const mod = createAgent({ name: 'Mod', kind: 'moderator', tools: ['direct_question'] });
    const alice = createAgent({ name: 'Alice' });
    const sum = createAgent({ name: 'Sum', kind: 'summarizer' });
    const [tool] = buildControlTools({ agent: mod, roster: rosterOf(mod, alice, sum), ctrl: liveCtrl(mod, [mod, alice, sum]) });
    expect(tool.description).toContain('"Alice"');
    expect(tool.description).not.toContain('"Mod"');
    expect(tool.description).not.toContain('"Sum"');
  });

  it('resolves targets by name case-insensitively and pushes the effect', async () => {
    const alice = createAgent({ name: 'Alice' });
    const bob = createAgent({ name: 'Bob', tools: ['ask_agent'] });
    const ctrl = liveCtrl(bob, [alice, bob]);
    const [ask] = buildControlTools({ agent: bob, roster: rosterOf(alice, bob), ctrl });
    const result = await ask.execute({ target: 'aLiCe', question: 'why?' }, new AbortController().signal);
    expect(result).toContain('Question queued for Alice');
    expect(ctrl.effects).toMatchObject([
      { kind: 'direct-question', targetAgentId: alice.id, question: 'why?', routeReplyBack: true },
    ]);
  });

  it('direct_question (moderator) does not route a reply back; ask_agent does', async () => {
    const alice = createAgent({ name: 'Alice' });
    const mod = createAgent({ name: 'Mod', kind: 'moderator', tools: ['direct_question'] });
    const ctrl = liveCtrl(mod, [alice, mod]);
    const [dq] = buildControlTools({ agent: mod, roster: rosterOf(alice, mod), ctrl });
    await dq.execute({ target: 'Alice', question: 'q' }, new AbortController().signal);
    expect(ctrl.effects[0]).toMatchObject({ routeReplyBack: false });
  });

  it('returns a model-facing error for an unknown target name', async () => {
    const bob = createAgent({ name: 'Bob', tools: ['ask_agent'] });
    const ctrl = liveCtrl(bob, [bob]);
    const [ask] = buildControlTools({ agent: bob, roster: rosterOf(bob), ctrl });
    const result = await ask.execute({ target: 'Nobody', question: 'q' }, new AbortController().signal);
    expect(result).toMatch(/^ERROR: no addressable agent named "Nobody"/);
    expect(ctrl.effects).toHaveLength(0);
  });

  it('surfaces TurnControl rejections (e.g. terminal target) to the model', async () => {
    const sum = createAgent({ name: 'Sum', kind: 'summarizer' });
    const mod = createAgent({ name: 'Mod', kind: 'moderator', tools: ['direct_question'] });
    // Roster excludes terminal kinds from addressing, so the name never resolves.
    const ctrl = liveCtrl(mod, [sum, mod]);
    const [dq] = buildControlTools({ agent: mod, roster: rosterOf(sum, mod), ctrl });
    const result = await dq.execute({ target: 'Sum', question: 'q' }, new AbortController().signal);
    expect(result).toMatch(/^ERROR: no addressable agent named "Sum"/);
  });

  it('set_topic and end_discussion push their effects', async () => {
    const mod = createAgent({ name: 'Mod', kind: 'moderator', tools: ['set_topic', 'end_discussion'] });
    const ctrl = liveCtrl(mod, [mod]);
    const tools = buildControlTools({ agent: mod, roster: rosterOf(mod), ctrl });
    const setTopic = tools.find((t) => t.id === 'set_topic')!;
    const end = tools.find((t) => t.id === 'end_discussion')!;
    const signal = new AbortController().signal;

    expect(await setTopic.execute({ topic: 'costs' }, signal)).toContain('Topic set');
    expect(await end.execute({ reason: 'done' }, signal)).toContain('will end after your message');
    expect(ctrl.effects).toMatchObject([
      { kind: 'set-topic', topic: 'costs' },
      { kind: 'end-discussion', reason: 'done' },
    ]);
  });
});
