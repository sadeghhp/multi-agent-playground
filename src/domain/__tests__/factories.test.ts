import { describe, expect, it } from 'vitest';
import {
  createAgent,
  createProvider,
  createSavedAgent,
  duplicateAgent,
  instantiateFromLibrary,
} from '../factories';

describe('duplicateAgent', () => {
  it('assigns a new id and fresh skill ids, offsetting position (spec §9.3)', () => {
    const original = createAgent({
      name: 'A',
      skills: [{ id: 's1', name: 'x', description: '', instruction: '', enabled: true }],
      position: { x: 10, y: 20 },
    });
    const copy = duplicateAgent(original);
    expect(copy.id).not.toBe(original.id);
    expect(copy.skills[0].id).not.toBe('s1');
    expect(copy.position).not.toEqual(original.position);
    expect(copy.name).toContain('copy');
  });
});

describe('agent library (pool)', () => {
  it('createSavedAgent snapshots the agent name and config without a copy suffix', () => {
    const agent = createAgent({ name: 'Analyst', role: 'Analyst' });
    const saved = createSavedAgent(agent);
    expect(saved.name).toBe('Analyst');
    expect(saved.agent).toEqual(agent);
    expect(saved.id).toMatch(/^lib_/);
  });

  it('instantiateFromLibrary keeps the name, freshens ids, and takes a position', () => {
    const original = createAgent({
      name: 'Analyst',
      skills: [{ id: 's1', name: 'x', description: '', instruction: '', enabled: true }],
      position: { x: 10, y: 20 },
    });
    const saved = createSavedAgent(original);
    const instance = instantiateFromLibrary(saved, { x: 200, y: 120 });

    expect(instance.name).toBe('Analyst'); // no "(copy)" suffix
    expect(instance.id).not.toBe(original.id);
    expect(instance.skills[0].id).not.toBe('s1');
    expect(instance.position).toEqual({ x: 200, y: 120 });
  });
});

describe('provider duplication id safety', () => {
  it('a duplicate built by stripping id gets a distinct id', () => {
    const original = createProvider({ displayName: 'P', baseUrl: 'http://localhost:11434' });
    // Mirrors ProviderManager.handleDuplicate: strip id before spreading.
    const { id: _id, apiKey: _key, ...rest } = original;
    const copy = createProvider({ ...rest, displayName: 'P (copy)' });
    expect(copy.id).not.toBe(original.id);
    expect(copy.displayName).toBe('P (copy)');
  });
});
