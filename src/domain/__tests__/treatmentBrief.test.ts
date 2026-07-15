import { describe, expect, it } from 'vitest';
import { createTreatmentBriefPlayground } from '../samples/treatmentBrief';

describe('createTreatmentBriefPlayground', () => {
  it('seeds a multi-stakeholder health brief with educational caveats', () => {
    const { playground, provider } = createTreatmentBriefPlayground();
    expect(playground.agents.map((a) => a.name)).toEqual([
      'Clinician',
      'Researcher',
      'Patient advocate',
      'Moderator',
    ]);

    const start = playground.agents.find((a) => a.id === playground.conversation.startingAgentId);
    expect(start?.name).toBe('Clinician');
    expect(playground.conversation.subject).toMatch(/Type 2 diabetes/i);
    expect(playground.conversation.objective).toMatch(/not medical advice/i);
    expect(playground.description).toMatch(/not medical advice/i);

    for (const a of playground.agents) {
      expect(a.llm.providerId).toBe(provider.id);
    }

    const byId = new Map(playground.agents.map((a) => [a.id, a.name]));
    const edges = playground.connections.map(
      (c) => `${byId.get(c.source)}-${c.type}->${byId.get(c.target)}`,
    );
    expect(edges).toEqual([
      'Clinician-conversation->Researcher',
      'Clinician-conversation->Patient advocate',
      'Researcher-handoff->Moderator',
      'Patient advocate-handoff->Moderator',
    ]);
  });
});
