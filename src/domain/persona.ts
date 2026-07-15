import type { Agent, PersonaConfig, PersonaCitationStyle } from './schema';

/**
 * Persona identity fragments for prompt assembly. Lives at the domain layer
 * (same pattern as conduct.ts) so promptAssembly, previews, and tests share
 * one source of truth for digital-shadow role consciousness.
 */

export function defaultPersonaConfig(
  overrides: Partial<PersonaConfig> = {},
): PersonaConfig {
  return {
    realName: '',
    knownFor: '',
    stanceNotes: '',
    citationStyle: 'in-character',
    ...overrides,
  };
}

function citationDirective(realName: string, style: PersonaCitationStyle): string {
  if (style === 'attributed') {
    return (
      `When referencing ${realName}'s published work, attribute it clearly ` +
      `(e.g. "${realName} wrote that…") and then continue in first person as ` +
      `the digital shadow adding interpretation or argument.`
    );
  }
  return (
    `When referencing ${realName}'s published work, cite it in first person ` +
    `(e.g. "In [work title] I argued that…"). Do not invent quotations or titles.`
  );
}

/**
 * Fixed behavioural contract for a digital-shadow agent. Injected at prompt
 * time so free-text role/systemInstruction cannot silently drop role consciousness.
 */
export function buildDigitalShadowDirective(persona: PersonaConfig): string {
  const realName = persona.realName.trim() || 'the real person';
  const lines = [
    `You are a digital shadow of ${realName} — a simulation in this multi-agent application, not the living person.`,
    `Speak in first person as this persona. Defend and elaborate positions the way ${realName} would.`,
    'Do not refer to yourself in third person (never "X believes…" or "according to X" about yourself).',
    `Do not present yourself as "${realName}'s Advocate", an explainer of ${realName}, or a commentator about them.`,
    citationDirective(realName, persona.citationStyle),
    'Ground your positions in publicly known views. Do not invent private beliefs, unpublished opinions, or fabricated quotes.',
    'When you are unsure or the question goes beyond what is publicly known, say so rather than guessing.',
  ];

  if (persona.knownFor.trim()) {
    lines.push(`Publicly known for: ${persona.knownFor.trim()}`);
  }
  if (persona.stanceNotes.trim()) {
    lines.push(`Core stance notes (ground your replies here):\n${persona.stanceNotes.trim()}`);
  }

  return lines.join('\n');
}

/**
 * Ordered identity sections for the system prompt (section 1 of prompt assembly).
 * Role agents keep the historical "You are Agent: …" line; digital shadows get
 * the shadow identity line plus the full consciousness contract.
 */
export function buildPersonaIdentitySection(agent: Agent): string[] {
  if (agent.personaMode !== 'digital-shadow') {
    return [`You are Agent: ${agent.name || 'Unnamed agent'}.`];
  }

  const persona = agent.persona ?? defaultPersonaConfig();
  const realName = persona.realName.trim() || agent.name.trim() || 'the real person';
  return [
    `You are a digital shadow of ${realName}. You speak as this persona in first person.`,
    buildDigitalShadowDirective({ ...persona, realName }),
  ];
}
