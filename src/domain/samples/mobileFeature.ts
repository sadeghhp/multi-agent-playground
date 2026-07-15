import type { Playground, Provider } from '../schema';
import { createPlayground, createAgentFromTemplate } from '../factories';
import { newConnectionId } from '../ids';
import { createLocalOllamaProvider, LOCAL_LLM } from './shared';

/**
 * Product sample: ship a mobile feature via PM → Engineer → QA → Ship Lead.
 */
export function createMobileFeaturePlayground(): { playground: Playground; provider: Provider } {
  const pg = createPlayground('Ship a mobile feature');
  pg.description =
    'Product Manager, Engineer, QA, and Ship Lead plan an offline workout-tracking feature. Role handoffs for a product decision. Confirm Local (Ollama), then Run.';

  const provider = createLocalOllamaProvider();
  const llm = { providerId: provider.id, ...LOCAL_LLM };

  const pm = createAgentFromTemplate('analyst', {
    name: 'Product Manager',
    role: 'Product manager',
    systemInstruction:
      'Frame the user problem, success metrics, and a phased scope. Prefer concrete UX outcomes over feature laundry lists. Flag open product questions explicitly.',
    position: { x: 60, y: 80 },
    llm: { ...llm, temperature: 0.7 },
  });
  const engineer = createAgentFromTemplate('analyst', {
    name: 'Mobile Engineer',
    role: 'Mobile engineer',
    systemInstruction:
      'Respond with an engineering plan: platform approach (iOS/Android), data sync/offline strategy, main risks, and a realistic effort split. Stay practical; call out unknowns.',
    colorCategory: 'violet',
    position: { x: 360, y: 80 },
    llm: { ...llm, temperature: 0.6 },
  });
  const qa = createAgentFromTemplate('critic', {
    name: 'Release QA',
    role: 'QA lead',
    systemInstruction:
      'Challenge the plan for testability and release risk. List critical test scenarios, edge cases (offline/online transitions), and ship-blockers. Do not invent product requirements.',
    position: { x: 360, y: 280 },
    llm: { ...llm, temperature: 0.5 },
  });
  const shipLead = createAgentFromTemplate('moderator', {
    name: 'Ship Lead',
    role: 'Release lead',
    systemInstruction:
      'Synthesize PM, engineering, and QA into a phased implementation plan. Resolve conflicts fairly; leave unresolved trade-offs explicit rather than papering over them.',
    position: { x: 660, y: 160 },
    llm: { ...llm, temperature: 0.5 },
  });

  pg.agents.push(pm, engineer, qa, shipLead);
  pg.connections.push(
    { id: newConnectionId(), source: pm.id, target: engineer.id, enabled: true, type: 'conversation', priority: 0 },
    { id: newConnectionId(), source: engineer.id, target: qa.id, enabled: true, type: 'review', priority: 0 },
    { id: newConnectionId(), source: qa.id, target: shipLead.id, enabled: true, type: 'handoff', priority: 0 },
    { id: newConnectionId(), source: pm.id, target: shipLead.id, enabled: true, type: 'handoff', priority: 1 },
  );
  pg.conversation = {
    ...pg.conversation,
    subject:
      'Plan adding offline workout tracking to a fitness mobile app for iOS and Android.',
    objective:
      'Produce a phased implementation plan with UX, engineering, and QA considerations.',
    startingAgentId: pm.id,
    maxTotalTurns: 8,
  };

  return { playground: pg, provider };
}
