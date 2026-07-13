import { describe, expect, it } from 'vitest';
import { createAgent, createPlayground, createProvider } from '../../domain/factories';
import type { Playground } from '../../domain/schema';
import { hasBlockingErrors, reachableFrom, validateForRun } from '../validate';

function readyPlayground(): { pg: Playground; aId: string; bId: string } {
  const pg = createPlayground('P');
  const provider = createProvider({ baseUrl: 'http://localhost:11434', authMethod: 'none', models: ['m'] });
  const base = createAgent();
  const a = createAgent({ name: 'A', role: 'r', systemInstruction: 'do', llm: { ...base.llm, providerId: provider.id, model: 'm' } });
  const b = createAgent({ name: 'B', role: 'r', systemInstruction: 'do', llm: { ...base.llm, providerId: provider.id, model: 'm' } });
  pg.providers.push(provider);
  pg.agents.push(a, b);
  pg.connections.push({ id: 'c', source: a.id, target: b.id, enabled: true, type: 'conversation', priority: 0 });
  pg.conversation.startingAgentId = a.id;
  return { pg, aId: a.id, bId: b.id };
}

describe('validateForRun', () => {
  it('passes a fully configured graph', () => {
    const { pg } = readyPlayground();
    expect(hasBlockingErrors(validateForRun(pg))).toBe(false);
  });

  it('errors when no starting agent is selected', () => {
    const { pg } = readyPlayground();
    pg.conversation.startingAgentId = null;
    const issues = validateForRun(pg);
    expect(issues.some((i) => i.level === 'error' && /starting agent/i.test(i.message))).toBe(true);
  });

  it('errors when an agent lacks a provider or model', () => {
    const { pg, bId } = readyPlayground();
    const b = pg.agents.find((a) => a.id === bId)!;
    b.llm.providerId = null;
    b.llm.model = '';
    const issues = validateForRun(pg);
    expect(issues.some((i) => i.agentId === bId && /provider/i.test(i.message))).toBe(true);
    expect(issues.some((i) => i.agentId === bId && /model/i.test(i.message))).toBe(true);
  });

  it('warns about an unreachable enabled agent instead of erroring', () => {
    const { pg } = readyPlayground();
    // add an isolated enabled agent C with no edges
    const provider = pg.providers[0];
    const base = createAgent();
    pg.agents.push(createAgent({ name: 'C', role: 'r', systemInstruction: 'do', llm: { ...base.llm, providerId: provider.id, model: 'm' } }));
    const issues = validateForRun(pg);
    const cWarn = issues.find((i) => /not reachable/i.test(i.message));
    expect(cWarn?.level).toBe('warning');
    expect(hasBlockingErrors(issues)).toBe(false);
  });

  it('errors when the starting agent is disabled', () => {
    const { pg, aId } = readyPlayground();
    pg.agents.find((a) => a.id === aId)!.runtime.enabled = false;
    expect(validateForRun(pg).some((i) => i.level === 'error' && /disabled/i.test(i.message))).toBe(true);
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
