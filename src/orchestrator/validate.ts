import type { Playground } from '../domain/schema';

/**
 * Graph + run validation (spec §19). Warnings don't block a run; errors do.
 */

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
  agentId?: string;
}

export function validateForRun(pg: Playground): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const agentsById = new Map(pg.agents.map((a) => [a.id, a]));
  const enabledAgents = pg.agents.filter((a) => a.runtime.enabled);

  // Starting agent (spec §19 run validation)
  const startId = pg.conversation.startingAgentId;
  const start = startId ? agentsById.get(startId) : undefined;
  if (!startId || !start) {
    issues.push({ level: 'error', message: 'No starting agent selected.' });
  } else if (!start.runtime.enabled) {
    issues.push({ level: 'error', message: 'The starting agent is disabled.', agentId: start.id });
  }

  // Max turns
  if (pg.conversation.maxTotalTurns < 1) {
    issues.push({ level: 'error', message: 'Maximum turns must be at least 1.' });
  }

  // Which agents will actually participate. Only these are held to readiness
  // errors — an unreachable agent's misconfiguration must not block the run
  // (spec §19: "Unreachable agents should produce a warning, not an execution
  // failure."). If there's no valid start, everything is unreachable, so we fall
  // back to validating all enabled agents (the missing-start error blocks anyway).
  const reachable =
    start && start.runtime.enabled ? reachableFrom(pg, start.id) : null;
  const willParticipate = (agentId: string) => (reachable ? reachable.has(agentId) : true);

  // Per-agent readiness (spec §19 agent validation)
  for (const agent of enabledAgents) {
    if (!willParticipate(agent.id)) {
      // Unreachable: warn only, don't block.
      issues.push({
        level: 'warning',
        message: `Agent "${agent.name}" is not reachable from the starting agent and won't participate.`,
        agentId: agent.id,
      });
      continue;
    }
    if (!agent.name.trim()) issues.push({ level: 'error', message: 'An agent is missing a name.', agentId: agent.id });
    if (!agent.role.trim()) issues.push({ level: 'warning', message: `Agent "${agent.name}" has no role.`, agentId: agent.id });
    if (!agent.systemInstruction.trim()) {
      issues.push({ level: 'error', message: `Agent "${agent.name}" has no system instruction.`, agentId: agent.id });
    }
    const provider = pg.providers.find((p) => p.id === agent.llm.providerId);
    if (!agent.llm.providerId || !provider) {
      issues.push({ level: 'error', message: `Agent "${agent.name}" has no provider assigned.`, agentId: agent.id });
    } else if (!provider.enabled) {
      issues.push({ level: 'error', message: `Agent "${agent.name}" uses a disabled provider.`, agentId: agent.id });
    }
    if (!agent.llm.model.trim()) {
      issues.push({ level: 'error', message: `Agent "${agent.name}" has no model set.`, agentId: agent.id });
    }
  }

  // Dangling edges (spec §19)
  for (const conn of pg.connections) {
    if (!agentsById.has(conn.source) || !agentsById.has(conn.target)) {
      issues.push({ level: 'error', message: `A connection references a missing agent.` });
    }
  }

  return issues;
}

/** BFS over enabled outgoing connections to enabled targets. */
export function reachableFrom(pg: Playground, startId: string): Set<string> {
  const enabledIds = new Set(pg.agents.filter((a) => a.runtime.enabled).map((a) => a.id));
  const outgoing = new Map<string, string[]>();
  for (const conn of pg.connections) {
    if (!conn.enabled) continue;
    if (!enabledIds.has(conn.source) || !enabledIds.has(conn.target)) continue;
    const list = outgoing.get(conn.source) ?? [];
    list.push(conn.target);
    outgoing.set(conn.source, list);
  }

  const reachable = new Set<string>([startId]);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift()!;
    for (const next of outgoing.get(id) ?? []) {
      if (!reachable.has(next)) {
        reachable.add(next);
        queue.push(next);
      }
    }
  }
  return reachable;
}

export function hasBlockingErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === 'error');
}
