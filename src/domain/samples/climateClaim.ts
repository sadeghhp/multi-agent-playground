import type { Playground, Provider } from '../schema';
import { createPlayground, createAgentFromTemplate } from '../factories';
import { newConnectionId } from '../ids';
import { createLocalOllamaProvider, LOCAL_LLM } from './shared';

/**
 * Science & Nature sample: Researcher → Critic → Summarizer on a climate claim.
 */
export function createClimateClaimPlayground(): { playground: Playground; provider: Provider } {
  const pg = createPlayground('Climate claim check');
  pg.description =
    'Researcher, Critic, and Summarizer assess a climate science claim. Practice evidence vs. uncertainty. Confirm Local (Ollama), then Run.';

  const provider = createLocalOllamaProvider();
  const llm = { providerId: provider.id, ...LOCAL_LLM };

  const researcher = createAgentFromTemplate('researcher', {
    name: 'Researcher',
    role: 'Climate science researcher',
    systemInstruction:
      'Survey what is well-established vs. contested regarding the topic. Prefer primary findings and known measurement limitations. Label uncertainty; do not invent citations.',
    position: { x: 80, y: 140 },
    llm: { ...llm, temperature: 0.5 },
  });
  const critic = createAgentFromTemplate('critic', {
    name: 'Critic',
    position: { x: 380, y: 140 },
    llm: { ...llm, temperature: 0.4 },
  });
  const summarizer = createAgentFromTemplate('summarizer', {
    name: 'Summarizer',
    role: 'Science communicator',
    systemInstruction:
      'Produce a clear brief separating established findings, open questions, and claims that need more evidence. Do not introduce new scientific claims beyond the discussion.',
    position: { x: 680, y: 140 },
    llm: { ...llm, temperature: 0.4 },
  });

  pg.agents.push(researcher, critic, summarizer);
  pg.connections.push(
    { id: newConnectionId(), source: researcher.id, target: critic.id, enabled: true, type: 'conversation', priority: 0 },
    { id: newConnectionId(), source: critic.id, target: summarizer.id, enabled: true, type: 'review', priority: 0 },
  );
  pg.conversation = {
    ...pg.conversation,
    subject:
      'Assess whether Atlantic hurricane intensity has meaningfully increased over the past 40 years.',
    objective:
      'Separate established findings from uncertainty; flag claims that need more evidence.',
    startingAgentId: researcher.id,
    maxTotalTurns: 6,
  };

  return { playground: pg, provider };
}
