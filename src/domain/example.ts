import type { Playground, Provider } from './schema';
import { createPlayground, createAgentFromTemplate } from './factories';
import { newConnectionId } from './ids';
import { createLocalOllamaProvider, LOCAL_LLM } from './samples/shared';

/**
 * Onboarding example (spec §25 Phase 7). Seeds the exact three-agent graph from
 * the acceptance scenario (§24): Strategist → Critic → Moderator, wired to a
 * local Ollama provider. The user only needs to confirm the provider/model and
 * press Run. No API key is baked in.
 *
 * Providers are application-global (schema v2), so the example's provider is
 * returned alongside the playground for the caller to register into the global
 * registry (reusing an equivalent one if it already exists).
 */
export function createExamplePlayground(): { playground: Playground; provider: Provider } {
  const pg = createPlayground('Open-source decision');
  pg.description =
    'Basic critique loop: Strategist proposes, Critic challenges, Moderator concludes. Confirm Local (Ollama) in Providers, then press Run.';

  const provider = createLocalOllamaProvider();

  const strategist = createAgentFromTemplate('analyst', {
    name: 'Strategist',
    role: 'Product strategist',
    systemInstruction:
      'Propose a clear strategic recommendation with supporting reasoning.',
    position: { x: 80, y: 140 },
    llm: { providerId: provider.id, ...LOCAL_LLM, temperature: 0.7 },
  });
  const critic = createAgentFromTemplate('critic', {
    name: 'Critic',
    position: { x: 380, y: 140 },
    llm: { providerId: provider.id, ...LOCAL_LLM, temperature: 0.6 },
  });
  const moderator = createAgentFromTemplate('moderator', {
    name: 'Moderator',
    position: { x: 680, y: 140 },
    llm: { providerId: provider.id, ...LOCAL_LLM, temperature: 0.5 },
  });

  pg.agents.push(strategist, critic, moderator);
  pg.connections.push(
    { id: newConnectionId(), source: strategist.id, target: critic.id, enabled: true, type: 'conversation', priority: 0 },
    { id: newConnectionId(), source: critic.id, target: moderator.id, enabled: true, type: 'review', priority: 0 },
  );
  pg.conversation = {
    ...pg.conversation,
    subject:
      'Evaluate whether a company should release an open-source version of its internal agent framework.',
    objective: 'Reach a clear recommendation with the main trade-offs.',
    startingAgentId: strategist.id,
    maxTotalTurns: 6,
  };

  return { playground: pg, provider };
}
