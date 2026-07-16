import { z } from 'zod';

/**
 * Versioned domain schema for the whole playground (spec §7, §15.3).
 * SCHEMA_VERSION is stamped into every persisted/exported playground so future
 * releases can migrate old files (spec §7.1 "the persisted format must include a
 * schema version"). Bump it whenever a breaking shape change lands and add a
 * migration in persistence/migrate.ts.
 */
export const SCHEMA_VERSION = 4 as const;

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

/**
 * Agent lifecycle/scheduling kind (orthogonal to the free-text `role`). Answers
 * *when/whether* an agent runs, not what it says:
 *   - participant: an ordinary agent, scheduled by graph edges (the default).
 *   - moderator:    graph-scheduled like a participant, but always sees the full
 *                   transcript and carries a facilitation contract.
 *   - summarizer / finalizer: engine-scheduled terminal kinds — they never enter
 *                   the normal queue; the orchestrator runs them once, in order,
 *                   in a wrap-up phase after the discussion ends (see
 *                   domain/agentKind.ts, orchestrator.ts).
 * Default is 'participant' so existing v3 playgrounds parse and behave unchanged.
 */
export const AgentKind = z.enum(['participant', 'moderator', 'summarizer', 'finalizer']);
export type AgentKind = z.infer<typeof AgentKind>;

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
  /**
   * Provenance pointer to the skillLibrary entry this skill was copied from
   * (spec §7.2). Optional and non-breaking. Enables the "re-sync from library"
   * action; skills typed by hand or added from a preset carry no libraryId.
   */
  libraryId: z.string().optional(),
});
export type Skill = z.infer<typeof Skill>;

/**
 * Library skill (reusable catalog entry). A Skill template without per-agent
 * state (no `enabled`): attaching one copies name/description/instruction onto
 * an agent as a fresh Skill. Lives on the Playground so it persists and exports.
 */
export const LibrarySkill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(''),
  instruction: z.string().default(''),
});
export type LibrarySkill = z.infer<typeof LibrarySkill>;

// ---------------------------------------------------------------------------
// LLM + runtime config (spec §7.2)
// ---------------------------------------------------------------------------

export const LlmConfig = z.object({
  providerId: z.string().nullable().default(null),
  model: z.string().default(''),
  temperature: z.number().min(0).max(2).default(0.7),
  // No upper bound: providers' context/output limits vary too widely (and change
  // over time) to encode a single safe cap here; the provider API itself rejects
  // out-of-range values.
  maxOutputTokens: z.number().int().positive().default(8192),
  topP: z.number().min(0).max(1).optional(),
  seed: z.number().int().optional(),
  stopSequences: z.array(z.string()).optional(),
});
export type LlmConfig = z.infer<typeof LlmConfig>;

export const RuntimeConfig = z.object({
  enabled: z.boolean().default(true),
  maxResponsesPerRun: z.number().int().positive().default(3),
  // No upper bound: left to the user's judgment, same as maxTotalTurns/
  // maxResponsesPerAgent below — a long-running unattended session is a
  // deliberate choice, not a misconfiguration to guard against.
  responseTimeoutMs: z.number().int().positive().default(60_000),
  includeHistory: z.boolean().default(true),
  historyWindow: z.number().int().positive().default(10),
  openingInstruction: z.string().optional(),
  finalResponseInstruction: z.string().optional(),
});
export type RuntimeConfig = z.infer<typeof RuntimeConfig>;

// ---------------------------------------------------------------------------
// Persona — optional "digital shadow of a real person" identity. Default
// personaMode is 'role' so existing agents parse and behave unchanged.
// ---------------------------------------------------------------------------

export const PersonaMode = z.enum(['role', 'digital-shadow']);
export type PersonaMode = z.infer<typeof PersonaMode>;

export const PersonaCitationStyle = z.enum(['in-character', 'attributed']);
export type PersonaCitationStyle = z.infer<typeof PersonaCitationStyle>;

export const PersonaConfig = z.object({
  /** Display name of the real person being shadowed, e.g. "Thomas Nagel". */
  realName: z.string().default(''),
  /** One-line public summary — what the person is known for. */
  knownFor: z.string().default(''),
  /** User-authored bullets of core public positions for grounding. */
  stanceNotes: z.string().default(''),
  citationStyle: PersonaCitationStyle.default('in-character'),
});
export type PersonaConfig = z.infer<typeof PersonaConfig>;

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
  /**
   * Identity stance. 'role' is a generic specialist; 'digital-shadow' speaks
   * in first person as a simulation of a named real person (see `persona`).
   */
  personaMode: PersonaMode.default('role'),
  /** Present when the agent is (or was configured as) a digital shadow. */
  persona: PersonaConfig.optional(),
  /**
   * Lifecycle/scheduling kind (see AgentKind). Distinct from `role`: `kind`
   * decides when/whether this agent runs (terminal wrap-up vs graph traversal)
   * and its behavioral contract; `role`/`systemInstruction` remain prompt content.
   * Defaults to 'participant' so pre-v4 agents behave exactly as before.
   */
  kind: AgentKind.default('participant'),
  // Nested config is defaulted (not just required) so a stored/imported agent
  // that is missing one of these blocks still loads instead of being silently
  // dropped on read (parseStored). Each sub-schema is itself fully field-
  // defaulted, so `.default({})` reconstructs the standard config.
  characteristics: Characteristics.default({}),
  skills: z.array(Skill).default([]),
  /**
   * Ids of embedded executable tools (src/tools/registry.ts) this agent may
   * invoke mid-turn — distinct from `skills`, which remain prompt-text-only
   * declared capabilities. Unknown ids are ignored at runtime (validate.ts
   * warns). Additive + defaulted, so no SCHEMA_VERSION bump.
   */
  tools: z.array(z.string()).default([]),
  llm: LlmConfig.default({}),
  runtime: RuntimeConfig.default({}),
  // Visual state (spec §7.2 "Visual state"). Position is the source of truth
  // that the graph adapter projects into React Flow nodes.
  position: z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 }),
  colorCategory: ColorCategory.default('blue'),
});
export type Agent = z.infer<typeof Agent>;

// ---------------------------------------------------------------------------
// SavedAgent — an agent stashed in the cross-playground agent library ("pool").
// The user can save any created agent, then re-add it to any playground or
// dispose of it. Stored in its own IndexedDB object store, not inside a
// playground. Carries only the agent config (never a provider / API key).
// ---------------------------------------------------------------------------

export const SavedAgent = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  /** Snapshot of the agent name at save time; shown in the library list. */
  name: z.string(),
  savedAt: z.number().int(),
  agent: Agent,
});
export type SavedAgent = z.infer<typeof SavedAgent>;

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
  // Empty is the not-yet-configured default (see factories.createProvider);
  // anything else must be a well-formed http(s) URL.
  baseUrl: z.string().refine(
    (v) => v === '' || /^https?:\/\/.+/i.test(v),
    { message: 'Base URL must be empty or start with http:// or https://' },
  ),
  path: z.string().default('/v1/chat/completions'),
  authMethod: AuthMethod.default('bearer'),
  authHeaderName: z.string().default('Authorization'),
  // Empty by default: the bearer path supplies the "Bearer" scheme itself, and
  // custom-header schemes send the raw key. Set this only for a non-standard prefix.
  authPrefix: z.string().default(''),
  /** Not persisted in exports. Present in memory / session / local per storage mode. */
  apiKey: z.string().optional(),
  credentialStorage: CredentialStorage.default('session'),
  requestFormat: z.literal('openai-chat').default('openai-chat'),
  responseFormat: z.literal('openai-chat').default('openai-chat'),
  defaultModel: z.string().default(''),
  models: z.array(z.string()).default([]),
  customHeaders: z.record(z.string(), z.string()).default({}),
  timeoutMs: z.number().int().positive().default(60_000),
  // Dev-only: when true, `vite dev` sends this provider's requests straight from
  // the browser instead of routing them through the local dev proxy. Set this
  // for endpoints only the browser can reach (e.g. behind a browser-authenticated
  // corporate proxy / VPN) that the dev server process cannot. Has no effect in a
  // production build, which is always browser-direct. Providers reachable only
  // via a CORS-less internal gateway should leave this OFF so the proxy is used.
  bypassDevProxy: z.boolean().default(false),
  enabled: z.boolean().default(true),
});
export type Provider = z.infer<typeof Provider>;

// ---------------------------------------------------------------------------
// Transcript (spec §13.1)
// ---------------------------------------------------------------------------

/**
 * One executed tool call inside an agent turn. Persisted on the transcript
 * message (not just runtime state) so run history and exports keep the
 * evidence behind cited claims.
 */
export const ToolTraceEntry = z.object({
  tool: z.string(),
  /** Compact JSON of the validated input. */
  input: z.string().default(''),
  /** Truncated result text (or `ERROR: …`). */
  result: z.string().default(''),
  ok: z.boolean().default(true),
  durationMs: z.number().optional(),
});
export type ToolTraceEntry = z.infer<typeof ToolTraceEntry>;

export const TranscriptMessage = z.object({
  id: z.string(),
  turn: z.number().int(),
  agentId: z.string().nullable(),
  /** Snapshot of identity so the transcript survives agent deletion (spec §9.4). */
  agentName: z.string(),
  agentDeleted: z.boolean().default(false),
  role: z.string().default(''),
  /** Snapshot of the agent's language, so the transcript can render RTL/LTR
   * correctly even after the agent is deleted or its language changes. */
  language: AgentLanguage.default('en'),
  model: z.string().default(''),
  providerId: z.string().nullable().default(null),
  content: z.string().default(''),
  /** Reasoning/thinking text streamed separately from `content`. Hidden by
   * default in the UI; never fed back to other agents as conversation history. */
  reasoning: z.string().optional(),
  /** Tool calls executed during this turn, in order. Hidden behind a chip in
   * the UI; never fed back to other agents as conversation history. */
  toolTrace: z.array(ToolTraceEntry).optional(),
  status: z.enum(['completed', 'failed', 'stopped']).default('completed'),
  sourceAgentId: z.string().nullable().default(null),
  connectionType: ConnectionType.nullable().default(null),
  // --- orchestration control (spec extension) --- all additive + optional so
  // persisted transcripts and ConversationRun history parse unchanged (same
  // pattern as `reasoning`/`toolTrace`).
  /** Agent this message directs a question at (user @mention or a directed-question tool call). */
  targetAgentId: z.string().optional(),
  /** Display snapshot of the target's name — survives agent deletion (mirrors agentName). */
  targetAgentName: z.string().optional(),
  /** Set when this turn redirected the discussion topic (set_topic). The current
   * topic is derived from the transcript: the LAST message carrying topicChange wins. */
  topicChange: z.string().optional(),
  /** Display name of who directed the question this message answers ("You" for the
   * user). Lets history render `[Name, answering X]:` so the order jump reads clearly. */
  answeringTo: z.string().optional(),
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

/** Reply-length preset applied to every agent for a run (spec extension). */
export const ResponseLength = z.enum(['agent-default', 'short', 'medium', 'long']);
export type ResponseLength = z.infer<typeof ResponseLength>;

/**
 * Run-level chit-chat/flattery control (spec extension): 'agent-default'
 * leaves each agent's own characteristics untouched; 'concise-factual'
 * instructs every agent to drop pleasantries/flattery/small talk for the run.
 */
export const ChitchatPolicy = z.enum(['agent-default', 'concise-factual']);
export type ChitchatPolicy = z.infer<typeof ChitchatPolicy>;

/**
 * Run-level language override (spec extension): 'agent-default' leaves each
 * agent answering in its own configured language; any other value forces
 * every agent to answer in that language for the run, replacing (not adding
 * to) the per-agent language directive.
 */
export const LanguageOverride = z.enum(['agent-default', ...AgentLanguage.options]);
export type LanguageOverride = z.infer<typeof LanguageOverride>;

/**
 * Run-level conversation environment (spec extension): the facilitation frame
 * every agent operates in for the run — e.g. brainstorming vs. critique vs.
 * blameless postmortem. 'open' applies no framing (each agent just follows its
 * own role). Each mode maps to a behavioural directive in promptAssembly.
 */
export const ConversationMode = z.enum([
  'open',
  'brainstorm',
  'critique',
  'debate',
  'planning',
  'decision',
  'retrospective',
  'postmortem',
  'socratic',
]);
export type ConversationMode = z.infer<typeof ConversationMode>;

/**
 * What happens when an agent's request fails (spec extension: flow control).
 * Additive over the legacy `stopOnError` boolean — every field is defaulted so
 * old playgrounds parse unchanged, and `onFailure` defaults to preserve today's
 * behaviour (see defaultFailurePolicy / factories). Auto-retry and auto-disable
 * run under ALL modes, before the onFailure decision, so even a 'stop' run now
 * survives a transient blip.
 */
export const FailureAction = z.enum(['stop', 'skip', 'prompt']);
export type FailureAction = z.infer<typeof FailureAction>;

export const FailurePolicy = z.object({
  // How to handle a failure that survives auto-retry. 'prompt' pauses the run
  // for a user decision (only meaningful in an interactive session; automated
  // runs should use 'stop'/'skip' so they never hang).
  onFailure: FailureAction.default('stop'),
  // Automatic re-attempts for retry-eligible kinds (rate-limit/timeout/
  // server-error/network) before escalating. 0 disables auto-retry.
  maxAutoRetries: z.number().int().min(0).max(10).default(2),
  // Base backoff between auto-retries; grows exponentially per attempt.
  backoffMs: z.number().int().min(0).default(800),
  // Consecutive post-retry failures for one agent before it is removed from the
  // circuit for the rest of the run. 0 never auto-disables.
  autoDisableAfterFailures: z.number().int().min(0).default(3),
});
export type FailurePolicy = z.infer<typeof FailurePolicy>;

export const ConversationSettings = z.object({
  subject: z.string().default(''),
  objective: z.string().default(''),
  initialContext: z.string().default(''),
  startingAgentId: z.string().nullable().default(null),
  // No upper bound on maxTotalTurns/maxResponsesPerAgent: these gate how
  // long/large a run can get, and a user deliberately running an extended
  // session is legitimate — the runtime store's own bounded ring buffers
  // (events/errors, see runtimeStore.ts) are what keep memory in check.
  maxTotalTurns: z.number().int().positive().default(12),
  maxResponsesPerAgent: z.number().int().positive().default(3),
  stopOnError: z.boolean().default(true),
  // Flow control on failure (spec extension). Optional, NOT defaulted: legacy
  // playgrounds omit it and resolveFailurePolicy() derives the effective policy
  // from `stopOnError` so their behaviour is unchanged. New/edited playgrounds
  // write it explicitly (and keep stopOnError synced for legacy readers).
  failurePolicy: FailurePolicy.optional(),
  // Run-level overrides (additive, defaulted so old playgrounds parse
  // unchanged): applied on top of each agent's own characteristics for this
  // run only. Empty/null/'agent-default' means "no override".
  conversationMode: ConversationMode.default('open'),
  toneOverride: z.string().default(''),
  responseLength: ResponseLength.default('agent-default'),
  chitchatPolicy: ChitchatPolicy.default('agent-default'),
  languageOverride: LanguageOverride.default('agent-default'),
  temperatureOverride: z.number().min(0).max(2).nullable().default(null),
  // Caps (does not raise) each agent's own runtime.responseTimeoutMs for
  // this run only.
  responseTimeoutOverrideMs: z.number().int().positive().nullable().default(null),
});
export type ConversationSettings = z.infer<typeof ConversationSettings>;

/**
 * Effective failure policy for a conversation. When `failurePolicy` is absent
 * (legacy playgrounds) `onFailure` is derived from the legacy `stopOnError`
 * boolean (`true → 'stop'`, `false → 'skip'`) so old runs behave identically.
 * An explicit `failurePolicy.onFailure` always wins.
 */
export function resolveFailurePolicy(c: {
  stopOnError: boolean;
  failurePolicy?: FailurePolicy;
}): FailurePolicy {
  return FailurePolicy.parse({
    onFailure: c.stopOnError ? 'stop' : 'skip',
    ...(c.failurePolicy ?? {}),
  });
}

// ---------------------------------------------------------------------------
// Run presets — named, reusable bundles of the run-level *options* (tone,
// length, chit-chat policy, language, temperature/timeout overrides, turn
// caps, stop-on-error). Excludes per-run content (subject/objective/initial
// context/starting agent), which is specific to a single conversation, not a
// reusable "how should this run behave" preference.
// ---------------------------------------------------------------------------

export const RunPresetSettings = ConversationSettings.omit({
  subject: true,
  objective: true,
  initialContext: true,
  startingAgentId: true,
});
export type RunPresetSettings = z.infer<typeof RunPresetSettings>;

export const RunPreset = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  savedAt: z.number().int(),
  settings: RunPresetSettings,
});
export type RunPreset = z.infer<typeof RunPreset>;

// ---------------------------------------------------------------------------
// Conversation run history — versioned snapshots of each startRun execution.
// Stored separately from Playground in IndexedDB (see persistence/db.ts).
// ---------------------------------------------------------------------------

export const RunEventLogEntry = z.object({
  id: z.string(),
  at: z.number(),
  kind: z.string(),
  message: z.string(),
  agentId: z.string().nullable().optional(),
});
export type RunEventLogEntry = z.infer<typeof RunEventLogEntry>;

export const ConversationRunStatus = z.enum([
  'running',
  'completed',
  'stopped',
  'error',
  'interrupted',
]);
export type ConversationRunStatus = z.infer<typeof ConversationRunStatus>;

export const ConversationRun = z.object({
  id: z.string(),
  playgroundId: z.string(),
  version: z.number().int().positive(),
  parentRunId: z.string().nullable(),
  startedAt: z.number().int(),
  endedAt: z.number().int().nullable(),
  status: ConversationRunStatus,
  // Defaulted for the same reason as Playground.conversation: a stored run that
  // predates a settings field still loads. NOTE: ConversationRun and UsageEntry
  // are intentionally unversioned — they rely on this "additive, fully-defaulted
  // only" invariant for their embedded schemas (ConversationSettings /
  // TranscriptMessage). Never add a required, non-defaulted field to those, or
  // historical runs will fail safeParse and be dropped on load.
  conversation: ConversationSettings.default({}),
  transcript: z.array(TranscriptMessage).default([]),
  events: z.array(RunEventLogEntry).default([]),
  messageCountAtStart: z.number().int().nonnegative(),
});
export type ConversationRun = z.infer<typeof ConversationRun>;

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
//
// As of schema v2 providers are application-scoped, not embedded here: they live
// in a separate global store so every playground can reuse providers already
// created (see store/providerStore.ts, persistence/db.ts). Agents still reference
// a provider by id via `llm.providerId`; that reference now resolves against the
// global registry. Exports/imports re-embed the referenced providers so a file
// stays self-contained and portable (see PlaygroundExport below, spec §15.3).
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
  // Reusable skill catalog (spec §7.2). Additive + defaulted so v1 files without
  // it still parse — no SCHEMA_VERSION bump needed. Carries no secrets, so it
  // exports as-is (PlaygroundExport inherits this field).
  skillLibrary: z.array(LibrarySkill).default([]),
  // Defaulted so a stored/imported playground missing these nested blocks loads
  // instead of being dropped on read (both sub-schemas are fully field-defaulted).
  conversation: ConversationSettings.default({}),
  transcript: z.array(TranscriptMessage).default([]),
  ui: UiLayoutState.default({}),
});
export type Playground = z.infer<typeof Playground>;

/**
 * Export shape (spec §15.3, §21): a Playground with the providers referenced by
 * its agents re-embedded, API keys guaranteed absent. This keeps an exported
 * file self-contained and portable even though providers live globally in the
 * running app. Imports are validated against this same schema, then the embedded
 * providers are merged back into the global registry.
 */
export const ProviderExport = Provider.omit({ apiKey: true });
export const PlaygroundExport = Playground.extend({
  providers: z.array(ProviderExport).default([]),
});
export type PlaygroundExport = z.infer<typeof PlaygroundExport>;
