import { describe, expect, it } from 'vitest';
import { createClimateClaimPlayground } from '../samples/climateClaim';

describe('createClimateClaimPlayground', () => {
  it('seeds Researcher → Critic → Summarizer on a climate subject', () => {
    const { playground, provider } = createClimateClaimPlayground();
    expect(playground.agents.map((a) => a.name)).toEqual([
      'Researcher',
      'Critic',
      'Summarizer',
    ]);

    const start = playground.agents.find((a) => a.id === playground.conversation.startingAgentId);
    expect(start?.name).toBe('Researcher');
    expect(playground.conversation.subject).toMatch(/hurricane intensity/i);
    expect(playground.conversation.objective).toMatch(/established findings/i);

    for (const a of playground.agents) {
      expect(a.llm.providerId).toBe(provider.id);
    }

    const byId = new Map(playground.agents.map((a) => [a.id, a.name]));
    const edges = playground.connections.map(
      (c) => `${byId.get(c.source)}-${c.type}->${byId.get(c.target)}`,
    );
    expect(edges).toEqual([
      'Researcher-conversation->Critic',
      'Critic-review->Summarizer',
    ]);
  });
});
