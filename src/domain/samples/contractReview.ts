import type { Playground, Provider } from '../schema';
import { createPlayground, createAgentFromTemplate } from '../factories';
import { newConnectionId } from '../ids';
import { createLocalOllamaProvider, LOCAL_LLM } from './shared';

/**
 * Law sample: contract risk review via Analyst → Critic → Moderator.
 * Educational simulation only — not legal advice.
 */
export function createContractReviewPlayground(): { playground: Playground; provider: Provider } {
  const pg = createPlayground('Sample: Contract risk review');
  pg.description =
    'Analyst, Critic, and Moderator review B2B SaaS liability clauses. Educational simulation — not legal advice. Confirm Local (Ollama), then Run.';

  const provider = createLocalOllamaProvider();
  const llm = { providerId: provider.id, ...LOCAL_LLM };

  const analyst = createAgentFromTemplate('analyst', {
    name: 'Contract Analyst',
    role: 'Commercial counsel analyst',
    systemInstruction:
      'Identify material risk in limitation-of-liability and indemnification clauses. Prefer precise issue spotting over legal conclusions. Note what information is missing. Educational framing only — not legal advice.',
    position: { x: 80, y: 140 },
    llm: { ...llm, temperature: 0.5 },
  });
  const critic = createAgentFromTemplate('critic', {
    name: 'Risk Critic',
    role: 'Counterparty risk reviewer',
    systemInstruction:
      'Challenge soft spots: uncapped exposure, carve-outs, mutuality gaps, and ambiguous trigger language. Ground every objection in the discussion; do not invent clause text.',
    position: { x: 380, y: 140 },
    llm: { ...llm, temperature: 0.4 },
  });
  const moderator = createAgentFromTemplate('moderator', {
    name: 'Negotiation Lead',
    role: 'Deal lead',
    systemInstruction:
      'Synthesize top liability risks and practical negotiation points. Remind readers this is an educational simulation, not legal advice. Leave unresolved issues explicit.',
    position: { x: 680, y: 140 },
    llm: { ...llm, temperature: 0.4 },
  });

  pg.agents.push(analyst, critic, moderator);
  pg.connections.push(
    { id: newConnectionId(), source: analyst.id, target: critic.id, enabled: true, type: 'conversation', priority: 0 },
    { id: newConnectionId(), source: critic.id, target: moderator.id, enabled: true, type: 'review', priority: 0 },
  );
  pg.conversation = {
    ...pg.conversation,
    subject:
      'Review limitation-of-liability and indemnification clauses in a B2B SaaS vendor agreement.',
    objective:
      'Identify top liability risks and negotiation points. Educational simulation only — not legal advice.',
    startingAgentId: analyst.id,
    maxTotalTurns: 6,
  };

  return { playground: pg, provider };
}
