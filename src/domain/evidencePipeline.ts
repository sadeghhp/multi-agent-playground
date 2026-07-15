import type { Playground, Provider } from './schema';
import { createPlayground, createProvider, createAgentFromTemplate } from './factories';
import { evidenceRoleInstruction } from './conduct';
import { newConnectionId } from './ids';

/**
 * Evidence-pipeline preset (opt-in). Seeds a role-separated graph that keeps
 * answer generation strictly apart from verification, per the agent-conduct
 * spec: no agent both proposes an answer and certifies its own correctness.
 *
 *   Proposer --review--> Critic    --handoff--> Finalizer
 *            --review--> Verifier  --handoff--> Finalizer
 *
 * Critic and Verifier both fan out from the Proposer so each acts on the
 * candidate itself (not on each other's output), then hand off to the
 * Finalizer. The orchestrator's duplicate-queue guard joins both branches into
 * a single Finalizer turn, which sees the full transcript. Each agent speaks
 * once (maxResponsesPerAgent = 1) so the run terminates cleanly.
 *
 * Like createExamplePlayground, the provider is returned alongside for the
 * caller to register into the global registry. No API key is baked in.
 */
export function createEvidencePipelinePlayground(): { playground: Playground; provider: Provider } {
  const pg = createPlayground('Preset: Evidence pipeline');

  const provider = createProvider({
    displayName: 'Local (Ollama)',
    baseUrl: 'http://localhost:11434',
    path: '/v1/chat/completions',
    authMethod: 'none',
    defaultModel: 'llama3.1',
    models: ['llama3.1'],
  });

  const llm = { providerId: provider.id, model: 'llama3.1', maxOutputTokens: 512 };

  const proposer = createAgentFromTemplate('proposer', {
    position: { x: 60, y: 160 },
    // Lower temperature across the pipeline: this is verification work, not brainstorming.
    llm: { ...llm, temperature: 0.5 },
  });
  const critic = createAgentFromTemplate('critic', {
    name: 'Critic',
    role: 'Defect finder',
    // The palette Critic is intentionally casual; the pipeline uses the
    // structured critic protocol so it emits objections, not prose.
    systemInstruction: evidenceRoleInstruction('critic'),
    colorCategory: 'red',
    position: { x: 360, y: 60 },
    llm: { ...llm, temperature: 0.4 },
  });
  const verifier = createAgentFromTemplate('verifier', {
    position: { x: 360, y: 260 },
    llm: { ...llm, temperature: 0.3 },
  });
  const finalizer = createAgentFromTemplate('finalizer', {
    position: { x: 660, y: 160 },
    llm: { ...llm, temperature: 0.3 },
  });

  // One response per agent: a strict single pass through the roles.
  for (const a of [proposer, critic, verifier, finalizer]) {
    a.runtime = { ...a.runtime, maxResponsesPerRun: 1 };
  }

  pg.agents.push(proposer, critic, verifier, finalizer);
  pg.connections.push(
    { id: newConnectionId(), source: proposer.id, target: critic.id, enabled: true, type: 'review', priority: 1 },
    { id: newConnectionId(), source: proposer.id, target: verifier.id, enabled: true, type: 'review', priority: 0 },
    { id: newConnectionId(), source: critic.id, target: finalizer.id, enabled: true, type: 'handoff', priority: 0 },
    { id: newConnectionId(), source: verifier.id, target: finalizer.id, enabled: true, type: 'handoff', priority: 0 },
  );
  pg.conversation = {
    ...pg.conversation,
    subject:
      'Determine whether SQLite is a suitable primary datastore for a multi-tenant SaaS backend serving 5,000 concurrent write-heavy tenants.',
    objective: 'Reach a verified recommendation, with unsupported claims marked Unresolved.',
    startingAgentId: proposer.id,
    maxTotalTurns: 6,
    maxResponsesPerAgent: 1,
  };

  return { playground: pg, provider };
}
