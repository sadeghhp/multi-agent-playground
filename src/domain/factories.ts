import {
  type Agent,
  type Characteristics,
  type ConversationSettings,
  type LibrarySkill,
  type LlmConfig,
  type Playground,
  type Provider,
  type RuntimeConfig,
  type SavedAgent,
  type UiLayoutState,
  SCHEMA_VERSION,
} from './schema';
import {
  newAgentId,
  newLibraryAgentId,
  newPlaygroundId,
  newProviderId,
  newSkillId,
} from './ids';
import { evidenceRoleInstruction } from './conduct';

const now = () => Date.now();

export function defaultCharacteristics(): Characteristics {
  return {
    tone: 'neutral',
    verbosity: 50,
    creativity: 50,
    assertiveness: 50,
    skepticism: 50,
    cooperation: 50,
  };
}

export function defaultLlmConfig(): LlmConfig {
  return {
    providerId: null,
    model: '',
    temperature: 0.7,
    maxOutputTokens: 1024,
  };
}

export function defaultRuntimeConfig(): RuntimeConfig {
  return {
    enabled: true,
    maxResponsesPerRun: 3,
    responseTimeoutMs: 60_000,
    includeHistory: true,
    historyWindow: 10,
  };
}

export function defaultConversationSettings(): ConversationSettings {
  return {
    subject: '',
    objective: '',
    initialContext: '',
    startingAgentId: null,
    maxTotalTurns: 12,
    maxResponsesPerAgent: 3,
    responseTimeoutMs: 60_000,
    stopOnError: true,
    toneOverride: '',
    responseLength: 'agent-default',
  };
}

export function defaultUiLayout(): UiLayoutState {
  return { bottomPanelCollapsed: false, bottomPanelHeight: 260 };
}

/** Base agent with all defaults; callers override the required fields (spec §9.1). */
export function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: newAgentId(),
    name: 'New Agent',
    description: '',
    role: '',
    systemInstruction: '',
    language: 'en',
    characteristics: defaultCharacteristics(),
    skills: [],
    llm: defaultLlmConfig(),
    runtime: defaultRuntimeConfig(),
    position: { x: 0, y: 0 },
    colorCategory: 'blue',
    ...overrides,
  };
}

/** "Analyst" -> "Analyst (copy)" -> "Analyst (copy 2)" -> "Analyst (copy 3)" ...
 * instead of blindly appending, which would cascade into "X (copy) (copy) (copy)". */
function nextCopyName(name: string): string {
  const match = name.match(/^(.*) \(copy(?: (\d+))?\)$/);
  if (!match) return `${name} (copy)`;
  const [, base, num] = match;
  const next = num ? parseInt(num, 10) + 1 : 2;
  return `${base} (copy ${next})`;
}

/**
 * Duplicate an agent (spec §9.3): copy everything except id, position, runtime
 * state, and transcript references. Skills get fresh ids so edits don't alias.
 * Nested config objects are cloned too — not just skills — so editing the copy
 * (or the original) can never mutate the other's shared reference.
 */
export function duplicateAgent(agent: Agent): Agent {
  return {
    ...agent,
    id: newAgentId(),
    name: nextCopyName(agent.name),
    position: { x: agent.position.x + 48, y: agent.position.y + 48 },
    characteristics: { ...agent.characteristics },
    llm: { ...agent.llm },
    runtime: { ...agent.runtime },
    skills: agent.skills.map((s) => ({ ...s, id: newSkillId() })),
  };
}

/**
 * Snapshot an agent into a library ("pool") record. Copies the agent config
 * verbatim — including its current llm.providerId, which may dangle when the
 * agent is later re-added to a different playground (validateForRun surfaces
 * that, no crash). Carries only the agent, never a provider or API key.
 */
export function createSavedAgent(agent: Agent): SavedAgent {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newLibraryAgentId(),
    name: agent.name,
    savedAt: now(),
    agent,
  };
}

/**
 * Instantiate a fresh playground agent from a library record (spec §9.1/§9.3).
 * Unlike duplicateAgent this keeps the name unchanged (no "(copy)" suffix) and
 * takes a caller-supplied position. Fresh agent + skill ids so edits to the new
 * node never alias the stored template or another instance.
 */
export function instantiateFromLibrary(
  saved: SavedAgent,
  position: Agent['position'] = { x: 0, y: 0 },
): Agent {
  return {
    ...saved.agent,
    id: newAgentId(),
    position,
    // Cloned, not shared — this instance and the stored library template (or
    // any other instance created from it) must never alias the same object.
    characteristics: { ...saved.agent.characteristics },
    llm: { ...saved.agent.llm },
    runtime: { ...saved.agent.runtime },
    skills: saved.agent.skills.map((s) => ({ ...s, id: newSkillId() })),
  };
}

export function createProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: newProviderId(),
    displayName: 'New Provider',
    baseUrl: '',
    path: '/v1/chat/completions',
    authMethod: 'bearer',
    authHeaderName: 'Authorization',
    // Empty: buildProviderHeaders supplies the "Bearer" scheme for bearer auth and
    // sends the raw key for custom-header auth. Set only for a non-standard prefix.
    authPrefix: '',
    credentialStorage: 'session',
    requestFormat: 'openai-chat',
    responseFormat: 'openai-chat',
    defaultModel: '',
    models: [],
    customHeaders: {},
    timeoutMs: 60_000,
    bypassDevProxy: false,
    enabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Skill library (spec §7.2 "Skills"). Declared capabilities, NOT executable
// tools — the presets below are the spec's example capabilities. The picker in
// the agent editor always offers these, even when a playground's stored
// skillLibrary is empty (e.g. pre-existing playgrounds).
// ---------------------------------------------------------------------------

export const SKILL_PRESETS: Omit<LibrarySkill, 'id'>[] = [
  { name: 'analysis', description: 'Structured analysis', instruction: 'Decompose the problem into parts and reason from evidence, weighing trade-offs explicitly.' },
  { name: 'brainstorming', description: 'Idea generation', instruction: 'Enumerate relevant angles, options, and open questions before converging.' },
  { name: 'summarization', description: 'Concise synthesis', instruction: 'Produce a concise, faithful summary that preserves the key points.' },
  { name: 'critique', description: 'Critical review', instruction: 'Challenge unsupported claims and identify factual weaknesses and logical gaps.' },
  { name: 'prioritization', description: 'Ranking by impact', instruction: 'Rank items by impact and effort, and justify the ordering.' },
  { name: 'technical design', description: 'Design reasoning', instruction: 'Consider constraints, alternatives, and trade-offs before proposing a design.' },
  { name: 'risk analysis', description: 'Risk assessment', instruction: 'Surface failure modes, their likelihood, and mitigations.' },
];

export function createLibrarySkill(overrides: Partial<LibrarySkill> = {}): LibrarySkill {
  return {
    id: newSkillId(),
    name: 'new skill',
    description: '',
    instruction: '',
    ...overrides,
  };
}

/** Seed a fresh playground's catalog from the built-in presets (spec §7.2). */
export function defaultSkillLibrary(): LibrarySkill[] {
  return SKILL_PRESETS.map((p) => createLibrarySkill(p));
}

/** Look up a skill preset by name so template definitions don't re-type (and drift from) its wording. */
function presetSkill(name: string): Omit<LibrarySkill, 'id'> {
  const preset = SKILL_PRESETS.find((p) => p.name === name);
  if (!preset) throw new Error(`Unknown skill preset: ${name}`);
  return preset;
}

export function createPlayground(name = 'Untitled Playground'): Playground {
  const ts = now();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newPlaygroundId(),
    name,
    description: '',
    createdAt: ts,
    updatedAt: ts,
    agents: [],
    connections: [],
    skillLibrary: defaultSkillLibrary(),
    conversation: defaultConversationSettings(),
    transcript: [],
    ui: defaultUiLayout(),
  };
}

// ---------------------------------------------------------------------------
// Agent templates (spec §6 palette). Initial values only — no runtime behaviour.
// ---------------------------------------------------------------------------

export type TemplateKey =
  | 'blank'
  | 'analyst'
  | 'critic'
  | 'moderator'
  | 'researcher'
  | 'summarizer'
  // Evidence-pipeline roles (opt-in): narrow, structured, non-conversational.
  | 'proposer'
  | 'verifier'
  | 'comparator'
  | 'finalizer';

interface TemplateDef {
  label: string;
  role: string;
  systemInstruction: string;
  characteristics: Partial<Characteristics>;
  color: Agent['colorCategory'];
  skills: { name: string; description: string; instruction: string }[];
}

const TEMPLATES: Record<TemplateKey, TemplateDef> = {
  blank: {
    label: 'Blank agent',
    role: '',
    systemInstruction: '',
    characteristics: {},
    color: 'slate',
    skills: [],
  },
  analyst: {
    label: 'Analyst',
    role: 'Analyst',
    systemInstruction:
      'Analyze the topic methodically. Break problems into parts and reason from evidence. Distinguish established facts from assumptions and inferences; state explicitly when evidence is insufficient rather than guessing.',
    characteristics: { assertiveness: 60, skepticism: 60, creativity: 40 },
    color: 'blue',
    skills: [presetSkill('analysis')],
  },
  critic: {
    label: 'Critic',
    role: 'Skeptical reviewer',
    systemInstruction:
      'Critically evaluate the previous responses. Challenge unsupported claims and identify weaknesses. Ground every objection in the text itself or in missing evidence — do not invent flaws. State each defect directly, without praise, hedging, or agreement.',
    characteristics: { skepticism: 85, assertiveness: 70, cooperation: 35 },
    color: 'red',
    skills: [presetSkill('critique')],
  },
  moderator: {
    label: 'Moderator',
    role: 'Moderator',
    systemInstruction:
      'Synthesize the discussion, resolve disagreements fairly, and produce a balanced conclusion. Base the conclusion only on claims actually made in the discussion — do not introduce new arguments. State plainly any disagreement that remains unresolved instead of glossing over it.',
    characteristics: { cooperation: 80, tone: 'balanced', assertiveness: 50 },
    color: 'green',
    skills: [presetSkill('summarization')],
  },
  researcher: {
    label: 'Researcher',
    role: 'Researcher',
    systemInstruction:
      'Gather relevant considerations and surface the most important facts and open questions. Mark uncertain or unverified points explicitly rather than presenting them as settled. Do not pad the list with restated or redundant considerations.',
    characteristics: { creativity: 60, verbosity: 60, skepticism: 50 },
    color: 'teal',
    skills: [presetSkill('brainstorming')],
  },
  summarizer: {
    label: 'Summarizer',
    role: 'Summarizer',
    systemInstruction:
      'Produce a concise, faithful summary of the conversation so far. Include only what was actually said — no added opinions, embellishment, or filler. Omit anything not present in the conversation rather than inferring it.',
    characteristics: { verbosity: 25, tone: 'concise' },
    color: 'violet',
    skills: [presetSkill('summarization')],
  },
  // Evidence-pipeline roles. Each carries a narrow protocol plus the shared
  // anti-filler conduct (src/domain/conduct.ts). Low verbosity reinforces
  // conciseness; the instruction text does the structural work.
  proposer: {
    label: 'Proposer',
    role: 'Candidate generator',
    systemInstruction: evidenceRoleInstruction('proposer'),
    characteristics: { verbosity: 30, assertiveness: 55, cooperation: 40 },
    color: 'blue',
    skills: [],
  },
  verifier: {
    label: 'Verifier',
    role: 'Claim verifier',
    systemInstruction: evidenceRoleInstruction('verifier'),
    characteristics: { verbosity: 30, skepticism: 80, cooperation: 40 },
    color: 'teal',
    skills: [],
  },
  comparator: {
    label: 'Comparator',
    role: 'Candidate judge',
    systemInstruction: evidenceRoleInstruction('comparator'),
    characteristics: { verbosity: 30, assertiveness: 60, cooperation: 40 },
    color: 'amber',
    skills: [],
  },
  finalizer: {
    label: 'Finalizer',
    role: 'Final answer synthesizer',
    systemInstruction: evidenceRoleInstruction('finalizer'),
    characteristics: { verbosity: 30, tone: 'concise', assertiveness: 55 },
    color: 'green',
    skills: [],
  },
};

export function templateList(): { key: TemplateKey; label: string }[] {
  return (Object.keys(TEMPLATES) as TemplateKey[]).map((key) => ({
    key,
    label: TEMPLATES[key].label,
  }));
}

/** Instantiate an agent from a template (spec §6, §9.1). */
export function createAgentFromTemplate(
  key: TemplateKey,
  overrides: Partial<Agent> = {},
): Agent {
  const t = TEMPLATES[key];
  return createAgent({
    name: t.label,
    role: t.role,
    systemInstruction: t.systemInstruction,
    colorCategory: t.color,
    characteristics: { ...defaultCharacteristics(), ...t.characteristics },
    skills: t.skills.map((s) => ({
      id: newSkillId(),
      name: s.name,
      description: s.description,
      instruction: s.instruction,
      enabled: true,
    })),
    ...overrides,
  });
}
