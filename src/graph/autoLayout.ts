import type { Agent, AgentKind, Connection } from '../domain/schema';
import { isTerminalKind } from '../domain/agentKind';

/**
 * Deterministic layered layout for an arranged graph. BFS from the starting
 * agent assigns each flow agent (participant/moderator) a column by traversal
 * depth — so reading left-to-right matches speaking order — and terminal kinds
 * (summarizers, then finalizers) land in the final columns, mirroring the
 * wrap-up phase. Hand-rolled on purpose: at playground scale (≤ ~12 nodes) a
 * layout dependency (dagre/elk) buys nothing.
 */

/** Grid pitch, sized against the rendered AgentNode (~200px wide). */
const X_GAP = 280;
const Y_GAP = 150;
const X_ORIGIN = 80;
const Y_ORIGIN = 80;

export function layoutArrangement(
  agents: Agent[],
  connections: Pick<Connection, 'source' | 'target' | 'enabled' | 'priority'>[],
  startingAgentId: string,
  /** Effective kind per agent (kind corrections applied); defaults to agent.kind. */
  kindOf?: (id: string) => AgentKind,
): Map<string, { x: number; y: number }> {
  const kind = kindOf ?? ((id: string) => agents.find((a) => a.id === id)?.kind ?? 'participant');
  const flowAgents = agents.filter((a) => !isTerminalKind(kind(a.id)));
  const flowIds = new Set(flowAgents.map((a) => a.id));

  // Outgoing adjacency between flow agents, ordered priority-desc (then input
  // order) so the visual row order mirrors the orchestrator's scheduling order.
  const ordered = [...connections]
    .filter((c) => c.enabled && flowIds.has(c.source) && flowIds.has(c.target))
    .sort((a, b) => b.priority - a.priority);

  // BFS: column = depth, row = visit order within the column.
  const column = new Map<string, number>();
  if (flowIds.has(startingAgentId)) {
    column.set(startingAgentId, 0);
    const queue = [startingAgentId];
    while (queue.length) {
      const id = queue.shift()!;
      for (const conn of ordered) {
        if (conn.source !== id || column.has(conn.target)) continue;
        column.set(conn.target, column.get(id)! + 1);
        queue.push(conn.target);
      }
    }
  }

  // Unreached flow agents (disabled/unwired) go to an overflow column after the
  // deepest reached one, in roster order.
  const maxReached = Math.max(0, ...column.values());
  for (const agent of flowAgents) {
    if (!column.has(agent.id)) column.set(agent.id, maxReached + 1);
  }

  // Terminal kinds: summarizers in the next column, finalizers after — the
  // wrap-up order — stacked in roster order.
  const maxFlow = Math.max(0, ...column.values());
  for (const agent of agents) {
    const k = kind(agent.id);
    if (k === 'summarizer') column.set(agent.id, maxFlow + 1);
    else if (k === 'finalizer') column.set(agent.id, maxFlow + 2);
  }

  // Row within each column follows insertion order of `column`, which is BFS
  // visit order for reached agents and roster order for the rest — deterministic.
  const rowsUsed = new Map<number, number>();
  const positions = new Map<string, { x: number; y: number }>();
  for (const id of column.keys()) {
    const col = column.get(id)!;
    const row = rowsUsed.get(col) ?? 0;
    rowsUsed.set(col, row + 1);
    positions.set(id, { x: X_ORIGIN + col * X_GAP, y: Y_ORIGIN + row * Y_GAP });
  }
  return positions;
}
