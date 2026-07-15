import { describe, expect, it } from 'vitest';
import { createContractReviewPlayground } from '../samples/contractReview';

describe('createContractReviewPlayground', () => {
  it('seeds Analyst → Critic → Moderator on a contract risk subject', () => {
    const { playground, provider } = createContractReviewPlayground();
    expect(playground.agents.map((a) => a.name)).toEqual([
      'Contract Analyst',
      'Risk Critic',
      'Negotiation Lead',
    ]);

    const start = playground.agents.find((a) => a.id === playground.conversation.startingAgentId);
    expect(start?.name).toBe('Contract Analyst');
    expect(playground.conversation.subject).toMatch(/limitation-of-liability/i);
    expect(playground.conversation.objective).toMatch(/not legal advice/i);
    expect(playground.description).toMatch(/not legal advice/i);

    for (const a of playground.agents) {
      expect(a.llm.providerId).toBe(provider.id);
    }

    const byId = new Map(playground.agents.map((a) => [a.id, a.name]));
    const edges = playground.connections.map(
      (c) => `${byId.get(c.source)}-${c.type}->${byId.get(c.target)}`,
    );
    expect(edges).toEqual([
      'Contract Analyst-conversation->Risk Critic',
      'Risk Critic-review->Negotiation Lead',
    ]);
  });
});
