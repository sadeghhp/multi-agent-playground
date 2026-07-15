import type { Playground, Provider } from '../schema';
import { createExamplePlayground } from '../example';
import { createEvidencePipelinePlayground } from '../evidencePipeline';
import { createMobileFeaturePlayground } from './mobileFeature';
import { createClimateClaimPlayground } from './climateClaim';
import { createTreatmentBriefPlayground } from './treatmentBrief';
import { createContractReviewPlayground } from './contractReview';

export type SampleDomain = 'Product' | 'Engineering' | 'Science & Nature' | 'Health' | 'Law';

export interface PlaygroundSample {
  id: string;
  name: string;
  description: string;
  domain: SampleDomain;
  build: () => { playground: Playground; provider: Provider };
}

/** Curated sample playgrounds for learning how multi-agent graphs work. */
export const PLAYGROUND_SAMPLES: PlaygroundSample[] = [
  {
    id: 'mobile-feature',
    name: 'Ship a mobile feature',
    description:
      'PM → Engineer → QA → Ship Lead plan an offline workout-tracking feature. Learn role handoffs for a product decision.',
    domain: 'Product',
    build: createMobileFeaturePlayground,
  },
  {
    id: 'open-source-decision',
    name: 'Open-source decision',
    description:
      'Strategist → Critic → Moderator evaluate releasing an internal framework as open source. Classic three-agent critique loop.',
    domain: 'Product',
    build: createExamplePlayground,
  },
  {
    id: 'evidence-pipeline',
    name: 'Evidence pipeline',
    description:
      'Proposer → Critic/Verifier → Finalizer. See how verification stays separate from generation.',
    domain: 'Engineering',
    build: createEvidencePipelinePlayground,
  },
  {
    id: 'climate-claim',
    name: 'Climate claim check',
    description:
      'Researcher → Critic → Summarizer assess a climate science claim. Practice separating evidence from uncertainty.',
    domain: 'Science & Nature',
    build: createClimateClaimPlayground,
  },
  {
    id: 'treatment-brief',
    name: 'Treatment options brief',
    description:
      'Clinician, Researcher, Patient advocate, and Moderator outline options for a common condition. Educational only — not medical advice.',
    domain: 'Health',
    build: createTreatmentBriefPlayground,
  },
  {
    id: 'contract-review',
    name: 'Contract risk review',
    description:
      'Analyst → Critic → Moderator review B2B SaaS liability clauses. Educational only — not legal advice.',
    domain: 'Law',
    build: createContractReviewPlayground,
  },
];

/** Domain display order for the sample catalog UI. */
export const SAMPLE_DOMAIN_ORDER: SampleDomain[] = [
  'Product',
  'Engineering',
  'Science & Nature',
  'Health',
  'Law',
];

export function getPlaygroundSample(id: string): PlaygroundSample | undefined {
  return PLAYGROUND_SAMPLES.find((s) => s.id === id);
}
