import {
  type Agent,
  type Characteristics,
  type ConversationSettings,
  type LlmConfig,
  type Playground,
  type Provider,
  type RuntimeConfig,
  type UiLayoutState,
  SCHEMA_VERSION,
} from './schema';
import {
  newAgentId,
  newPlaygroundId,
  newProviderId,
  newSkillId,
} from './ids';

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
    characteristics: defaultCharacteristics(),
    skills: [],
    llm: defaultLlmConfig(),
    runtime: defaultRuntimeConfig(),
    position: { x: 0, y: 0 },
    colorCategory: 'blue',
    ...overrides,
  };
}

/**
 * Duplicate an agent (spec §9.3): copy everything except id, position, runtime
 * state, and transcript references. Skills get fresh ids so edits don't alias.
 */
export function duplicateAgent(agent: Agent): Agent {
  return {
    ...agent,
    id: newAgentId(),
    name: `${agent.name} (copy)`,
    position: { x: agent.position.x + 48, y: agent.position.y + 48 },
    skills: agent.skills.map((s) => ({ ...s, id: newSkillId() })),
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
    enabled: true,
    ...overrides,
  };
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
  | 'summarizer';

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
      'Analyze the topic methodically. Break problems into parts and reason from evidence.',
    characteristics: { assertiveness: 60, skepticism: 60, creativity: 40 },
    color: 'blue',
    skills: [
      { name: 'analysis', description: 'Structured analysis', instruction: 'Decompose the problem and weigh trade-offs explicitly.' },
    ],
  },
  critic: {
    label: 'Critic',
    role: 'Skeptical reviewer',
    systemInstruction:
      'Critically evaluate the previous responses. Challenge unsupported claims and identify weaknesses.',
    characteristics: { skepticism: 85, assertiveness: 70, cooperation: 35 },
    color: 'red',
    skills: [
      { name: 'critique', description: 'Critical review', instruction: 'Focus on factual weaknesses and logical gaps.' },
    ],
  },
  moderator: {
    label: 'Moderator',
    role: 'Moderator',
    systemInstruction:
      'Synthesize the discussion, resolve disagreements fairly, and produce a balanced conclusion.',
    characteristics: { cooperation: 80, tone: 'balanced', assertiveness: 50 } as Partial<Characteristics>,
    color: 'green',
    skills: [
      { name: 'summarization', description: 'Synthesis', instruction: 'Fairly summarize each viewpoint before concluding.' },
    ],
  },
  researcher: {
    label: 'Researcher',
    role: 'Researcher',
    systemInstruction:
      'Gather relevant considerations and surface the most important facts and open questions.',
    characteristics: { creativity: 60, verbosity: 60, skepticism: 50 },
    color: 'teal',
    skills: [
      { name: 'brainstorming', description: 'Idea generation', instruction: 'Enumerate relevant angles and unknowns.' },
    ],
  },
  summarizer: {
    label: 'Summarizer',
    role: 'Summarizer',
    systemInstruction: 'Produce a concise, faithful summary of the conversation so far.',
    characteristics: { verbosity: 25, tone: 'concise' } as Partial<Characteristics>,
    color: 'violet',
    skills: [
      { name: 'summarization', description: 'Summarization', instruction: 'Be concise and preserve key points.' },
    ],
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
