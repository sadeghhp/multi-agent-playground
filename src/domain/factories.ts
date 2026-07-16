import {
  type Agent,
  type Characteristics,
  type ConversationSettings,
  type LibrarySkill,
  type LlmConfig,
  type Playground,
  type Provider,
  type RunPreset,
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
  newRunPresetId,
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
    maxOutputTokens: 8192,
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
    stopOnError: true,
    conversationMode: 'open',
    toneOverride: '',
    responseLength: 'agent-default',
    chitchatPolicy: 'agent-default',
    languageOverride: 'agent-default',
    temperatureOverride: null,
    responseTimeoutOverrideMs: null,
  };
}

/** Snapshot the reusable run *options* portion of a conversation (excludes subject/objective/initialContext/startingAgentId) into a named preset. */
export function createRunPreset(name: string, conversation: ConversationSettings): RunPreset {
  const { subject: _subject, objective: _objective, initialContext: _initialContext, startingAgentId: _startingAgentId, ...settings } = conversation;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: newRunPresetId(),
    name,
    savedAt: now(),
    settings,
  };
}

/** Apply a preset's options on top of a conversation, keeping its subject/objective/initialContext/startingAgentId untouched. */
export function applyRunPreset(conversation: ConversationSettings, preset: RunPreset): ConversationSettings {
  return { ...conversation, ...preset.settings };
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
    personaMode: 'role',
    kind: 'participant',
    characteristics: defaultCharacteristics(),
    skills: [],
    tools: [],
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
    // Deep-clone every nested object/array so the copy and original never alias.
    persona: agent.persona ? { ...agent.persona } : undefined,
    llm: cloneLlmConfig(agent.llm),
    runtime: { ...agent.runtime },
    skills: agent.skills.map((s) => ({ ...s, id: newSkillId() })),
    tools: [...agent.tools],
  };
}

/** Clone an LlmConfig including its optional array field so edits never alias. */
function cloneLlmConfig(llm: LlmConfig): LlmConfig {
  return { ...llm, ...(llm.stopSequences ? { stopSequences: [...llm.stopSequences] } : {}) };
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
    persona: saved.agent.persona ? { ...saved.agent.persona } : undefined,
    llm: cloneLlmConfig(saved.agent.llm),
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
  | 'digital-shadow'
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
  /** Embedded executable tool ids (src/tools/registry.ts) enabled by default. */
  tools?: string[];
  personaMode?: Agent['personaMode'];
  persona?: Agent['persona'];
  /** Lifecycle kind; omitted templates default to 'participant'. */
  kind?: Agent['kind'];
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
      'Analyze methodically. Break the question into parts; for each, separate established fact, assumption, and inference, and label them as such. Quantify wherever possible — give numbers, ranges, or orders of magnitude instead of "large" or "small" — and state your confidence (high/medium/low) with the reason for it. When evidence is insufficient, name precisely what data is missing rather than guessing. Do not restate other agents\' points except to build on or dispute them.',
    characteristics: { assertiveness: 60, skepticism: 60, creativity: 40 },
    color: 'blue',
    skills: [presetSkill('analysis')],
    tools: ['calculator'],
  },
  critic: {
    label: 'Critic',
    role: 'Skeptical reviewer',
    systemInstruction:
      'You are the designated critic. In every reply: (1) identify the strongest claim in the message you are responding to and challenge it first, naming the agent and quoting the claim; (2) state exactly why it fails — missing evidence, logical gap, internal contradiction, or unstated assumption; (3) end with the single question or piece of evidence that would most change your assessment. Never open with praise or agreement, and raise no objection you cannot ground in the text itself or in missing evidence. If a claim survives your scrutiny, say so in one sentence and move to the next-strongest.',
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
    kind: 'moderator',
  },
  researcher: {
    label: 'Researcher',
    role: 'Researcher',
    systemInstruction:
      'You are the researcher: you bring verifiable facts into the discussion, not opinions. Each turn, contribute the 2–4 facts that most change the discussion; for each, state the fact, its source, and your confidence in it. Mark anything unverified explicitly as unverified rather than presenting it as settled. When another agent states something factually wrong, correct it, naming the agent and the error. Do not pad with restated considerations or speculation. Before asserting a checkable fact, verify it with your tools when they are available and cite the returned title and URL/DOI next to the claim.',
    characteristics: { creativity: 60, verbosity: 60, skepticism: 50 },
    color: 'teal',
    skills: [presetSkill('brainstorming')],
    tools: ['wikipedia_search', 'wikipedia_page', 'crossref_search', 'web_search'],
  },
  summarizer: {
    label: 'Summarizer',
    role: 'Summarizer',
    systemInstruction:
      'Produce a concise, faithful summary of the conversation so far. Include only what was actually said — no added opinions, embellishment, or filler. Omit anything not present in the conversation rather than inferring it.',
    characteristics: { verbosity: 25, tone: 'concise' },
    color: 'violet',
    skills: [presetSkill('summarization')],
    kind: 'summarizer',
  },
  'digital-shadow': {
    label: 'Digital shadow',
    role: 'Digital shadow',
    systemInstruction:
      'Speak in first person as the real person named in your persona settings. Defend and elaborate their publicly known positions. When citing their work, do so in first person (e.g. "In [title] I argued that…"). Do not invent quotes or private beliefs; say when you are unsure. Never describe yourself in third person or as their advocate/explainer.',
    characteristics: { assertiveness: 65, creativity: 45, skepticism: 55, tone: 'in-character' },
    color: 'violet',
    skills: [],
    personaMode: 'digital-shadow',
    persona: {
      realName: '',
      knownFor: '',
      stanceNotes:
        'Fill in the real person\'s name above, then list 3–6 core public positions or theses here so replies stay grounded.',
      citationStyle: 'in-character',
    },
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
    kind: 'finalizer',
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
    ...(t.tools ? { tools: [...t.tools] } : {}),
    ...(t.personaMode ? { personaMode: t.personaMode } : {}),
    ...(t.persona ? { persona: { ...t.persona } } : {}),
    ...(t.kind ? { kind: t.kind } : {}),
    ...overrides,
  });
}
