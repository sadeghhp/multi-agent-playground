import { describe, expect, it } from 'vitest';
import { PLAYGROUND_SAMPLES, getPlaygroundSample, SAMPLE_DOMAIN_ORDER } from '../samples';
import { Playground, Provider } from '../schema';

describe('PLAYGROUND_SAMPLES registry', () => {
  it('has six samples with unique ids', () => {
    expect(PLAYGROUND_SAMPLES).toHaveLength(6);
    const ids = PLAYGROUND_SAMPLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the expected domain catalog ids', () => {
    expect(PLAYGROUND_SAMPLES.map((s) => s.id).sort()).toEqual([
      'climate-claim',
      'contract-review',
      'evidence-pipeline',
      'mobile-feature',
      'open-source-decision',
      'treatment-brief',
    ]);
  });

  it('lists domains in a stable display order', () => {
    expect(SAMPLE_DOMAIN_ORDER).toEqual([
      'Product',
      'Engineering',
      'Science & Nature',
      'Health',
      'Law',
    ]);
  });

  it('getPlaygroundSample resolves known ids and returns undefined for unknown', () => {
    expect(getPlaygroundSample('mobile-feature')?.name).toBe('Ship a mobile feature');
    expect(getPlaygroundSample('nope')).toBeUndefined();
  });

  it('every sample builds a valid playground with agents, connections, and a provider', () => {
    for (const sample of PLAYGROUND_SAMPLES) {
      const { playground, provider } = sample.build();
      expect(Playground.safeParse(playground).success).toBe(true);
      expect(Provider.safeParse(provider).success).toBe(true);
      expect(playground.agents.length).toBeGreaterThanOrEqual(3);
      expect(playground.connections.length).toBeGreaterThanOrEqual(2);
      expect(playground.conversation.subject.length).toBeGreaterThan(0);
      expect(playground.conversation.startingAgentId).toBeTruthy();
      for (const a of playground.agents) {
        expect(a.llm.providerId).toBe(provider.id);
      }
    }
  });
});
