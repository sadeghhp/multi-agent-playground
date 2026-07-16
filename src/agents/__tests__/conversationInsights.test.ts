import { describe, it, expect } from 'vitest';
import { resolveInsightTarget } from '../conversationInsights';
import { DEFAULT_LLM_SETTINGS } from '../../domain/llmSettings';
import { createAgent, createPlayground, createProvider } from '../../domain/factories';
import type { Playground, Provider } from '../../domain/schema';

function playgroundWithAgent(providerId: string, model: string): Playground {
  const pg = createPlayground('T');
  const agent = createAgent({
    llm: { providerId: providerId || null, model, temperature: 0.7, maxOutputTokens: 1000 },
  });
  pg.agents = [agent];
  pg.conversation.startingAgentId = agent.id;
  return pg;
}

describe('resolveInsightTarget', () => {
  const agentProvider = createProvider({ id: 'p-agent', displayName: 'Agent P', enabled: true });
  const insightProvider = createProvider({ id: 'p-insight', displayName: 'Insight P', enabled: true });

  it('borrows the agent provider/model when no settings target is set', () => {
    const pg = playgroundWithAgent('p-agent', 'agent-model');
    const target = resolveInsightTarget(pg, [agentProvider], DEFAULT_LLM_SETTINGS);
    expect(target?.provider.id).toBe('p-agent');
    expect(target?.model).toBe('agent-model');
    // Floors the borrowed agent's short 1000-token budget.
    expect(target?.maxOutputTokens).toBe(2048);
  });

  it('uses the configured settings provider/model when valid', () => {
    const pg = playgroundWithAgent('p-agent', 'agent-model');
    const target = resolveInsightTarget(pg, [agentProvider, insightProvider], {
      ...DEFAULT_LLM_SETTINGS,
      insightProviderId: 'p-insight',
      insightModel: 'insight-model',
    });
    expect(target?.provider.id).toBe('p-insight');
    expect(target?.model).toBe('insight-model');
  });

  it('falls back to the agent when the settings provider is disabled', () => {
    const pg = playgroundWithAgent('p-agent', 'agent-model');
    const disabled: Provider = { ...insightProvider, enabled: false };
    const target = resolveInsightTarget(pg, [agentProvider, disabled], {
      ...DEFAULT_LLM_SETTINGS,
      insightProviderId: 'p-insight',
      insightModel: 'insight-model',
    });
    expect(target?.provider.id).toBe('p-agent');
  });

  it('falls back to the agent when the settings model is blank', () => {
    const pg = playgroundWithAgent('p-agent', 'agent-model');
    const target = resolveInsightTarget(pg, [agentProvider, insightProvider], {
      ...DEFAULT_LLM_SETTINGS,
      insightProviderId: 'p-insight',
      insightModel: '   ',
    });
    expect(target?.provider.id).toBe('p-agent');
  });

  it('returns null when nothing usable is configured', () => {
    const pg = playgroundWithAgent('', '');
    expect(resolveInsightTarget(pg, [], DEFAULT_LLM_SETTINGS)).toBeNull();
  });
});
