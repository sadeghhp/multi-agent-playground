/**
 * Agent-kind behavior and scheduling helpers (see AgentKind in schema.ts).
 *
 * `kind` is the lifecycle/scheduling axis — orthogonal to the free-text `role`.
 * This module is the single source of truth for two things a `kind` changes:
 *   1. A fixed behavioral contract injected into the system prompt (KIND_DIRECTIVE),
 *      so the type actually does its job instead of relying on a hopeful role string.
 *   2. Scheduling predicates the orchestrator branches on (isTerminalKind,
 *      usesFullHistory).
 *
 * Directive text follows the project convention: state concrete behaviour to do
 * and to avoid (not style adjectives), so smaller local models act on it.
 */

import type { AgentKind } from './schema';

/**
 * Fixed behavioral contract per kind, injected at prompt time so a type's duty
 * cannot be silently dropped by an empty/edited systemInstruction. `participant`
 * adds nothing — it just follows its own role.
 */
export const KIND_DIRECTIVE: Record<AgentKind, string | null> = {
  participant: null,
  moderator: [
    'You are the moderator of this discussion. You see the entire conversation.',
    'Synthesize the points that have actually been made, attribute fairly, and keep the group on the stated objective.',
    'Name any disagreement that is still unresolved explicitly instead of glossing over it, and prompt the group toward resolving it.',
    'Do not introduce new arguments or evidence of your own, and do not take a side in the substantive question.',
  ].join(' '),
  summarizer: [
    'You are the summarizer. You run after the discussion has ended and you see the entire conversation.',
    'Produce a concise, faithful summary of what was actually said — the main positions, points of agreement, and points still in dispute.',
    'Include only content present in the conversation: add no new opinions, arguments, embellishment, or filler, and do not resolve disputes yourself.',
  ].join(' '),
  finalizer: [
    'You are the finalizer. You speak last, after every other agent and after the discussion has fully ended — this is the final word.',
    'Synthesize the discussion into a single, decisive answer to the objective, grounded only in claims actually made.',
    'Do not ask questions, defer, invite further discussion, or introduce new arguments; deliver the conclusion.',
  ].join(' '),
};

/** Human-facing label for a kind (inspector select, node badge tooltip). */
export const KIND_LABEL: Record<AgentKind, string> = {
  participant: 'Participant',
  moderator: 'Moderator',
  summarizer: 'Summarizer',
  finalizer: 'Finalizer',
};

/**
 * Terminal kinds are never scheduled by graph edges. The orchestrator excludes
 * them from the normal queue and runs them once, in a wrap-up phase after the
 * discussion ends (summarizers before finalizers).
 */
export function isTerminalKind(kind: AgentKind): boolean {
  return kind === 'summarizer' || kind === 'finalizer';
}

/**
 * Kinds that read the ENTIRE transcript unbounded. Only the one-shot terminal
 * kinds qualify: they run once, so cost is bounded by `maxTotalTurns`. A
 * moderator is deliberately excluded — it speaks repeatedly, so it gets a
 * bounded (but larger-than-participant) window instead (see the orchestrator's
 * history selection) to avoid a late-run turn overflowing a small model.
 */
export function usesFullHistory(kind: AgentKind): boolean {
  return isTerminalKind(kind);
}

/**
 * Kinds whose need for history overrides the per-agent `includeHistory` toggle.
 * A moderator can't facilitate, and a summarizer/finalizer can't synthesize,
 * from an empty view — so the history block is forced on for them regardless of
 * the toggle. Distinct from `usesFullHistory`: this governs *whether* history is
 * included, not *how much* of it.
 */
export function overridesHistoryToggle(kind: AgentKind): boolean {
  return kind === 'moderator' || isTerminalKind(kind);
}

/**
 * Deterministic wrap-up order: summarizers first (so a finalizer can build on the
 * summary), then finalizers; within each group, source array order is preserved.
 * The `agents` argument should already be filtered to enabled terminal-kind agents.
 */
const TERMINAL_ORDER: Record<AgentKind, number> = {
  participant: 0,
  moderator: 0,
  summarizer: 1,
  finalizer: 2,
};

export function terminalKindRank(kind: AgentKind): number {
  return TERMINAL_ORDER[kind];
}
