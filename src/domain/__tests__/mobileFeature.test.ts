import { describe, expect, it } from 'vitest';
import { createMobileFeaturePlayground } from '../samples/mobileFeature';

describe('createMobileFeaturePlayground', () => {
  it('seeds PM → Engineer → QA → Ship Lead with a product subject', () => {
    const { playground, provider } = createMobileFeaturePlayground();
    expect(playground.agents.map((a) => a.name)).toEqual([
      'Product Manager',
      'Mobile Engineer',
      'Release QA',
      'Ship Lead',
    ]);

    const start = playground.agents.find((a) => a.id === playground.conversation.startingAgentId);
    expect(start?.name).toBe('Product Manager');
    expect(playground.conversation.subject).toMatch(/offline workout tracking/i);
    expect(playground.conversation.objective).toMatch(/phased implementation/i);

    for (const a of playground.agents) {
      expect(a.llm.providerId).toBe(provider.id);
    }

    const byId = new Map(playground.agents.map((a) => [a.id, a.name]));
    const edges = playground.connections.map(
      (c) => `${byId.get(c.source)}-${c.type}->${byId.get(c.target)}`,
    );
    expect(edges).toEqual([
      'Product Manager-conversation->Mobile Engineer',
      'Mobile Engineer-review->Release QA',
      'Release QA-handoff->Ship Lead',
      'Product Manager-handoff->Ship Lead',
    ]);
  });
});
