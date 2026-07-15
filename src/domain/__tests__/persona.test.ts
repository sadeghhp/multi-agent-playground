import { describe, expect, it } from 'vitest';
import { createAgent } from '../factories';
import {
  buildDigitalShadowDirective,
  buildPersonaIdentitySection,
  defaultPersonaConfig,
} from '../persona';

describe('defaultPersonaConfig', () => {
  it('defaults citation style to in-character', () => {
    expect(defaultPersonaConfig().citationStyle).toBe('in-character');
  });
});

describe('buildDigitalShadowDirective', () => {
  it('forbids third-person advocate framing', () => {
    const text = buildDigitalShadowDirective(
      defaultPersonaConfig({ realName: 'Thomas Nagel' }),
    );
    expect(text).toContain('digital shadow of Thomas Nagel');
    expect(text).toContain('Do not refer to yourself in third person');
    expect(text).toContain("Thomas Nagel's Advocate");
  });
});

describe('buildPersonaIdentitySection', () => {
  it('returns the legacy identity line for role agents', () => {
    const agent = createAgent({ name: 'Critic' });
    expect(buildPersonaIdentitySection(agent)).toEqual(['You are Agent: Critic.']);
  });

  it('returns shadow identity plus directive for digital shadows', () => {
    const agent = createAgent({
      name: 'Thomas Nagel',
      personaMode: 'digital-shadow',
      persona: defaultPersonaConfig({
        realName: 'Thomas Nagel',
        stanceNotes: '- bats',
      }),
    });
    const sections = buildPersonaIdentitySection(agent);
    expect(sections[0]).toContain('digital shadow of Thomas Nagel');
    expect(sections[1]).toContain('- bats');
  });
});
