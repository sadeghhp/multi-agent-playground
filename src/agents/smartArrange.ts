import { z } from 'zod';
import {
  AgentKind,
  ConnectionType,
  ConversationMode,
  type Agent,
  type Connection,
  type Provider,
} from '../domain/schema';
import { isTerminalKind } from '../domain/agentKind';
import { ProviderError, retryEligible } from '../providers/errors';
import { sendChat } from '../providers/openaiAdapter';
import type { ChatMessage } from '../providers/types';
import { parseJsonObject } from './generateAgent';

/**
 * Smart Arrange. Given the conversation subject and the agents already on the
 * canvas, ask an LLM to design the conversation topology — who starts, the
 * directed connections (with interaction type and priority), kind corrections,
 * and suggested run settings. Mirrors generateAgent.ts: a JSON contract
 * enforced by prompt instructions + free-text extraction + zod (there is no
 * response_format support in the provider layer), followed by a semantic
 * normalization pass that guarantees the applied graph is runnable.
 */

const ArrangedConnection = z.object({
  source: z.string(),
  target: z.string(),
  type: ConnectionType.default('conversation'),
  priority: z.number().int().min(-100).max(100).default(0),
  label: z.string().max(60).optional(),
  instructionOverride: z.string().max(500).optional(),
});

export const ArrangementDraft = z.object({
  startingAgentId: z.string(),
  connections: z.array(ArrangedConnection).min(1).max(40),
  kindCorrections: z
    .array(z.object({ agentId: z.string(), kind: AgentKind }))
    .max(12)
    .default([]),
  settings: z
    .object({
      conversationMode: ConversationMode.optional(),
      maxTotalTurns: z.number().int().min(1).max(60).optional(),
      maxResponsesPerAgent: z.number().int().min(1).max(10).optional(),
    })
    .default({}),
  rationale: z.string().max(600).default(''),
});
export type ArrangementDraft = z.infer<typeof ArrangementDraft>;

const ARRANGE_MAX_OUTPUT_TOKENS = 8192;

const ARRANGE_SYSTEM_PROMPT = [
  'You are a conversation-topology designer for a multi-agent discussion tool.',
  'Given a subject and a roster of existing agents, design the directed graph',
  'that produces the most natural, productive conversation among them.',
  '',
  'How the tool executes the graph:',
  '- The starting agent speaks first; after an agent speaks, its outgoing',
  '  connections fire — higher `priority` edges are scheduled first.',
  '- Edges are directed: after `source` speaks, `target` speaks next.',
  '- Agents with kind `summarizer` or `finalizer` run automatically AFTER the',
  '  discussion ends (summarizers first, then finalizers). Give them NO edges',
  '  in or out, and never pick one as startingAgentId. If an agent\'s role',
  '  clearly means it should wrap up, emit a kindCorrection instead of wiring it.',
  '- `moderator` kind is wired like a participant but always sees the full history.',
  '- Connection `type`: "conversation" = target replies in open discussion;',
  '  "review" = target critiques the source\'s latest answer; "handoff" = target',
  '  takes the source\'s output as its primary task context and continues.',
  '',
  'Rules:',
  '- Use ONLY the agent ids given in the roster. Never invent ids or new agents.',
  '- Every participant/moderator must be reachable from startingAgentId.',
  '- At most one edge per ordered (source, target) pair. Cycles are allowed and',
  '  are how a back-and-forth discussion loop is built.',
  '- Suggest settings only when the subject calls for it (e.g. a contested',
  '  question → conversationMode "debate" and more turns).',
  '',
  'Return ONLY a single JSON object with exactly these fields — no markdown',
  'fences, no commentary before or after:',
  '{',
  '  "startingAgentId": string,       // id of the agent that opens the discussion',
  '  "connections": [',
  '    {',
  '      "source": string,            // agent id',
  '      "target": string,            // agent id',
  '      "type": "conversation" | "review" | "handoff",',
  '      "priority": number,          // integer; higher fires first; 0 is normal',
  '      "label": string,             // optional short edge label',
  '      "instructionOverride": string // optional extra instruction for the target on this edge',
  '    }',
  '  ],',
  '  "kindCorrections": [             // optional; only when an agent\'s role implies a different kind',
  '    { "agentId": string, "kind": "participant" | "moderator" | "summarizer" | "finalizer" }',
  '  ],',
  '  "settings": {                    // optional; omit fields you have no opinion on',
  '    "conversationMode": "open" | "brainstorm" | "critique" | "debate" | "planning" | "decision" | "retrospective" | "postmortem" | "socratic",',
  '    "maxTotalTurns": number,       // 1-60',
  '    "maxResponsesPerAgent": number // 1-10',
  '  },',
  '  "rationale": string              // 1-3 sentences: why this arrangement fits the subject',
  '}',
  '',
  'Example (roster: ag_1 Researcher, ag_2 Critic, ag_3 Summarizer with role "sums up"):',
  '{"startingAgentId":"ag_1","connections":[{"source":"ag_1","target":"ag_2","type":"review","priority":0},{"source":"ag_2","target":"ag_1","type":"conversation","priority":0}],"kindCorrections":[{"agentId":"ag_3","kind":"summarizer"}],"settings":{"conversationMode":"critique","maxTotalTurns":10},"rationale":"The researcher proposes facts, the critic reviews them in a loop, and the summarizer wraps up automatically."}',
].join('\n');

/** One compact roster line per enabled agent — never full system prompts. */
function rosterLine(agent: Agent): string {
  const about = agent.description.trim().slice(0, 120);
  return `- id: ${agent.id} | name: ${agent.name} | role: ${agent.role || '(none)'} | kind: ${agent.kind}${about ? ` | about: ${about}` : ''}`;
}

export function buildArrangeUserMessage(
  subject: string,
  objective: string,
  agents: Agent[],
): string {
  const sections = [`Subject: ${subject.trim()}`];
  if (objective.trim()) sections.push(`Objective: ${objective.trim()}`);
  sections.push('', 'Agent roster:', ...agents.filter((a) => a.runtime.enabled).map(rosterLine));
  return sections.join('\n');
}

export interface ArrangeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Streaming preview passthrough only — never parsed mid-stream. */
  onToken?: (chunk: string) => void;
  onReasoningToken?: (chunk: string) => void;
}

export interface ArrangeResult {
  ok: boolean;
  draft?: ArrangementDraft;
  model?: string;
  durationMs: number;
  errorKind?: string;
  errorSummary?: string;
  errorDetail?: string;
  /** Raw model output, set when the reply couldn't be parsed into a draft. */
  rawText?: string;
  retryEligible?: boolean;
}

/** Parse + zod-validate an arrangement draft from raw model text. */
export function parseArrangementDraftFromText(raw: string):
  | { ok: true; draft: ArrangementDraft }
  | { ok: false; failure: 'syntax' | 'schema'; errorSummary: string; errorDetail?: string } {
  let parsed: unknown;
  try {
    parsed = parseJsonObject(raw);
  } catch {
    return {
      ok: false,
      failure: 'syntax',
      errorSummary: 'The model reply did not contain a valid JSON object.',
    };
  }
  const result = ArrangementDraft.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    return {
      ok: false,
      failure: 'schema',
      errorSummary: 'The model reply did not match the arrangement contract.',
      errorDetail: issues,
    };
  }
  return { ok: true, draft: result.data };
}

/**
 * Ask the provider to design an arrangement. Returns a result object; never
 * throws for provider/network/parse failures.
 */
export async function generateArrangement(
  subject: string,
  objective: string,
  agents: Agent[],
  provider: Provider,
  model: string,
  options: ArrangeOptions = {},
): Promise<ArrangeResult> {
  const start = Date.now();

  if (!subject.trim()) {
    return { ok: false, durationMs: 0, errorKind: 'empty-subject', errorSummary: 'Enter a conversation subject first.' };
  }
  if (!model.trim()) {
    return { ok: false, durationMs: 0, errorKind: 'no-model', errorSummary: 'No model selected for arrangement.' };
  }
  if (agents.filter((a) => a.runtime.enabled).length < 2) {
    return { ok: false, durationMs: 0, errorKind: 'too-few-agents', errorSummary: 'Add at least 2 enabled agents first.' };
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: ARRANGE_SYSTEM_PROMPT },
    { role: 'user', content: buildArrangeUserMessage(subject, objective, agents) },
  ];

  try {
    const res = await sendChat(
      provider,
      { model, messages, temperature: 0.3, maxOutputTokens: ARRANGE_MAX_OUTPUT_TOKENS },
      {
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        onToken: options.onToken,
        onReasoningToken: options.onReasoningToken,
      },
    );

    if (!res.text.trim()) {
      return {
        ok: false,
        durationMs: Date.now() - start,
        errorKind: 'empty-response',
        errorSummary: res.reasoning
          ? 'The model spent its whole response reasoning and never produced a visible answer.'
          : 'The model returned an empty response.',
        rawText: res.reasoning || undefined,
      };
    }

    const parsed = parseArrangementDraftFromText(res.text);
    if (!parsed.ok) {
      const truncated = res.finishReason === 'length';
      return {
        ok: false,
        durationMs: Date.now() - start,
        errorKind: 'invalid-json',
        errorSummary:
          parsed.failure === 'syntax' && truncated
            ? 'The model ran out of output tokens before finishing valid JSON. Try again.'
            : parsed.errorSummary,
        errorDetail: parsed.errorDetail,
        rawText: res.text,
        retryEligible: parsed.failure === 'syntax' && truncated,
      };
    }

    return { ok: true, draft: parsed.draft, model: res.model, durationMs: Date.now() - start };
  } catch (err) {
    const pe = err instanceof ProviderError ? err : null;
    return {
      ok: false,
      durationMs: Date.now() - start,
      errorKind: pe?.kind ?? 'unknown',
      errorSummary: pe?.message ?? 'Unknown error while arranging the graph.',
      errorDetail: pe?.detail,
      retryEligible: pe ? retryEligible(pe.kind) : false,
    };
  }
}

// ---------------------------------------------------------------------------
// Semantic normalization: repair the model's draft into a guaranteed-runnable
// plan against the actual roster, noting every repair in plain language.
// ---------------------------------------------------------------------------

export interface ArrangementPlan {
  startingAgentId: string;
  connections: Omit<Connection, 'id'>[];
  kindCorrections: { agentId: string; kind: AgentKind }[];
  settings: ArrangementDraft['settings'];
  rationale: string;
  /** Human-readable repair notes (dropped edges, fallbacks, added links). */
  notes: string[];
}

export type NormalizeResult =
  | { ok: true; plan: ArrangementPlan }
  | { ok: false; errorSummary: string };

export function normalizeArrangement(draft: ArrangementDraft, agents: Agent[]): NormalizeResult {
  const notes: string[] = [];
  const byId = new Map(agents.map((a) => [a.id, a]));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;

  // 1. Kind corrections: keep only known ids; compute effective kinds.
  const kindCorrections = draft.kindCorrections.filter((c) => {
    if (byId.has(c.agentId)) return true;
    notes.push(`Dropped a kind change for an unknown agent id.`);
    return false;
  });
  const effectiveKind = (id: string): AgentKind =>
    kindCorrections.find((c) => c.agentId === id)?.kind ?? byId.get(id)?.kind ?? 'participant';

  // 2. Connections: known ids only, dedupe ordered pairs (keep highest priority,
  //    matching domainStore.addConnection semantics).
  const seenPairs = new Map<string, (typeof draft.connections)[number]>();
  for (const conn of draft.connections) {
    if (!byId.has(conn.source) || !byId.has(conn.target)) {
      notes.push('Dropped a connection referencing an unknown agent id.');
      continue;
    }
    const key = `${conn.source}→${conn.target}`;
    const existing = seenPairs.get(key);
    if (existing) {
      notes.push(`Merged duplicate connections ${nameOf(conn.source)} → ${nameOf(conn.target)}.`);
      if (conn.priority > existing.priority) seenPairs.set(key, conn);
      continue;
    }
    seenPairs.set(key, conn);
  }

  // 3. Strip edges touching terminal kinds — the orchestrator never schedules
  //    them by edge, so keeping such edges would make the canvas lie.
  const connections = [...seenPairs.values()].filter((conn) => {
    const terminalEnd = [conn.source, conn.target].find((id) => isTerminalKind(effectiveKind(id)));
    if (terminalEnd) {
      notes.push(
        `Removed the ${nameOf(conn.source)} → ${nameOf(conn.target)} connection: "${nameOf(terminalEnd)}" runs in the wrap-up phase and is not scheduled by edges.`,
      );
      return false;
    }
    return true;
  });

  // 4. Starting agent: must be known, enabled, non-terminal. Fall back to the
  //    first non-terminal agent with an outgoing edge.
  const startValid = (id: string): boolean => {
    const agent = byId.get(id);
    return Boolean(agent && agent.runtime.enabled && !isTerminalKind(effectiveKind(id)));
  };
  let startingAgentId = draft.startingAgentId;
  if (!startValid(startingAgentId)) {
    const fallback = connections.find((c) => startValid(c.source))?.source;
    if (!fallback) return { ok: false, errorSummary: 'The arrangement has no usable starting agent.' };
    notes.push(`Start moved to ${nameOf(fallback)} (the proposed starting agent cannot open a discussion).`);
    startingAgentId = fallback;
  }

  if (connections.length === 0) {
    return { ok: false, errorSummary: 'No usable connections survived validation.' };
  }

  // 5. Reachability repair over the proposed edges: every enabled, non-terminal
  //    agent must be reachable from the start, or it would silently never speak.
  const flowIds = agents
    .filter((a) => a.runtime.enabled && !isTerminalKind(effectiveKind(a.id)))
    .map((a) => a.id);
  const reachable = new Set<string>();
  const propagateFrom = (rootId: string) => {
    const queue = [rootId];
    reachable.add(rootId);
    while (queue.length) {
      const id = queue.shift()!;
      for (const conn of connections) {
        if (conn.source === id && !reachable.has(conn.target)) {
          reachable.add(conn.target);
          queue.push(conn.target);
        }
      }
    }
  };
  propagateFrom(startingAgentId);
  for (const id of flowIds) {
    if (!reachable.has(id)) {
      connections.push({ source: startingAgentId, target: id, type: 'conversation', priority: -1 });
      notes.push(`Linked ${nameOf(startingAgentId)} → ${nameOf(id)} so "${nameOf(id)}" is reachable and can speak.`);
      // A repaired agent's own outgoing edges may make later agents reachable
      // too — propagate so we don't add redundant links for them.
      propagateFrom(id);
    }
  }

  return {
    ok: true,
    plan: {
      startingAgentId,
      connections: connections.map((c) => ({
        source: c.source,
        target: c.target,
        enabled: true,
        type: c.type,
        priority: c.priority,
        ...(c.label ? { label: c.label } : {}),
        ...(c.instructionOverride ? { instructionOverride: c.instructionOverride } : {}),
      })),
      kindCorrections,
      settings: draft.settings,
      rationale: draft.rationale,
      notes,
    },
  };
}
