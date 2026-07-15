import { describe, expect, it } from 'vitest';
import { EVIDENCE_CONDUCT, evidenceRoleInstruction } from '../conduct';
import { createAgentFromTemplate } from '../factories';
import { createEvidencePipelinePlayground } from '../evidencePipeline';

describe('evidence conduct fragments', () => {
  it('bans conversational filler and requires epistemic labelling', () => {
    expect(EVIDENCE_CONDUCT).toMatch(/no greetings/i);
    expect(EVIDENCE_CONDUCT).toMatch(/do not guess/i);
    expect(EVIDENCE_CONDUCT).toMatch(/Verified fact/);
    expect(EVIDENCE_CONDUCT).toMatch(/Unknown/);
  });

  it('keeps generation separate from certification', () => {
    // A proposer must not certify; a critic must not rewrite.
    expect(evidenceRoleInstruction('proposer')).toMatch(/do not evaluate, verify, or certify/i);
    expect(evidenceRoleInstruction('critic')).toMatch(/do not certify claims you produced yourself/i);
    expect(evidenceRoleInstruction('finalizer')).toMatch(/verified claims and explicitly stated assumptions only/i);
  });

  it('embeds the conduct into every role template', () => {
    for (const key of ['proposer', 'verifier', 'comparator', 'finalizer'] as const) {
      const agent = createAgentFromTemplate(key);
      expect(agent.systemInstruction).toContain('Operating discipline:');
    }
  });
});

describe('createEvidencePipelinePlayground', () => {
  it('seeds a role-separated proposer/critic/verifier/finalizer graph', () => {
    const { playground, provider } = createEvidencePipelinePlayground();
    const roles = playground.agents.map((a) => a.name);
    expect(roles).toEqual(['Proposer', 'Critic', 'Verifier', 'Finalizer']);

    // Starting agent is the proposer; nothing generates and certifies in one hop.
    const start = playground.agents.find((a) => a.id === playground.conversation.startingAgentId);
    expect(start?.name).toBe('Proposer');

    // Every agent speaks exactly once, and all agents use the returned provider.
    for (const a of playground.agents) {
      expect(a.runtime.maxResponsesPerRun).toBe(1);
      expect(a.llm.providerId).toBe(provider.id);
    }

    // The pipeline critic is the structured protocol, not the casual palette one.
    const critic = playground.agents.find((a) => a.name === 'Critic')!;
    expect(critic.systemInstruction).toContain('Operating discipline:');

    // Topology: Critic and Verifier both review the Proposer, then hand off to
    // the Finalizer — so verification acts on the candidate, not on the critique.
    const byId = new Map(playground.agents.map((a) => [a.id, a.name]));
    const edges = playground.connections.map((c) => `${byId.get(c.source)}-${c.type}->${byId.get(c.target)}`);
    expect(edges).toEqual([
      'Proposer-review->Critic',
      'Proposer-review->Verifier',
      'Critic-handoff->Finalizer',
      'Verifier-handoff->Finalizer',
    ]);
  });
});
