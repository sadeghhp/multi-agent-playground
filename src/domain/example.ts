import type { Playground, Provider } from './schema';
import {
  createPlayground,
  createProvider,
  createAgentFromTemplate,
} from './factories';
import { newConnectionId } from './ids';

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
  const pg = createPlayground('Example: Open-source decision');

  const provider = createProvider({
    displayName: 'Local (Ollama)',
    baseUrl: 'http://localhost:11434',
    path: '/v1/chat/completions',
    authMethod: 'none',
    defaultModel: 'llama3.1',
    models: ['llama3.1'],
  });

  const strategist = createAgentFromTemplate('analyst', {
    name: 'Strategist',
    role: 'Product strategist',
    systemInstruction:
      'Propose a clear strategic recommendation with supporting reasoning.',
    position: { x: 80, y: 140 },
    llm: { providerId: provider.id, model: 'llama3.1', temperature: 0.7, maxOutputTokens: 512 },
  });
  const critic = createAgentFromTemplate('critic', {
    name: 'Critic',
    position: { x: 380, y: 140 },
    llm: { providerId: provider.id, model: 'llama3.1', temperature: 0.6, maxOutputTokens: 512 },
  });
  const moderator = createAgentFromTemplate('moderator', {
    name: 'Moderator',
    position: { x: 680, y: 140 },
    llm: { providerId: provider.id, model: 'llama3.1', temperature: 0.5, maxOutputTokens: 512 },
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
