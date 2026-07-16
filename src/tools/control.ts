import { z } from 'zod';
import type { Agent, AgentKind } from '../domain/schema';
import { isTerminalKind } from '../domain/agentKind';
import type { TurnControl } from '../orchestrator/controlEffects';
import type { ToolDefinition } from './types';

/**
 * Orchestration control tools (spec extension: smart conversation control).
 * Unlike the data tools in registry.ts these are not static: they are built
 * fresh per turn, closing over the turn's TurnControl so `execute` mutates
 * orchestrator state (via ControlEffects) instead of fetching data. They ride
 * the same text-fence protocol, tool loop, and toolTrace unchanged.
 *
 * Granting is per-agent opt-in: an agent gets a control tool only when the
 * tool id is BOTH in `agent.tools` and eligible for the agent's kind (below).
 * Models address targets by NAME (never id); resolution is case-insensitive.
 */

export const CONTROL_TOOL_IDS_BY_KIND: Record<AgentKind, readonly string[]> = {
  participant: ['ask_agent'],
  moderator: ['direct_question', 'set_topic', 'end_discussion'],
  summarizer: [],
  finalizer: [],
};

/** Every control tool id, for "is this a control tool at all" checks (validate.ts, UI). */
export const CONTROL_TOOL_IDS: ReadonlySet<string> = new Set(
  Object.values(CONTROL_TOOL_IDS_BY_KIND).flat(),
);

/** Static metadata for UI listings (inspector) — no TurnControl needed. */
export const CONTROL_TOOL_META: Record<string, { name: string; description: string }> = {
  ask_agent: {
    name: 'Ask agent',
    description:
      'Put one direct question to a named agent; they answer immediately and you get a follow-up turn with their answer.',
  },
  direct_question: {
    name: 'Direct question',
    description: 'Direct a question at a named agent; they answer immediately, out of turn order.',
  },
  set_topic: {
    name: 'Set topic',
    description: 'Redirect the discussion to a new topic that every later agent must address.',
  },
  end_discussion: {
    name: 'End discussion',
    description: 'End the discussion now and move to the wrap-up phase (summarizer/finalizer).',
  },
};

/** The control tool ids this agent has actually been granted (opt-in ∩ kind-eligible). */
export function grantedControlToolIds(agent: Pick<Agent, 'kind' | 'tools'>): string[] {
  const eligible = CONTROL_TOOL_IDS_BY_KIND[agent.kind];
  return agent.tools.filter((id) => eligible.includes(id));
}

/** A named agent another agent could address. */
export interface RosterEntry {
  id: string;
  name: string;
  kind: AgentKind;
  enabled: boolean;
}

/** Roster of agents the caller may target: enabled, non-terminal, not itself. */
function addressable(callerId: string, roster: readonly RosterEntry[]): RosterEntry[] {
  return roster.filter((r) => r.id !== callerId && r.enabled && !isTerminalKind(r.kind));
}

function rosterHint(callerId: string, roster: readonly RosterEntry[]): string {
  const names = addressable(callerId, roster).map((r) => `"${r.name}"`);
  return names.length > 0 ? `one of ${names.join(', ')}` : '(no addressable agents)';
}

/** Case-insensitive name → roster entry; also accepts an exact id. */
function resolveTarget(
  raw: string,
  callerId: string,
  roster: readonly RosterEntry[],
): RosterEntry | null {
  const candidates = addressable(callerId, roster);
  const needle = raw.trim().toLowerCase();
  return (
    candidates.find((r) => r.name.trim().toLowerCase() === needle) ??
    candidates.find((r) => r.id === raw.trim()) ??
    null
  );
}

const DirectedInput = z.object({ target: z.string(), question: z.string().min(1) });
const TopicInput = z.object({ topic: z.string().min(1) });
const EndInput = z.object({ reason: z.string().optional() }).default({});

/**
 * Build the control ToolDefinitions for one agent's turn. `ctrl` collects the
 * effects; prompt previews pass a no-op TurnControl (createNoopTurnControl) so
 * the tool list renders identically to the live run.
 */
export function buildControlTools(opts: {
  agent: Agent;
  roster: readonly RosterEntry[];
  ctrl: TurnControl;
}): ToolDefinition[] {
  const { agent, roster, ctrl } = opts;
  const granted = new Set(grantedControlToolIds(agent));
  if (granted.size === 0) return [];

  const tools: ToolDefinition[] = [];

  const directedTool = (id: 'ask_agent' | 'direct_question', routeReplyBack: boolean): ToolDefinition => ({
    id,
    name: CONTROL_TOOL_META[id].name,
    description: `${CONTROL_TOOL_META[id].description} "target" must be ${rosterHint(agent.id, roster)}.`,
    inputHint: '{"target": string, "question": string}',
    inputSchema: DirectedInput,
    execute: async (input) => {
      const { target: rawTarget, question } = input as z.infer<typeof DirectedInput>;
      const target = resolveTarget(rawTarget, agent.id, roster);
      if (!target) {
        return `ERROR: no addressable agent named "${rawTarget}". Addressable agents: ${rosterHint(agent.id, roster)}.`;
      }
      const err = ctrl.push({ kind: 'direct-question', targetAgentId: target.id, question, routeReplyBack });
      if (err) return err;
      return (
        `Question queued for ${target.name} — they will answer immediately after your message. ` +
        `State the question in your visible message too, then finish your message now; do not repeat it as another tool call.`
      );
    },
  });

  if (granted.has('ask_agent')) tools.push(directedTool('ask_agent', true));
  if (granted.has('direct_question')) tools.push(directedTool('direct_question', false));

  if (granted.has('set_topic')) {
    tools.push({
      id: 'set_topic',
      name: CONTROL_TOOL_META.set_topic.name,
      description: CONTROL_TOOL_META.set_topic.description,
      inputHint: '{"topic": string}',
      inputSchema: TopicInput,
      execute: async (input) => {
        const { topic } = input as z.infer<typeof TopicInput>;
        const err = ctrl.push({ kind: 'set-topic', topic });
        if (err) return err;
        return `Topic set. Every later agent will be instructed to address: "${topic}". State the redirect in your visible message too, then finish your message now.`;
      },
    });
  }

  if (granted.has('end_discussion')) {
    tools.push({
      id: 'end_discussion',
      name: CONTROL_TOOL_META.end_discussion.name,
      description: CONTROL_TOOL_META.end_discussion.description,
      inputHint: '{"reason": string}',
      inputSchema: EndInput,
      execute: async (input) => {
        const { reason } = input as z.infer<typeof EndInput>;
        const err = ctrl.push({ kind: 'end-discussion', ...(reason ? { reason } : {}) });
        if (err) return err;
        return 'The discussion will end after your message and move to wrap-up. State your closing note in your visible message now; do not call any more tools.';
      },
    });
  }

  return tools;
}
