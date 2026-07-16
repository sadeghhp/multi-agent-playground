import { describe, expect, it } from 'vitest';
import { createAgent, createPlayground, createProvider } from '../../domain/factories';
import type { Playground, Provider } from '../../domain/schema';
import { hasBlockingErrors, reachableFrom, validateForRun } from '../validate';

function readyPlayground(): { pg: Playground; providers: Provider[]; aId: string; bId: string } {
  const pg = createPlayground('P');
  const provider = createProvider({ baseUrl: 'http://localhost:11434', authMethod: 'none', models: ['m'] });
  const base = createAgent();
  const a = createAgent({ name: 'A', role: 'r', systemInstruction: 'do', llm: { ...base.llm, providerId: provider.id, model: 'm' } });
  const b = createAgent({ name: 'B', role: 'r', systemInstruction: 'do', llm: { ...base.llm, providerId: provider.id, model: 'm' } });
  pg.agents.push(a, b);
  pg.connections.push({ id: 'c', source: a.id, target: b.id, enabled: true, type: 'conversation', priority: 0 });
  pg.conversation.startingAgentId = a.id;
  pg.conversation.subject = 'S';
  return { pg, providers: [provider], aId: a.id, bId: b.id };
}

describe('validateForRun', () => {
  it('passes a fully configured graph', () => {
    const { pg, providers } = readyPlayground();
    expect(hasBlockingErrors(validateForRun(pg, providers))).toBe(false);
  });

  it('errors when no starting agent is selected', () => {
    const { pg, providers } = readyPlayground();
    pg.conversation.startingAgentId = null;
    const issues = validateForRun(pg, providers);
    expect(issues.some((i) => i.level === 'error' && /starting agent/i.test(i.message))).toBe(true);
  });

  it('errors when an agent lacks a provider or model', () => {
    const { pg, providers, bId } = readyPlayground();
    const b = pg.agents.find((a) => a.id === bId)!;
    b.llm.providerId = null;
    b.llm.model = '';
    const issues = validateForRun(pg, providers);
    expect(issues.some((i) => i.agentId === bId && /provider/i.test(i.message))).toBe(true);
    expect(issues.some((i) => i.agentId === bId && /model/i.test(i.message))).toBe(true);
  });

  it('warns about an unreachable enabled agent instead of erroring', () => {
    const { pg, providers } = readyPlayground();
    // add an isolated enabled agent C with no edges
    const provider = providers[0];
    const base = createAgent();
    pg.agents.push(createAgent({ name: 'C', role: 'r', systemInstruction: 'do', llm: { ...base.llm, providerId: provider.id, model: 'm' } }));
    const issues = validateForRun(pg, providers);
    const cWarn = issues.find((i) => /not reachable/i.test(i.message));
    expect(cWarn?.level).toBe('warning');
    expect(hasBlockingErrors(issues)).toBe(false);
  });

  it('does NOT block the run when an UNREACHABLE agent is misconfigured (spec §19)', () => {
    const { pg, providers } = readyPlayground();
    // C is unreachable AND missing a provider/model — must warn, not block.
    pg.agents.push(createAgent({ name: 'C', role: 'r', systemInstruction: 'do' }));
    const issues = validateForRun(pg, providers);
    // The only issue about C is the reachability warning, no blocking error.
    const cIssues = issues.filter((i) => i.agentId === pg.agents[pg.agents.length - 1].id);
    expect(cIssues.every((i) => i.level === 'warning')).toBe(true);
    expect(hasBlockingErrors(issues)).toBe(false);
  });

  it('DOES block when a REACHABLE agent is misconfigured', () => {
    const { pg, providers, bId } = readyPlayground();
    // B is reachable (A→B) and now missing its model — must block.
    pg.agents.find((a) => a.id === bId)!.llm.model = '';
    expect(hasBlockingErrors(validateForRun(pg, providers))).toBe(true);
  });

  it('errors when the starting agent is disabled', () => {
    const { pg, providers, aId } = readyPlayground();
    pg.agents.find((a) => a.id === aId)!.runtime.enabled = false;
    expect(validateForRun(pg, providers).some((i) => i.level === 'error' && /disabled/i.test(i.message))).toBe(true);
  });

  it('warns when a digital-shadow agent has no real person name', () => {
    const { pg, providers, aId } = readyPlayground();
    const a = pg.agents.find((x) => x.id === aId)!;
    a.personaMode = 'digital-shadow';
    a.persona = { realName: '', knownFor: '', stanceNotes: '', citationStyle: 'in-character' };
    const issues = validateForRun(pg, providers);
    expect(
      issues.some(
        (i) => i.level === 'warning' && i.agentId === aId && /digital shadow but has no real person name/i.test(i.message),
      ),
    ).toBe(true);
    expect(hasBlockingErrors(issues)).toBe(false);
  });

  it('warns when a digital-shadow agent is named like an advocate', () => {
    const { pg, providers, aId } = readyPlayground();
    const a = pg.agents.find((x) => x.id === aId)!;
    a.name = "Nagel's Advocate";
    a.personaMode = 'digital-shadow';
    a.persona = {
      realName: 'Thomas Nagel',
      knownFor: '',
      stanceNotes: '',
      citationStyle: 'in-character',
    };
    const issues = validateForRun(pg, providers);
    expect(issues.some((i) => i.level === 'warning' && /reads like an advocate/i.test(i.message))).toBe(true);
  });

  it('treats a finalizer with no incoming edges as a participating, ready agent', () => {
    const { pg, providers } = readyPlayground();
    const provider = providers[0];
    const base = createAgent();
    // A finalizer with no edges is intentional — it runs in wrap-up. It must NOT
    // be flagged "unreachable", and its readiness (provider/model) must still be
    // checked. Give it a bad provider and expect a blocking error, not a warning.
    pg.agents.push(
      createAgent({ name: 'F', role: 'r', systemInstruction: 'do', kind: 'finalizer', llm: { ...base.llm, providerId: null, model: '' } }),
    );
    const issues = validateForRun(pg, providers);
    expect(issues.some((i) => /not reachable/i.test(i.message))).toBe(false);
    expect(issues.some((i) => /provider/i.test(i.message))).toBe(true);
    // A correctly configured finalizer with no edges is fully valid.
    pg.agents[pg.agents.length - 1].llm = { ...base.llm, providerId: provider.id, model: 'm' };
    expect(hasBlockingErrors(validateForRun(pg, providers))).toBe(false);
  });

  it('warns when the starting agent is a terminal kind', () => {
    const { pg, providers } = readyPlayground();
    const provider = providers[0];
    const base = createAgent();
    const finalizer = createAgent({ name: 'F', role: 'r', systemInstruction: 'do', kind: 'finalizer', llm: { ...base.llm, providerId: provider.id, model: 'm' } });
    pg.agents.push(finalizer);
    pg.conversation.startingAgentId = finalizer.id;
    const issues = validateForRun(pg, providers);
    expect(issues.some((i) => i.level === 'warning' && /wrap-up phase/i.test(i.message))).toBe(true);
  });

  it('warns when a terminal-kind agent has outgoing edges', () => {
    const { pg, providers, bId } = readyPlayground();
    const provider = providers[0];
    const base = createAgent();
    const summarizer = createAgent({ name: 'S', role: 'r', systemInstruction: 'do', kind: 'summarizer', llm: { ...base.llm, providerId: provider.id, model: 'm' } });
    pg.agents.push(summarizer);
    // An (ignored) outgoing edge from the summarizer back to B.
    pg.connections.push({ id: 'c-s', source: summarizer.id, target: bId, enabled: true, type: 'conversation', priority: 0 });
    const issues = validateForRun(pg, providers);
    expect(issues.some((i) => i.level === 'warning' && i.agentId === summarizer.id && /outgoing connections are ignored/i.test(i.message))).toBe(true);
  });

  it('errors when the conversation subject is empty (spec §11.1)', () => {
    const { pg, providers } = readyPlayground();
    pg.conversation.subject = '   ';
    expect(validateForRun(pg, providers).some((i) => i.level === 'error' && /subject/i.test(i.message))).toBe(true);
  });

  it('errors when a reachable agent uses a bearer provider with no API key (spec §19)', () => {
    const { pg, providers } = readyPlayground();
    const provider = providers[0];
    provider.authMethod = 'bearer';
    provider.apiKey = undefined;
    expect(validateForRun(pg, providers).some((i) => i.level === 'error' && /api key/i.test(i.message))).toBe(true);
  });

  it('errors on an enabled connection that references a missing agent', () => {
    const { pg, providers } = readyPlayground();
    pg.connections.push({
      id: 'dangling', source: pg.agents[0].id, target: 'nonexistent-agent',
      enabled: true, type: 'conversation', priority: 0,
    });
    expect(
      validateForRun(pg, providers).some((i) => i.level === 'error' && /missing agent/i.test(i.message)),
    ).toBe(true);
  });

  it('does not block on a DISABLED connection that references a missing agent (L-12 regression)', () => {
    const { pg, providers } = readyPlayground();
    // A leftover disabled+dangling edge (e.g. from a bad import) can never
    // fire — outgoing() already filters disabled connections at run time —
    // so it must not block runs as if it were a live error.
    pg.connections.push({
      id: 'dangling', source: pg.agents[0].id, target: 'nonexistent-agent',
      enabled: false, type: 'conversation', priority: 0,
    });
    const issues = validateForRun(pg, providers);
    expect(issues.some((i) => /missing agent/i.test(i.message))).toBe(false);
    expect(hasBlockingErrors(issues)).toBe(false);
  });

  it('blocks localhost providers when the app origin is public (Private Network Access)', () => {
    const { pg, providers } = readyPlayground();
    const issues = validateForRun(pg, providers, 'https://sadeghhp.github.io');
    expect(hasBlockingErrors(issues)).toBe(true);
    expect(issues.some((i) => i.level === 'error' && /localhost|local network|Private Network/i.test(i.message))).toBe(
      true,
    );
  });

  it('allows localhost providers when the app origin is localhost', () => {
    const { pg, providers } = readyPlayground();
    const issues = validateForRun(pg, providers, 'http://localhost:5173');
    expect(hasBlockingErrors(issues)).toBe(false);
  });

  it('warns (does not block) for remote HTTPS that requires CORS', () => {
    const { pg, providers } = readyPlayground();
    providers[0].baseUrl = 'https://api.openai.com';
    providers[0].authMethod = 'bearer';
    providers[0].apiKey = 'sk-test';
    const issues = validateForRun(pg, providers, 'https://sadeghhp.github.io');
    expect(hasBlockingErrors(issues)).toBe(false);
    expect(issues.some((i) => i.level === 'warning' && /CORS/i.test(i.message))).toBe(true);
  });
});

describe('reachableFrom', () => {
  it('follows only enabled edges to enabled targets', () => {
    const { pg, aId, bId } = readyPlayground();
    expect(reachableFrom(pg, aId).has(bId)).toBe(true);
    pg.connections[0].enabled = false;
    expect(reachableFrom(pg, aId).has(bId)).toBe(false);
  });
});

describe('orchestration control validation', () => {
  it('warns when an enabled moderator has no control tools', () => {
    const { pg, providers, aId } = readyPlayground();
    const a = pg.agents.find((x) => x.id === aId)!;
    a.kind = 'moderator';
    const issues = validateForRun(pg, providers);
    const warn = issues.find((i) => /no orchestration tools/i.test(i.message));
    expect(warn?.level).toBe('warning');
    expect(warn?.agentId).toBe(aId);
  });

  it('does not warn for a moderator holding at least one control tool', () => {
    const { pg, providers, aId } = readyPlayground();
    const a = pg.agents.find((x) => x.id === aId)!;
    a.kind = 'moderator';
    a.tools = ['end_discussion'];
    const issues = validateForRun(pg, providers);
    expect(issues.some((i) => /no orchestration tools/i.test(i.message))).toBe(false);
  });

  it('warns about a control tool on an ineligible kind, not as an unknown tool', () => {
    const { pg, providers, bId } = readyPlayground();
    const b = pg.agents.find((x) => x.id === bId)!;
    b.tools = ['end_discussion']; // moderator-only, b is a participant
    const issues = validateForRun(pg, providers);
    const warn = issues.find((i) => i.agentId === bId && /control tool "end_discussion"/i.test(i.message));
    expect(warn?.level).toBe('warning');
    expect(issues.some((i) => /unknown tool "end_discussion"/i.test(i.message))).toBe(false);
  });

  it('accepts an eligible control tool without any warning', () => {
    const { pg, providers, bId } = readyPlayground();
    const b = pg.agents.find((x) => x.id === bId)!;
    b.tools = ['ask_agent'];
    const issues = validateForRun(pg, providers);
    expect(issues.some((i) => i.agentId === bId && /tool/i.test(i.message))).toBe(false);
  });

  it('warns when more than one enabled moderator exists', () => {
    const { pg, providers, aId, bId } = readyPlayground();
    for (const id of [aId, bId]) {
      const agent = pg.agents.find((x) => x.id === id)!;
      agent.kind = 'moderator';
      agent.tools = ['direct_question'];
    }
    const issues = validateForRun(pg, providers);
    const warn = issues.find((i) => /2 moderators/i.test(i.message));
    expect(warn?.level).toBe('warning');
  });
});
