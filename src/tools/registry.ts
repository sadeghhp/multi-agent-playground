import { calculatorTool } from './calculator';
import { crossrefSearchTool } from './crossref';
import { tavilyKey, webSearchTool } from './tavily';
import { toolSignal, type ToolDefinition } from './types';
import { wikipediaPageTool, wikipediaSearchTool } from './wikipedia';

/** All embedded tools, keyed by id. The only source of executable capability. */
export const TOOLS: Record<string, ToolDefinition> = Object.fromEntries(
  [wikipediaSearchTool, wikipediaPageTool, crossrefSearchTool, calculatorTool, webSearchTool].map(
    (t) => [t.id, t as ToolDefinition],
  ),
);

/** True when a tool is usable right now (keyed tools need their key present). */
export function toolAvailable(id: string): boolean {
  if (!(id in TOOLS)) return false;
  if (id === webSearchTool.id) return Boolean(tavilyKey());
  return true;
}

/**
 * The tools an agent can actually invoke: its selected ids ∩ the registry,
 * minus keyed tools whose key is missing. Unknown ids are silently ignored
 * (validate.ts warns about them).
 */
export function resolveTools(toolIds: readonly string[]): ToolDefinition[] {
  return toolIds.filter(toolAvailable).map((id) => TOOLS[id]);
}

export interface ToolExecutionResult {
  ok: boolean;
  text: string;
  durationMs: number;
}

/**
 * Execute a validated tool call. Never throws except on run abort: failures
 * (HTTP errors, timeout, offline) come back as `ERROR: …` text the model can
 * react to, and the per-tool timeout bounds a hung endpoint.
 */
export async function executeToolCall(
  def: ToolDefinition,
  input: unknown,
  runSignal: AbortSignal,
): Promise<ToolExecutionResult> {
  const started = performance.now();
  try {
    const text = await def.execute(input, toolSignal(runSignal));
    return { ok: !text.startsWith('ERROR:'), text, durationMs: Math.round(performance.now() - started) };
  } catch (err) {
    if (runSignal.aborted) throw err;
    const message = err instanceof Error ? err.message : String(err);
    const timedOut = err instanceof DOMException && err.name === 'TimeoutError';
    return {
      ok: false,
      text: `ERROR: ${timedOut ? `${def.name} timed out.` : message}`,
      durationMs: Math.round(performance.now() - started),
    };
  }
}
