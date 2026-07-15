import type { Playground, Provider } from '../domain/schema';
import { isTerminalKind } from '../domain/agentKind';
import { assessProviderReachability } from '../providers/browserReachability';

/**
 * Graph + run validation (spec §19). Warnings don't block a run; errors do.
 * Providers are application-global (store/providerStore.ts) and passed in so an
 * agent's `llm.providerId` can be resolved against the current registry.
 */

export interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
  agentId?: string;
}

export function validateForRun(
  pg: Playground,
  providers: Provider[],
  appOrigin?: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const agentsById = new Map(pg.agents.map((a) => [a.id, a]));
  const enabledAgents = pg.agents.filter((a) => a.runtime.enabled);
  /** Providers we already checked — avoid duplicate reachability messages. */
  const reachabilityChecked = new Set<string>();

  // Starting agent (spec §19 run validation)
  const startId = pg.conversation.startingAgentId;
  const start = startId ? agentsById.get(startId) : undefined;
  if (!startId || !start) {
    issues.push({ level: 'error', message: 'No starting agent selected.' });
  } else if (!start.runtime.enabled) {
    issues.push({ level: 'error', message: 'The starting agent is disabled.', agentId: start.id });
  } else if (isTerminalKind(start.kind)) {
    // A summarizer/finalizer never seeds discussion — it runs in the wrap-up
    // phase. Starting on one means no participants ever speak.
    issues.push({
      level: 'warning',
      message: `The starting agent "${start.name}" is a ${start.kind}, which only runs in the wrap-up phase after the discussion — pick a participant or moderator to start.`,
      agentId: start.id,
    });
  }

  // Subject is the one required conversation field (spec §11.1).
  if (!pg.conversation.subject.trim()) {
    issues.push({ level: 'error', message: 'A conversation subject is required.' });
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
  // Terminal kinds (summarizer/finalizer) are scheduled by the engine wrap-up
  // phase, not by graph edges, so they always participate regardless of whether
  // any edge reaches them.
  const willParticipate = (agentId: string) => {
    if (isTerminalKind(agentsById.get(agentId)?.kind ?? 'participant')) return true;
    return reachable ? reachable.has(agentId) : true;
  };

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
    if (agent.personaMode === 'digital-shadow' && !agent.persona?.realName?.trim()) {
      issues.push({
        level: 'warning',
        message: `Agent "${agent.name}" is a digital shadow but has no real person name.`,
        agentId: agent.id,
      });
    }
    if (
      agent.personaMode === 'digital-shadow' &&
      /\badvocate\b/i.test(agent.name)
    ) {
      issues.push({
        level: 'warning',
        message: `Agent "${agent.name}" is a digital shadow but its name reads like an advocate — consider using the real person's name.`,
        agentId: agent.id,
      });
    }
    const provider = providers.find((p) => p.id === agent.llm.providerId);
    if (!agent.llm.providerId || !provider) {
      issues.push({ level: 'error', message: `Agent "${agent.name}" has no provider assigned.`, agentId: agent.id });
    } else if (!provider.enabled) {
      issues.push({ level: 'error', message: `Agent "${agent.name}" uses a disabled provider.`, agentId: agent.id });
    } else if (
      (provider.authMethod === 'bearer' || provider.authMethod === 'custom-header') &&
      !provider.apiKey?.trim()
    ) {
      // Spec §19: a run cannot begin when required provider credentials are unavailable.
      issues.push({
        level: 'error',
        message: `Agent "${agent.name}" has no API key for its provider "${provider.displayName}".`,
        agentId: agent.id,
      });
    } else if (!reachabilityChecked.has(provider.id)) {
      reachabilityChecked.add(provider.id);
      const reach =
        appOrigin === undefined
          ? assessProviderReachability(provider.baseUrl)
          : assessProviderReachability(provider.baseUrl, appOrigin);
      if (!reach.ok) {
        issues.push({
          level: 'error',
          message: `Provider "${provider.displayName}": ${reach.message}`,
          agentId: agent.id,
        });
      } else if (reach.issue === 'cors-required') {
        issues.push({
          level: 'warning',
          message: `Provider "${provider.displayName}": ${reach.message}`,
          agentId: agent.id,
        });
      }
    }
    if (!agent.llm.model.trim()) {
      issues.push({ level: 'error', message: `Agent "${agent.name}" has no model set.`, agentId: agent.id });
    }
  }

  // Dangling edges (spec §19). A disabled connection can never fire (outgoing()
  // in orchestrator.ts already filters these out at run time), so a leftover
  // disabled-and-dangling edge from a bad import is inert, not a real blocker.
  for (const conn of pg.connections) {
    if (conn.enabled && (!agentsById.has(conn.source) || !agentsById.has(conn.target))) {
      issues.push({ level: 'error', message: `A connection references a missing agent.` });
    }
  }

  // Terminal-kind arrangement warnings. Terminal kinds are engine-scheduled, so
  // outgoing edges from them never fire, and their order is fixed (summarizers
  // then finalizers); surface these so the visual arrangement isn't misleading.
  const finalizers = enabledAgents.filter((a) => a.kind === 'finalizer');
  for (const agent of enabledAgents) {
    if (!isTerminalKind(agent.kind)) continue;
    const hasOutgoing = pg.connections.some((c) => c.enabled && c.source === agent.id);
    if (hasOutgoing) {
      issues.push({
        level: 'warning',
        message: `Agent "${agent.name}" is a ${agent.kind}; it runs last in the wrap-up phase, so its outgoing connections are ignored.`,
        agentId: agent.id,
      });
    }
  }
  if (finalizers.length > 1) {
    issues.push({
      level: 'warning',
      message: `There are ${finalizers.length} finalizers; they run one after another in the wrap-up phase, each seeing the previous one's output.`,
    });
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
