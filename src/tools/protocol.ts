import { z } from 'zod';
import { parseJsonObject } from '../agents/generateAgent';
import { extractInlineThinking } from '../providers/openaiAdapter';
import type { ToolDefinition } from './types';

/**
 * Text-based tool-invocation protocol. The app deliberately avoids native
 * function-calling (the provider layer must work with any OpenAI-compatible
 * endpoint, many of which lack or mangle `tools` support), so an agent invokes
 * a tool by ending its message with one fenced block:
 *
 *   ```tool
 *   {"tool": "wikipedia_search", "input": {"query": "graphene"}}
 *   ```
 *
 * The orchestrator detects the block, executes the tool, feeds the result back
 * as a user message, and re-calls the model — a bounded loop.
 */

/** Max tool executions per agent turn (≤ MAX_TOOL_ROUNDS + 1 model calls). */
export const MAX_TOOL_ROUNDS = 3;

const TOOL_FENCE_RE = /```tool[^\S\n]*\n([\s\S]*?)```/;

const CallShape = z.object({ tool: z.string(), input: z.unknown() });

export type DetectedToolCall =
  | { kind: 'call'; def: ToolDefinition; input: unknown }
  /** A malformed attempt — still consumes a round; `error` is fed back as the result. */
  | { kind: 'error'; error: string };

/**
 * Detect a tool invocation in a model response. Returns null when the message
 * contains no tool fence (i.e. it is a final answer). Reasoning is stripped
 * first so a fence inside <think> blocks never executes; only the FIRST fence
 * counts (one call per round).
 */
export function detectToolCall(
  text: string,
  enabledTools: readonly ToolDefinition[],
): DetectedToolCall | null {
  const visible = extractInlineThinking(text).text;
  const match = visible.match(TOOL_FENCE_RE);
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = parseJsonObject(match[1]);
  } catch {
    return { kind: 'error', error: 'ERROR: the tool block did not contain valid JSON. Expected {"tool": "<name>", "input": {…}}.' };
  }

  const shape = CallShape.safeParse(parsed);
  if (!shape.success) {
    return { kind: 'error', error: 'ERROR: the tool block must be {"tool": "<name>", "input": {…}}.' };
  }

  const def = enabledTools.find((t) => t.id === shape.data.tool);
  if (!def) {
    const available = enabledTools.map((t) => t.id).join(', ') || '(none)';
    return { kind: 'error', error: `ERROR: unknown tool "${shape.data.tool}". Available tools: ${available}.` };
  }

  const input = def.inputSchema.safeParse(shape.data.input);
  if (!input.success) {
    const issues = input.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
    return { kind: 'error', error: `ERROR: invalid input for ${def.id} (${issues}). Expected ${def.inputHint}.` };
  }

  return { kind: 'call', def, input: input.data };
}

/** Remove every tool fence from a final answer (used when the budget forces an answer). */
export function stripToolFences(text: string): string {
  return text.replace(new RegExp(TOOL_FENCE_RE.source, 'g'), '').trim();
}

/** The user-role message that carries a tool result back into the loop. */
export function toolResultMessage(toolId: string, resultText: string, remaining: number): string {
  const coach =
    remaining > 0
      ? `(${remaining} tool call${remaining === 1 ? '' : 's'} remaining this turn. If you have enough information, write your final answer now, citing the sources above. Do not repeat an identical call.)`
      : '(You have no tool calls left this turn. Write your final answer now using the information gathered — do not emit another tool block.)';
  return `[tool_result: ${toolId}]\n${resultText}\n\n${coach}`;
}

/** System-prompt section describing the agent's executable tools and the exact protocol. */
export function buildToolProtocolSection(tools: readonly ToolDefinition[]): string {
  const list = tools.map((t) => `- ${t.id} — ${t.description} Input: ${t.inputHint}`).join('\n');
  return [
    'You have real, executable tools. Available tools:',
    list,
    '',
    'To call a tool, end your message with exactly one fenced block in this exact form:',
    '```tool',
    `{"tool": "${tools[0].id}", "input": ${tools[0].inputHint.replace(/\bstring\b/g, '"example"')}}`,
    '```',
    `Rules: at most one tool block per message and at most ${MAX_TOOL_ROUNDS} tool calls per turn. After emitting a tool block, stop writing — the result arrives in the next message as [tool_result: <name>]. When you have enough information, write your final answer WITHOUT any tool block and cite each fact's source (title and URL/DOI) exactly as the tool returned it. Never invent tool results or citations; if the tools return nothing useful, say so explicitly.`,
  ].join('\n');
}
