import type { Agent } from '../domain/schema';
import { isTerminalKind } from '../domain/agentKind';

/**
 * Orchestration control plane (spec extension: smart conversation control).
 *
 * Control tools (src/tools/control.ts) let an agent influence the turn queue —
 * direct a question at a specific agent, redirect the topic, or end the
 * discussion. A tool call never touches the queue directly: it pushes a
 * ControlEffect into the turn's TurnControl, and the discussion loop applies
 * the drained effects at the turn boundary — the one point the loop actually
 * reaches (docs/plans/conversation-flow-control.md). This keeps queue mutation
 * single-threaded and means a failed/aborted turn's effects are simply dropped.
 */

/** One queued turn. Shared by the orchestrator loop and this module. */
export interface QueueItem {
  agentId: string;
  connectionId: string | null;
  sourceAgentId: string | null;
  /** Present when this turn was summoned out of graph order (see TurnDirective). */
  directive?: TurnDirective;
}

/**
 * Why an out-of-order turn was scheduled. Rides on the QueueItem so prompt
 * assembly can impose the "answer the question" contract on exactly that turn —
 * the agent's identity/kind never changes.
 */
export interface TurnDirective {
  type: 'agent-question' | 'user-question' | 'reply-return';
  /** Null when the user (not an agent) directed the question. */
  fromAgentId: string | null;
  fromName: string;
  text: string;
  /** When set, the answerer's completed turn schedules this agent next (round-trip). */
  replyToAgentId?: string;
  /** Override-chain depth; capped so directed answers can't chain forever. */
  depth: number;
}

export type ControlEffect =
  | { kind: 'direct-question'; targetAgentId: string; question: string; routeReplyBack: boolean }
  | { kind: 'set-topic'; topic: string }
  | { kind: 'end-discussion'; reason?: string };

/** At most one directed question per agent turn. */
export const MAX_DIRECTED_PER_TURN = 1;
/** Per-run cap on directed questions AT one agent, so nobody gets dogpiled. */
export const MAX_DIRECTED_PER_AGENT_PER_RUN = 3;
/** Max override-chain depth: ask (1) → answer may ask once more (2), no further. */
export const MAX_DIRECTIVE_DEPTH = 2;

/**
 * Run-scoped, committed control budgets. Created once per run beside the queue.
 * TurnControl validates against these plus its own tentative per-turn state;
 * commits happen only in applyControlEffects, so a failed turn (whose effects
 * are dropped) never consumes budget — and its retry isn't rejected as a dupe.
 */
export interface ControlBudget {
  /** Directed questions received per target agent this run. */
  directedAt: Record<string, number>;
  /** Dedup keys `${callerId}→${targetId}:${normalized question}` already asked. */
  askedPairs: Set<string>;
}

export function createControlBudget(): ControlBudget {
  return { directedAt: {}, askedPairs: new Set() };
}

function pairKey(callerId: string, targetId: string, question: string): string {
  return `${callerId}→${targetId}:${question.trim().toLowerCase().replace(/\s+/g, ' ')}`;
}

/**
 * Per-turn effect collector handed (via closure) to the turn's control tools.
 * `push` validates against run budgets and returns model-visible `ERROR: …`
 * text on rejection (matching the data-tool error convention) or null when the
 * effect was accepted.
 */
export interface TurnControl {
  readonly effects: ControlEffect[];
  push(effect: ControlEffect): string | null;
  drain(): ControlEffect[];
}

/** Inert TurnControl for contexts that never apply effects (prompt previews, wrap-up). */
export function createNoopTurnControl(): TurnControl {
  return {
    effects: [],
    push: () => 'ERROR: orchestration tools are not available in this context.',
    drain: () => [],
  };
}

export function createTurnControl(opts: {
  caller: Agent;
  /** Depth of the directive that scheduled THIS turn (0 for a normal graph turn). */
  itemDirectiveDepth: number;
  runBudget: ControlBudget;
  agentsById: Map<string, Agent>;
  isDisabledForRun(agentId: string): boolean;
  responsesOf(agentId: string): number;
  responseLimitFor(agent: Agent): number;
}): TurnControl {
  const effects: ControlEffect[] = [];

  const validateDirected = (effect: Extract<ControlEffect, { kind: 'direct-question' }>): string | null => {
    const target = opts.agentsById.get(effect.targetAgentId);
    if (!target) return 'ERROR: that agent does not exist in this playground.';
    if (target.id === opts.caller.id) return 'ERROR: you cannot direct a question at yourself.';
    if (isTerminalKind(target.kind)) {
      return `ERROR: "${target.name}" is a ${target.kind} and only speaks after the discussion ends${
        opts.caller.kind === 'moderator' ? ' — use end_discussion to move to wrap-up instead' : ''
      }.`;
    }
    if (!target.runtime.enabled || opts.isDisabledForRun(target.id)) {
      return `ERROR: "${target.name}" is not participating in this run.`;
    }
    if (opts.responsesOf(target.id) >= opts.responseLimitFor(target)) {
      return `ERROR: "${target.name}" has reached its response limit for this run and cannot answer.`;
    }
    if (opts.itemDirectiveDepth >= MAX_DIRECTIVE_DEPTH) {
      return 'ERROR: this reply already answers a directed question — answer in your own words instead of directing another question.';
    }
    if (effects.some((e) => e.kind === 'direct-question')) {
      return `ERROR: you may direct at most ${MAX_DIRECTED_PER_TURN} question per turn.`;
    }
    if ((opts.runBudget.directedAt[target.id] ?? 0) >= MAX_DIRECTED_PER_AGENT_PER_RUN) {
      return `ERROR: "${target.name}" has already been directed ${MAX_DIRECTED_PER_AGENT_PER_RUN} questions this run — let the conversation flow back to them naturally.`;
    }
    if (opts.runBudget.askedPairs.has(pairKey(opts.caller.id, target.id, effect.question))) {
      return `ERROR: you already asked "${target.name}" that exact question this run.`;
    }
    return null;
  };

  return {
    effects,
    push(effect) {
      switch (effect.kind) {
        case 'direct-question': {
          const err = validateDirected(effect);
          if (err) return err;
          break;
        }
        case 'set-topic':
          if (!effect.topic.trim()) return 'ERROR: the topic must not be empty.';
          if (effects.some((e) => e.kind === 'set-topic')) {
            return 'ERROR: you may set at most one topic per turn.';
          }
          break;
        case 'end-discussion':
          if (effects.some((e) => e.kind === 'end-discussion')) {
            return 'ERROR: you already ended the discussion this turn.';
          }
          break;
      }
      effects.push(effect);
      return null;
    },
    drain() {
      return effects.splice(0, effects.length);
    },
  };
}

/**
 * Apply a completed turn's drained effects to the queue — pure queue surgery,
 * unit-testable without a run. Directed questions are unshifted to the queue
 * front (promoting over any pending graph-scheduled entry for the same target,
 * preserving the one-entry-per-agent invariant, spec §11.4); end-discussion
 * clears the queue and suppresses graph enqueueing so the loop drains into the
 * existing wrap-up phase. Budget commits happen here — never at push time — so
 * only effects that actually landed consume budget.
 */
export function applyControlEffects(opts: {
  effects: ControlEffect[];
  /** The just-completed turn that emitted the effects. */
  item: QueueItem;
  callerName: string;
  queue: QueueItem[];
  queued: Set<string>;
  runBudget: ControlBudget;
  agentsById: Map<string, Agent>;
  log(kind: string, message: string, agentId?: string | null): void;
  onQueued?(agentId: string): void;
}): { suppressGraphEnqueue: boolean } {
  let suppressGraphEnqueue = false;

  for (const effect of opts.effects) {
    switch (effect.kind) {
      case 'direct-question': {
        const target = opts.agentsById.get(effect.targetAgentId);
        if (!target) break;
        promoteToFront(opts.queue, opts.queued, {
          agentId: target.id,
          connectionId: null,
          sourceAgentId: opts.item.agentId,
          directive: {
            type: 'agent-question',
            fromAgentId: opts.item.agentId,
            fromName: opts.callerName,
            text: effect.question,
            ...(effect.routeReplyBack ? { replyToAgentId: opts.item.agentId } : {}),
            depth: (opts.item.directive?.depth ?? 0) + 1,
          },
        });
        opts.runBudget.directedAt[target.id] = (opts.runBudget.directedAt[target.id] ?? 0) + 1;
        opts.runBudget.askedPairs.add(pairKey(opts.item.agentId, target.id, effect.question));
        opts.onQueued?.(target.id);
        opts.log(
          'directed-question',
          `"${opts.callerName}" directed a question at "${target.name}" — they answer next.`,
          target.id,
        );
        break;
      }
      case 'set-topic':
        // No queue change: the topic is persisted on the caller's transcript
        // message (topicChange) and derived from the transcript at prompt time.
        opts.log('topic-redirected', `"${opts.callerName}" redirected the discussion to: ${effect.topic}`, opts.item.agentId);
        break;
      case 'end-discussion':
        opts.queue.length = 0;
        opts.queued.clear();
        suppressGraphEnqueue = true;
        opts.log(
          'discussion-ended-by-moderator',
          `"${opts.callerName}" ended the discussion${effect.reason ? `: ${effect.reason}` : '.'}`,
          opts.item.agentId,
        );
        break;
    }
  }

  return { suppressGraphEnqueue };
}

/**
 * Unshift an item to the queue front, replacing (not duplicating) any pending
 * entry for the same agent so the one-entry-per-agent invariant holds.
 */
export function promoteToFront(queue: QueueItem[], queued: Set<string>, item: QueueItem): void {
  if (queued.has(item.agentId)) {
    const existing = queue.findIndex((q) => q.agentId === item.agentId);
    if (existing >= 0) queue.splice(existing, 1);
  }
  queue.unshift(item);
  queued.add(item.agentId);
}
