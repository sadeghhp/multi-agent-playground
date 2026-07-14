import type { ColorCategory } from '../domain/schema';

/**
 * Agent identity colors keyed by category. This is the single source of truth for
 * the agent palette: the graph node reads it via an inline `--agent-color` CSS
 * variable (see `AgentNode.tsx`), and other JS consumers (timeline, transcript,
 * minimap) call `agentColor()` — so there is no CSS/JS hand-syncing to drift.
 */
export const AGENT_COLORS: Record<ColorCategory, string> = {
  slate: '#64748b',
  blue: '#3b82f6',
  green: '#22c55e',
  amber: '#f59e0b',
  red: '#ef4444',
  violet: '#8b5cf6',
  teal: '#14b8a6',
};

/** Resolve a (possibly undefined/unknown) category to a hex color, defaulting to slate. */
export function agentColor(category: ColorCategory | null | undefined): string {
  return (category && AGENT_COLORS[category]) || AGENT_COLORS.slate;
}
