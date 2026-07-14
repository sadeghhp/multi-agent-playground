import { z } from 'zod';

/**
 * Versioned domain schema for the whole playground (spec §7, §15.3).
 * SCHEMA_VERSION is stamped into every persisted/exported playground so future
 * releases can migrate old files (spec §7.1 "the persisted format must include a
 * schema version"). Bump it whenever a breaking shape change lands and add a
 * migration in persistence/migrate.ts.
 */
export const SCHEMA_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// Enums / small value types
// ---------------------------------------------------------------------------

export const RuntimeState = z.enum([
  'idle',
  'queued',
  'generating',
  'completed',
  'failed',
  'disabled',
]);
export type RuntimeState = z.infer<typeof RuntimeState>;

export const ConnectionType = z.enum(['conversation', 'review', 'handoff']);
export type ConnectionType = z.infer<typeof ConnectionType>;

/** Language an agent asks and answers in (spec: per-agent conversation language). */
export const AgentLanguage = z.enum(['en', 'fa', 'fr']);
export type AgentLanguage = z.infer<typeof AgentLanguage>;

export const AuthMethod = z.enum(['none', 'bearer', 'custom-header']);
export type AuthMethod = z.infer<typeof AuthMethod>;

/** Where a provider's API key lives (spec §8.4). Session is the default. */
export const CredentialStorage = z.enum(['session', 'local']);
export type CredentialStorage = z.infer<typeof CredentialStorage>;

export const ColorCategory = z.enum([
  'slate',
  'blue',
  'green',
  'amber',
  'red',
  'violet',
  'teal',
]);
export type ColorCategory = z.infer<typeof ColorCategory>;

// ---------------------------------------------------------------------------
// Characteristics (spec §7.2) — structured behavioural values, 0..100 scales
// plus a free tone label. Converted to an instruction fragment at prompt time.
// ---------------------------------------------------------------------------

export const Characteristics = z.object({
  tone: z.string().default('neutral'),
  verbosity: z.number().min(0).max(100).default(50),
  creativity: z.number().min(0).max(100).default(50),
  assertiveness: z.number().min(0).max(100).default(50),
  skepticism: z.number().min(0).max(100).default(50),
  cooperation: z.number().min(0).max(100).default(50),
});
export type Characteristics = z.infer<typeof Characteristics>;

// ---------------------------------------------------------------------------
// Skill (spec §7.2) — declared capability, NOT an executable tool.
// ---------------------------------------------------------------------------

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  instruction: z.string().default(''),
  enabled: z.boolean().default(true),
});
export type Skill = z.infer<typeof Skill>;

// ---------------------------------------------------------------------------
// LLM + runtime config (spec §7.2)
// ---------------------------------------------------------------------------

export const LlmConfig = z.object({
  providerId: z.string().nullable().default(null),
  model: z.string().default(''),
  temperature: z.number().min(0).max(2).default(0.7),
  maxOutputTokens: z.number().int().positive().default(1024),
  topP: z.number().min(0).max(1).optional(),
  seed: z.number().int().optional(),
  stopSequences: z.array(z.string()).optional(),
});
export type LlmConfig = z.infer<typeof LlmConfig>;

export const RuntimeConfig = z.object({
  enabled: z.boolean().default(true),
  maxResponsesPerRun: z.number().int().positive().default(3),
  responseTimeoutMs: z.number().int().positive().default(60_000),
  includeHistory: z.boolean().default(true),
  historyWindow: z.number().int().positive().default(10),
  openingInstruction: z.string().optional(),
  finalResponseInstruction: z.string().optional(),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfig>;

// ---------------------------------------------------------------------------
// Agent (spec §7.2). Domain layer only — visual position lives here but the
// graph library never reads this object directly (spec §5).
// ---------------------------------------------------------------------------

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  icon: z.string().optional(),
  role: z.string().default(''),
  systemInstruction: z.string().default(''),
  // Per-agent conversation language. Defaults to English so existing v1
  // playgrounds without the field parse cleanly (no migration needed).
  language: AgentLanguage.default('en'),
  characteristics: Characteristics,
  skills: z.array(Skill).default([]),
  llm: LlmConfig,
  runtime: RuntimeConfig,
  // Visual state (spec §7.2 "Visual state"). Position is the source of truth
  // that the graph adapter projects into React Flow nodes.
  position: z.object({ x: z.number(), y: z.number() }),
  colorCategory: ColorCategory.default('blue'),
});
export type Agent = z.infer<typeof Agent>;

// ---------------------------------------------------------------------------
// Connection (spec §7.3) — directed edge between two agents.
// ---------------------------------------------------------------------------

export const Connection = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  enabled: z.boolean().default(true),
  type: ConnectionType.default('conversation'),
  label: z.string().optional(),
  priority: z.number().int().default(0),
  instructionOverride: z.string().optional(),
});
export type Connection = z.infer<typeof Connection>;

// ---------------------------------------------------------------------------
// Provider (spec §7.4). API key is intentionally optional and is stripped on
// export (spec §15.3, §21). requestFormat is fixed to OpenAI-compatible for MVP.
// ---------------------------------------------------------------------------

export const Provider = z.object({
  id: z.string(),
  displayName: z.string(),
  baseUrl: z.string(),
  path: z.string().default('/v1/chat/completions'),
  authMethod: AuthMethod.default('bearer'),
  authHeaderName: z.string().default('Authorization'),
  authPrefix: z.string().default('Bearer'),
  /** Not persisted in exports. Present in memory / session / local per storage mode. */
  apiKey: z.string().optional(),
  credentialStorage: CredentialStorage.default('session'),
  requestFormat: z.literal('openai-chat').default('openai-chat'),
  responseFormat: z.literal('openai-chat').default('openai-chat'),
  defaultModel: z.string().default(''),
  models: z.array(z.string()).default([]),
  customHeaders: z.record(z.string(), z.string()).default({}),
  timeoutMs: z.number().int().positive().default(60_000),
  enabled: z.boolean().default(true),
});
export type Provider = z.infer<typeof Provider>;

// ---------------------------------------------------------------------------
// Transcript (spec §13.1)
// ---------------------------------------------------------------------------

export const TranscriptMessage = z.object({
  id: z.string(),
  turn: z.number().int(),
  agentId: z.string().nullable(),
  /** Snapshot of identity so the transcript survives agent deletion (spec §9.4). */
  agentName: z.string(),
  agentDeleted: z.boolean().default(false),
  role: z.string().default(''),
  model: z.string().default(''),
  providerId: z.string().nullable().default(null),
  content: z.string().default(''),
  status: z.enum(['completed', 'failed', 'stopped']).default('completed'),
  sourceAgentId: z.string().nullable().default(null),
  connectionType: ConnectionType.nullable().default(null),
  timestamp: z.number().int(),
  durationMs: z.number().optional(),
  promptTokens: z.number().optional(),
  completionTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  error: z.string().optional(),
});
export type TranscriptMessage = z.infer<typeof TranscriptMessage>;

// ---------------------------------------------------------------------------
// Conversation settings (spec §11.1, §11.4 defaults)
// ---------------------------------------------------------------------------

export const ConversationSettings = z.object({
  subject: z.string().default(''),
  objective: z.string().default(''),
  initialContext: z.string().default(''),
  startingAgentId: z.string().nullable().default(null),
  maxTotalTurns: z.number().int().positive().default(12),
  maxResponsesPerAgent: z.number().int().positive().default(3),
  responseTimeoutMs: z.number().int().positive().default(60_000),
  stopOnError: z.boolean().default(true),
});
export type ConversationSettings = z.infer<typeof ConversationSettings>;

// ---------------------------------------------------------------------------
// UI layout state persisted with the playground (spec §7.1)
// ---------------------------------------------------------------------------

export const UiLayoutState = z.object({
  bottomPanelCollapsed: z.boolean().default(false),
  bottomPanelHeight: z.number().default(260),
});
export type UiLayoutState = z.infer<typeof UiLayoutState>;

// ---------------------------------------------------------------------------
// Playground (spec §7.1) — the complete saved workspace.
// ---------------------------------------------------------------------------

export const Playground = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  agents: z.array(Agent).default([]),
  connections: z.array(Connection).default([]),
  providers: z.array(Provider).default([]),
  conversation: ConversationSettings,
  transcript: z.array(TranscriptMessage).default([]),
  ui: UiLayoutState,
});
export type Playground = z.infer<typeof Playground>;

/**
 * Export shape: identical to Playground but API keys are guaranteed absent
 * (spec §15.3, §21). We validate exported/imported files against this.
 */
export const ProviderExport = Provider.omit({ apiKey: true });
export const PlaygroundExport = Playground.extend({
  providers: z.array(ProviderExport).default([]),
});
export type PlaygroundExport = z.infer<typeof PlaygroundExport>;
