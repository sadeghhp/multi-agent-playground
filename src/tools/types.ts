import type { z } from 'zod';

/**
 * Executable tools (in contrast to Skills, which are declared capabilities
 * injected as prompt text only — see schema.ts). A tool is a browser-side
 * function an agent can invoke mid-turn through the text protocol in
 * protocol.ts. Every remote tool talks only to its own hardcoded host — the
 * model never supplies URLs.
 */
export interface ToolDefinition<I = unknown> {
  id: string;
  /** Human label, e.g. "Wikipedia search". Shown in the inspector and node status. */
  name: string;
  /** One line, used in both the system prompt and the inspector. */
  description: string;
  /** Compact input shape shown to the model, e.g. '{"query": string}'. */
  inputHint: string;
  inputSchema: z.ZodType<I>;
  /**
   * Run the tool. Returns compact, source-attributed text (every remote result
   * line carries its title + URL/DOI so agents cite by copy-through, not
   * recall). Throws only on abort; other failures return an `ERROR: …` string
   * via the executor wrapper.
   */
  execute(input: I, signal: AbortSignal): Promise<string>;
}

/** Hard cap applied to every tool result before it re-enters the model context. */
export const MAX_TOOL_RESULT_CHARS = 1500;

/** Per-tool-execution timeout. */
export const TOOL_TIMEOUT_MS = 10_000;

export function truncateResult(text: string): string {
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…(truncated)`;
}

/**
 * Combine the run's abort signal with the per-tool timeout so a hung endpoint
 * can never stall a turn for more than TOOL_TIMEOUT_MS.
 */
export function toolSignal(runSignal: AbortSignal): AbortSignal {
  return AbortSignal.any([runSignal, AbortSignal.timeout(TOOL_TIMEOUT_MS)]);
}

/** Strip HTML tags Wikipedia embeds in search excerpts (<span class="searchmatch">…). */
export function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}
