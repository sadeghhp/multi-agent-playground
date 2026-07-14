import { describe, expect, it } from 'vitest';
import { createAgent, createPlayground, createProvider } from '../../domain/factories';
import { exportToJson, importFromJson, toExport } from '../serialization';

function playgroundWithSecret() {
  const pg = createPlayground('Test');
  const provider = createProvider({ displayName: 'Local', baseUrl: 'http://localhost:11434', apiKey: 'super-secret' });
  const agent = createAgent({ name: 'A', role: 'r', systemInstruction: 'do', llm: { ...createAgent().llm, providerId: provider.id, model: 'm' } });
  pg.agents.push(agent);
  return { pg, providers: [provider], provider, agent };
}

describe('export', () => {
  it('re-embeds the referenced providers, key-stripped', () => {
    const { pg, providers, provider } = playgroundWithSecret();
    const exported = toExport(pg, providers);
    expect(exported.providers).toHaveLength(1);
    expect(exported.providers[0].id).toBe(provider.id);
    expect((exported.providers[0] as Record<string, unknown>).apiKey).toBeUndefined();
  });

  it('excludes API keys from the export JSON string', () => {
    const { pg, providers } = playgroundWithSecret();
    const json = exportToJson(pg, providers);
    expect(json).not.toContain('super-secret');
    expect(json).toContain('"schemaVersion"');
  });

  it('only embeds providers actually referenced by an agent', () => {
    const { pg, providers } = playgroundWithSecret();
    const unused = createProvider({ displayName: 'Unused', baseUrl: 'http://localhost:9999' });
    const exported = toExport(pg, [...providers, unused]);
    expect(exported.providers.map((p) => p.id)).not.toContain(unused.id);
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

  it('round-trips a valid export, returning providers separately and preserving references', () => {
    const { pg, providers, provider, agent } = playgroundWithSecret();
    const json = exportToJson(pg, providers);
    const res = importFromJson(json, false);
    expect(res.ok).toBe(true);
    // Providers come back on the result, not on the playground.
    expect(res.playground).not.toHaveProperty('providers');
    expect(res.providers!.map((p) => p.id)).toContain(provider.id);
    expect(res.playground!.agents[0].llm.providerId).toBe(agent.llm.providerId);
  });

  it('regenerates playground/agent/connection ids as a copy but preserves provider ids', () => {
    const { pg, providers, provider, agent } = playgroundWithSecret();
    // add a connection to verify remap
    const other = createAgent({ name: 'B' });
    pg.agents.push(other);
    pg.connections.push({ id: 'cn_x', source: agent.id, target: other.id, enabled: true, type: 'conversation', priority: 0 });

    const json = exportToJson(pg, providers);
    const res = importFromJson(json, true);
    expect(res.ok).toBe(true);
    const copy = res.playground!;

    // playground id changed…
    expect(copy.id).not.toBe(pg.id);
    // …but provider ids are stable so the merge can dedupe and refs still resolve.
    expect(res.providers!.map((p) => p.id)).toContain(provider.id);
    expect(copy.agents.find((a) => a.name === 'A')!.llm.providerId).toBe(provider.id);
    // connection endpoints remapped to the new agent ids
    const conn = copy.connections[0];
    const agentIds = copy.agents.map((a) => a.id);
    expect(agentIds).toContain(conn.source);
    expect(agentIds).toContain(conn.target);
  });

  it('regenerates library skill ids and remaps agent libraryId references on copy', () => {
    const pg = createPlayground('Lib');
    const libSkill = pg.skillLibrary[0];
    // An agent skill copied from that library entry.
    const agent = createAgent({
      name: 'A',
      skills: [{ id: 'sk_orig', name: libSkill.name, description: '', instruction: '', enabled: true, libraryId: libSkill.id }],
    });
    pg.agents.push(agent);

    const res = importFromJson(exportToJson(pg, []), true);
    expect(res.ok).toBe(true);
    const copy = res.playground!;

    const copiedLib = copy.skillLibrary[0];
    // Library id changed…
    expect(copiedLib.id).not.toBe(libSkill.id);
    // …and the agent skill's provenance pointer was remapped to the new library id.
    const copiedSkill = copy.agents[0].skills[0];
    expect(copiedSkill.id).not.toBe('sk_orig');
    expect(copiedSkill.libraryId).toBe(copiedLib.id);
  });

  it('drops a dangling libraryId (no matching library entry) on copy', () => {
    const pg = createPlayground('Dangling');
    pg.skillLibrary = [];
    const agent = createAgent({
      name: 'A',
      skills: [{ id: 'sk_orig', name: 'x', description: '', instruction: '', enabled: true, libraryId: 'lib_gone' }],
    });
    pg.agents.push(agent);

    const res = importFromJson(exportToJson(pg, []), true);
    expect(res.ok).toBe(true);
    expect(res.playground!.agents[0].skills[0].libraryId).toBeUndefined();
  });

  it('warns about agents referencing a provider not in the file', () => {
    const pg = createPlayground('W');
    pg.agents.push(createAgent({ name: 'A', llm: { ...createAgent().llm, providerId: 'pv_missing', model: 'm' } }));
    const res = importFromJson(exportToJson(pg, []), false);
    expect(res.ok).toBe(true);
    expect(res.warnings.join(' ')).toMatch(/provider/i);
  });
});
