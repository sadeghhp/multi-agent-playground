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
