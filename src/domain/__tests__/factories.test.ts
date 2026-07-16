import { describe, expect, it } from 'vitest';
import {
  applyRunPreset,
  createAgent,
  createAgentFromTemplate,
  createLibrarySkill,
  createPlayground,
  createProvider,
  createRunPreset,
  createSavedAgent,
  defaultConversationSettings,
  duplicateAgent,
  instantiateFromLibrary,
  SKILL_PRESETS,
} from '../factories';

describe('createAgent', () => {
  it('defaults to personaMode role', () => {
    expect(createAgent().personaMode).toBe('role');
  });
});

describe('createAgentFromTemplate', () => {
  it('creates a digital-shadow template with persona grounding stubs', () => {
    const agent = createAgentFromTemplate('digital-shadow');
    expect(agent.personaMode).toBe('digital-shadow');
    expect(agent.persona?.citationStyle).toBe('in-character');
    expect(agent.persona?.stanceNotes).toMatch(/real person/i);
    expect(agent.systemInstruction).toMatch(/first person/i);
  });
});

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

  it('increments the copy suffix instead of cascading (L-9 regression)', () => {
    const original = createAgent({ name: 'Analyst' });
    const copy1 = duplicateAgent(original);
    expect(copy1.name).toBe('Analyst (copy)');
    const copy2 = duplicateAgent(copy1);
    expect(copy2.name).toBe('Analyst (copy 2)');
    const copy3 = duplicateAgent(copy2);
    expect(copy3.name).toBe('Analyst (copy 3)');
  });

  it('does not alias nested config objects with the original (L-8 regression)', () => {
    const original = createAgent({ name: 'A' });
    const copy = duplicateAgent(original);
    expect(copy.characteristics).not.toBe(original.characteristics);
    expect(copy.llm).not.toBe(original.llm);
    expect(copy.runtime).not.toBe(original.runtime);
    // Mutating the copy's nested config must not leak back into the original.
    copy.llm.model = 'mutated';
    expect(original.llm.model).not.toBe('mutated');
  });

  // F19: persona and llm.stopSequences must be cloned, not shared by reference.
  it('deep-clones persona and llm.stopSequences (F19)', () => {
    const original = createAgent({
      name: 'Shadow',
      personaMode: 'digital-shadow',
      persona: { realName: 'Ada', knownFor: 'computing', stanceNotes: '- notes', citationStyle: 'in-character' },
      llm: { providerId: null, model: 'm', temperature: 0.7, maxOutputTokens: 100, stopSequences: ['STOP'] },
    });
    const copy = duplicateAgent(original);
    expect(copy.persona).not.toBe(original.persona);
    expect(copy.llm.stopSequences).not.toBe(original.llm.stopSequences);
    copy.persona!.stanceNotes = 'mutated';
    copy.llm.stopSequences!.push('EXTRA');
    expect(original.persona!.stanceNotes).toBe('- notes');
    expect(original.llm.stopSequences).toEqual(['STOP']);
  });
});

describe('skill library', () => {
  it('seeds a new playground from the built-in presets with fresh ids', () => {
    const pg = createPlayground('Seeded');
    expect(pg.skillLibrary).toHaveLength(SKILL_PRESETS.length);
    expect(pg.skillLibrary.map((s) => s.name)).toEqual(SKILL_PRESETS.map((p) => p.name));
    // Each seeded entry has a distinct id.
    const ids = new Set(pg.skillLibrary.map((s) => s.id));
    expect(ids.size).toBe(pg.skillLibrary.length);
  });

  it('createLibrarySkill applies defaults and a fresh id', () => {
    const a = createLibrarySkill({ name: 'x' });
    const b = createLibrarySkill({ name: 'x' });
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({ name: 'x', description: '', instruction: '' });
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

describe('run presets', () => {
  it('createRunPreset snapshots run-level options but not subject/objective/context/startingAgentId', () => {
    const conversation = {
      ...defaultConversationSettings(),
      subject: 'Ship it?',
      objective: 'Decide',
      initialContext: 'bg',
      startingAgentId: 'ag_1',
      chitchatPolicy: 'concise-factual' as const,
      temperatureOverride: 0.2,
    };
    const preset = createRunPreset('Terse fact-check', conversation);
    expect(preset.name).toBe('Terse fact-check');
    expect(preset.id).toMatch(/^rp_/);
    expect(preset.settings.chitchatPolicy).toBe('concise-factual');
    expect(preset.settings.temperatureOverride).toBe(0.2);
    expect(preset.settings).not.toHaveProperty('subject');
    expect(preset.settings).not.toHaveProperty('objective');
    expect(preset.settings).not.toHaveProperty('initialContext');
    expect(preset.settings).not.toHaveProperty('startingAgentId');
  });

  it('applyRunPreset overlays a preset\'s options while keeping the conversation\'s own content', () => {
    const conversation = { ...defaultConversationSettings(), subject: 'Ship it?', startingAgentId: 'ag_1' };
    const preset = createRunPreset('Terse', {
      ...defaultConversationSettings(),
      chitchatPolicy: 'concise-factual' as const,
      responseLength: 'short' as const,
    });
    const applied = applyRunPreset(conversation, preset);
    expect(applied.subject).toBe('Ship it?');
    expect(applied.startingAgentId).toBe('ag_1');
    expect(applied.chitchatPolicy).toBe('concise-factual');
    expect(applied.responseLength).toBe('short');
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
