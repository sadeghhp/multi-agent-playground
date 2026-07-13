import { describe, expect, it } from 'vitest';
import { createAgent, createPlayground, createProvider } from '../../domain/factories';
import { exportToJson, importFromJson, toExport } from '../serialization';

function playgroundWithSecret() {
  const pg = createPlayground('Test');
  const provider = createProvider({ displayName: 'Local', baseUrl: 'http://localhost:11434', apiKey: 'super-secret' });
  const agent = createAgent({ name: 'A', role: 'r', systemInstruction: 'do', llm: { ...createAgent().llm, providerId: provider.id, model: 'm' } });
  pg.providers.push(provider);
  pg.agents.push(agent);
  return { pg, provider, agent };
}

describe('export', () => {
  it('excludes API keys from the export object and JSON string', () => {
    const { pg } = playgroundWithSecret();
    const exported = toExport(pg);
    expect((exported.providers[0] as Record<string, unknown>).apiKey).toBeUndefined();

    const json = exportToJson(pg);
    expect(json).not.toContain('super-secret');
    expect(json).toContain('"schemaVersion"');
  });
});

describe('import', () => {
  it('rejects non-JSON', () => {
    const res = importFromJson('{ not json', false);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/valid JSON/i);
  });

  it('rejects a file with a future schema version', () => {
    const res = importFromJson(JSON.stringify({ schemaVersion: 999 }), false);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/newer version/i);
  });

  it('rejects structurally invalid playgrounds', () => {
    const res = importFromJson(JSON.stringify({ schemaVersion: 1, id: 'x' }), false);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid playground/i);
  });

  it('round-trips a valid export and preserves references when not copying', () => {
    const { pg, provider, agent } = playgroundWithSecret();
    const json = exportToJson(pg);
    const res = importFromJson(json, false);
    expect(res.ok).toBe(true);
    expect(res.playground!.providers[0].id).toBe(provider.id);
    expect(res.playground!.agents[0].llm.providerId).toBe(agent.llm.providerId);
  });

  it('regenerates ids as a copy while keeping internal references consistent', () => {
    const { pg, provider, agent } = playgroundWithSecret();
    // add a connection to verify remap
    const other = createAgent({ name: 'B' });
    pg.agents.push(other);
    pg.connections.push({ id: 'cn_x', source: agent.id, target: other.id, enabled: true, type: 'conversation', priority: 0 });

    const json = exportToJson(pg);
    const res = importFromJson(json, true);
    expect(res.ok).toBe(true);
    const copy = res.playground!;

    // ids changed
    expect(copy.id).not.toBe(pg.id);
    expect(copy.providers[0].id).not.toBe(provider.id);
    // agent still points at the remapped provider
    expect(copy.agents[0].llm.providerId).toBe(copy.providers[0].id);
    // connection endpoints remapped to the new agent ids
    const conn = copy.connections[0];
    const agentIds = copy.agents.map((a) => a.id);
    expect(agentIds).toContain(conn.source);
    expect(agentIds).toContain(conn.target);
  });

  it('warns about agents referencing a missing provider', () => {
    const pg = createPlayground('W');
    pg.agents.push(createAgent({ name: 'A', llm: { ...createAgent().llm, providerId: 'pv_missing', model: 'm' } }));
    const res = importFromJson(exportToJson(pg), false);
    expect(res.ok).toBe(true);
    expect(res.warnings.join(' ')).toMatch(/provider/i);
  });
});
