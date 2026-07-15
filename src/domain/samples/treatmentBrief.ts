import type { Playground, Provider } from '../schema';
import { createPlayground, createAgentFromTemplate } from '../factories';
import { newConnectionId } from '../ids';
import { createLocalOllamaProvider, LOCAL_LLM } from './shared';

/**
 * Health sample: multi-stakeholder treatment options brief.
 * Educational simulation only — not medical advice.
 */
export function createTreatmentBriefPlayground(): { playground: Playground; provider: Provider } {
  const pg = createPlayground('Treatment options brief');
  pg.description =
    'Clinician, Researcher, Patient advocate, and Moderator outline options for a common condition. Educational simulation — not medical advice. Confirm Local (Ollama), then Run.';

  const provider = createLocalOllamaProvider();
  const llm = { providerId: provider.id, ...LOCAL_LLM };

  const clinician = createAgentFromTemplate('analyst', {
    name: 'Clinician',
    role: 'Primary care physician',
    systemInstruction:
      'Outline first-line clinical options with typical rationale and key safety considerations. State clearly when advice would require individualized assessment. Educational framing only — not a diagnosis or prescription.',
    position: { x: 60, y: 60 },
    llm: { ...llm, temperature: 0.5 },
  });
  const researcher = createAgentFromTemplate('researcher', {
    name: 'Researcher',
    role: 'Evidence reviewer',
    systemInstruction:
      'Summarize what guideline-level evidence generally supports, where guidelines diverge, and where evidence is thin. Prefer established standards over speculative therapies. No fabricated citations.',
    position: { x: 360, y: 60 },
    llm: { ...llm, temperature: 0.4 },
  });
  const advocate = createAgentFromTemplate('analyst', {
    name: 'Patient advocate',
    role: 'Patient advocate',
    systemInstruction:
      'Surface lived priorities: adherence, cost, side effects, lifestyle fit, and shared decision-making. Challenge jargon and one-size-fits-all framing. Stay constructive.',
    colorCategory: 'amber',
    position: { x: 360, y: 260 },
    llm: { ...llm, temperature: 0.6 },
  });
  const moderator = createAgentFromTemplate('moderator', {
    name: 'Moderator',
    role: 'Care conference moderator',
    systemInstruction:
      'Produce a balanced brief that weighs clinical evidence, patient priorities, and safety caveats. Explicitly remind readers this is educational simulation, not medical advice. Flag unresolved trade-offs.',
    position: { x: 660, y: 160 },
    llm: { ...llm, temperature: 0.4 },
  });

  pg.agents.push(clinician, researcher, advocate, moderator);
  pg.connections.push(
    { id: newConnectionId(), source: clinician.id, target: researcher.id, enabled: true, type: 'conversation', priority: 0 },
    { id: newConnectionId(), source: clinician.id, target: advocate.id, enabled: true, type: 'conversation', priority: 1 },
    { id: newConnectionId(), source: researcher.id, target: moderator.id, enabled: true, type: 'handoff', priority: 0 },
    { id: newConnectionId(), source: advocate.id, target: moderator.id, enabled: true, type: 'handoff', priority: 0 },
  );
  pg.conversation = {
    ...pg.conversation,
    subject:
      'Outline first-line treatment options for newly diagnosed Type 2 diabetes in a 55-year-old.',
    objective:
      'Balance clinical evidence, patient priorities, and safety caveats. Educational simulation only — not medical advice.',
    startingAgentId: clinician.id,
    maxTotalTurns: 8,
  };

  return { playground: pg, provider };
}
