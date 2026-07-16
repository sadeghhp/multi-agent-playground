import type { Agent } from '../domain/schema';
import { isTerminalKind } from '../domain/agentKind';

/**
 * Composer @mention parsing (spec extension: orchestration control). A user
 * message starting with `@AgentName …` addresses that agent directly: it
 * answers first (out of graph order) and the directive binds it alone — every
 * other agent sees the question only as context. Pure helpers so all three
 * composers (BottomPanel, MobileChat, Timeline interject) share one behavior.
 */

export interface AddressableAgent {
  id: string;
  name: string;
}

/** Agents the user may address: enabled, non-terminal (terminal kinds only speak in wrap-up). */
export function addressableAgents(agents: readonly Agent[]): AddressableAgent[] {
  return agents
    .filter((a) => a.runtime.enabled && !isTerminalKind(a.kind) && a.name.trim())
    .map((a) => ({ id: a.id, name: a.name.trim() }));
}

/**
 * Parse a leading `@Name` mention. Case-insensitive; names may contain spaces,
 * so the LONGEST matching name wins ("@Dr. Ada Lovelace what…" over "@Dr. Ada").
 * Returns null when no addressable agent matches the leading token.
 */
export function parseMention(
  text: string,
  agents: readonly AddressableAgent[],
): { target: AddressableAgent; message: string } | null {
  if (!text.startsWith('@')) return null;
  const rest = text.slice(1);
  const lower = rest.toLowerCase();
  let best: AddressableAgent | null = null;
  for (const a of agents) {
    const n = a.name.toLowerCase();
    const boundary = rest[n.length];
    if (lower === n || (lower.startsWith(n) && (boundary === undefined || /[\s,:]/.test(boundary)))) {
      if (!best || a.name.length > best.name.length) best = a;
    }
  }
  if (!best) return null;
  return { target: best, message: rest.slice(best.name.length).replace(/^[\s,:]+/, '').trim() };
}

/**
 * Name suggestions while the user is typing a leading `@` token that doesn't
 * fully match yet. Empty once a mention parses (the chip takes over).
 */
export function mentionSuggestions(
  text: string,
  agents: readonly AddressableAgent[],
): AddressableAgent[] {
  if (!text.startsWith('@') || parseMention(text, agents)) return [];
  const partial = text.slice(1).toLowerCase();
  return agents.filter((a) => a.name.toLowerCase().startsWith(partial)).slice(0, 6);
}
