import type { ColorCategory } from '../domain/schema';

/**
 * Agent identity colors keyed by category. These MUST stay in sync with the
 * `.color_<category>` accent stripes in `AgentNode.module.css` — the graph node
 * styles them via CSS classes; JS consumers (e.g. the conversation timeline)
 * read the same hex values from here so the two never diverge.
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
