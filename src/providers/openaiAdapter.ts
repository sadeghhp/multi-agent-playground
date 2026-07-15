import type { Provider } from '../domain/schema';
import {
  ProviderError,
  providerErrorFromPayload,
  providerErrorFromResponse,
  summaryFor,
} from './errors';
import type {
  ChatRequestParams,
  NormalizedResponse,
} from './types';
import { validateEndpoint } from './url';
import { providerRequest } from './providerRequest';
import { supportsStreamUsage } from '../usage/fallback';

/**
 * OpenAI-compatible chat-completions adapter (spec §17). The single place that
 * knows the wire format. Everything else speaks ChatMessage / NormalizedResponse.
 */

function buildBody(params: ChatRequestParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
  };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.maxOutputTokens !== undefined) body.max_tokens = params.maxOutputTokens;
  if (params.topP !== undefined) body.top_p = params.topP;
  if (params.seed !== undefined) body.seed = params.seed;
  if (params.stopSequences && params.stopSequences.length > 0) body.stop = params.stopSequences;
  return body;
}

function joinContentParts(parts: unknown[]): string {
  const texts: string[] = [];
  for (const part of parts) {
    if (typeof part === 'string') texts.push(part);
    else if (part && typeof part === 'object') {
      const p = part as Record<string, unknown>;
      if (typeof p.text === 'string') texts.push(p.text);
      else if (typeof p.content === 'string') texts.push(p.content);
    }
  }
  return texts.join('');
}

/** Normalize assistant text from OpenAI-compatible message shapes. */
function normalizeMessageContent(message: Record<string, unknown> | undefined): string | null {
  if (!message) return null;

  const content = message.content;

  if (typeof content === 'string') {
    if (content.length > 0) return content;
  } else if (Array.isArray(content)) {
    const joined = joinContentParts(content);
    if (joined.length > 0) return joined;
  } else if (content && typeof content === 'object') {
    const text = (content as { text?: unknown }).text;
    if (typeof text === 'string' && text.length > 0) return text;
  }

  // Some compat servers put the visible answer on `text` instead of `content`.
  // Do NOT fall back to `reasoning_content` here — that is thinking, not the
  // answer (captured separately via extractMessageReasoning).
  if (typeof message.text === 'string' && message.text.length > 0) return message.text;

  // Allow empty string content when it was explicitly provided.
  if (typeof content === 'string') return content;

  return null;
}

/** Reasoning field on a finished assistant message (non-streaming). */
function extractMessageReasoning(message: Record<string, unknown> | undefined): string {
  if (!message) return '';
  for (const key of ['reasoning_content', 'reasoning']) {
    const v = message[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

function normalizeDeltaContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return joinContentParts(content);
  if (content && typeof content === 'object') {
    const text = (content as { text?: unknown }).text;
    if (typeof text === 'string') return text;
  }
  return '';
}

/** Reasoning models stream thinking tokens under one of these delta keys, separate from `content`. */
function normalizeDeltaReasoning(delta: Record<string, unknown>): string {
  for (const key of ['reasoning_content', 'reasoning']) {
    const v = delta[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

const THINK_TAG = 'think|thinking|reasoning';

/**
 * Some reasoning models (e.g. local DeepSeek-R1/Qwen-style servers) don't use a
 * separate `reasoning_content` field at all — they emit thinking inline inside
 * the normal content string. Strip it out so it never gets treated as (or fed
 * back to other agents as) the agent's visible reply.
 *
 * Handles:
 * - Paired `<think>...</think>` (also `thinking` / `reasoning` tag names)
 * - Dangling open tag (truncated mid-thought → rest is reasoning)
 * - Closing tag only (Qwen chat templates pre-fill the open tag in the prompt,
 *   so the model often emits only `...</think>answer`)
 */
export function extractInlineThinking(raw: string): { text: string; reasoning: string } {
  if (!new RegExp(`</?(?:${THINK_TAG})\\b`, 'i').test(raw)) {
    return { text: raw, reasoning: '' };
  }

  let reasoning = '';
  let text = raw.replace(
    new RegExp(`<(${THINK_TAG})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, 'gi'),
    (_match, _tag: string, inner: string) => {
      reasoning += inner;
      return '';
    },
  );

  const openRe = new RegExp(`<(${THINK_TAG})\\b[^>]*>`, 'i');
  const openMatch = openRe.exec(text);
  if (openMatch && openMatch.index !== undefined) {
    reasoning += text.slice(openMatch.index).replace(openRe, '');
    text = text.slice(0, openMatch.index);
  }

  // Qwen: open tag was in the prompt; model emits only the closer.
  const closeRe = new RegExp(`<\\/(?:${THINK_TAG})\\s*>`, 'i');
  const closeMatch = closeRe.exec(text);
  if (closeMatch && closeMatch.index !== undefined) {
    reasoning += text.slice(0, closeMatch.index);
    text = text.slice(closeMatch.index + closeMatch[0].length);
  }

  return { text: text.trim(), reasoning: reasoning.trim() };
}

/**
 * Some gateways put the whole tagged reply (`<think>…</think>answer`) into the
 * reasoning channel and leave `content` empty. When that happens, promote the
 * post-tag answer into `text` so the UI body is not blank. Pure untagged CoT is
 * left in `reasoning` (never dumped into the answer body).
 */
export function promoteTaggedAnswerFromReasoning(
  text: string,
  reasoning: string,
): { text: string; reasoning: string } {
  if (text.trim() || !reasoning) return { text, reasoning };
  if (!new RegExp(`</?(?:${THINK_TAG})\\b`, 'i').test(reasoning)) {
    return { text, reasoning };
  }
  const split = extractInlineThinking(reasoning);
  if (!split.text) return { text, reasoning };
  return { text: split.text, reasoning: split.reasoning };
}

function extractText(data: unknown): { text: string; reasoning: string; finishReason: string | null } {
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ProviderError('unsupported-response', summaryFor('unsupported-response'), {
      detail: 'Response contained no choices array.',
    });
  }
  const first = choices[0] as {
    message?: Record<string, unknown>;
    finish_reason?: unknown;
    text?: unknown;
  };

  let text = normalizeMessageContent(first.message);
  if (text === null && typeof first.text === 'string') {
    text = first.text;
  }
  const reasoning = extractMessageReasoning(first.message);
  // Reasoning-only reply (content null/absent, reasoning_content set): treat as
  // empty visible text with reasoning captured — same shape as the stream path.
  if (text === null && reasoning) {
    return {
      text: '',
      reasoning,
      finishReason: typeof first.finish_reason === 'string' ? first.finish_reason : null,
    };
  }
  if (text === null) {
    throw new ProviderError('unsupported-response', summaryFor('unsupported-response'), {
      detail:
        'Could not read assistant text from choices[0].message.content ' +
        '(expected a string, content-part array, or a reasoning/text fallback).',
    });
  }
  return {
    text,
    reasoning,
    finishReason: typeof first.finish_reason === 'string' ? first.finish_reason : null,
  };
}

function extractUsage(data: unknown): Pick<NormalizedResponse, 'promptTokens' | 'completionTokens' | 'totalTokens'> {
  const usage = (data as { usage?: Record<string, unknown> }).usage;
  if (!usage) return {};
  const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
  return {
    promptTokens: num(usage.prompt_tokens),
    completionTokens: num(usage.completion_tokens),
    totalTokens: num(usage.total_tokens),
  };
}

export interface SendOptions {
  signal?: AbortSignal;
  /** Overrides provider.timeoutMs when present. */
  timeoutMs?: number;
  /**
   * When provided, request a streamed response and invoke this for each text
   * delta as it arrives. Providers that ignore `stream` and return a normal
   * JSON body still work — the full text is emitted once (spec §17).
   */
  onToken?: (chunk: string) => void;
  /**
   * When provided, invoked for each reasoning/thinking delta a reasoning model
   * streams separately from its visible `content` (e.g. `delta.reasoning_content`).
   * Reasoning models can spend their entire token budget here before emitting
   * any content, so callers that only watch onToken see nothing arrive.
   */
  onReasoningToken?: (chunk: string) => void;
}

/** Parse an OpenAI-compatible SSE stream, emitting each content delta via onToken. */
async function consumeStream(
  response: Response,
  onToken: (chunk: string) => void,
  resetTimeout: () => void,
  onReasoningToken?: (chunk: string) => void,
): Promise<{ text: string; reasoning: string; finishReason: string | null; model?: string; usage: ReturnType<typeof extractUsage> }> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new ProviderError('malformed-response', summaryFor('malformed-response'), {
      detail: 'Streamed response had no readable body.',
    });
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let reasoning = '';
  let finishReason: string | null = null;
  let model: string | undefined;
  let usage: ReturnType<typeof extractUsage> = {};

  const handleData = (payload: string) => {
    if (payload === '[DONE]') return;
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(payload) as Record<string, unknown>;
    } catch {
      return; // ignore keep-alives / partial noise
    }
    // Some OpenAI-compatible servers commit to HTTP 200 + text/event-stream
    // before they know the request will fail, then send the error in-band
    // instead of via the status code. Surface it instead of silently
    // returning a truncated/empty response as if it had succeeded.
    if (json.error !== undefined) {
      throw providerErrorFromPayload(json.error, { streamed: true });
    }
    if (typeof json.model === 'string') model = json.model;
    const choice = (json.choices as Array<Record<string, unknown>> | undefined)?.[0];
    if (choice) {
      const delta = (choice.delta as Record<string, unknown> | undefined) ?? {};
      // Prefer `content`; some compat servers stream the answer on `text`.
      let chunk = normalizeDeltaContent(delta.content);
      if (!chunk && typeof delta.text === 'string') chunk = delta.text;
      if (chunk.length > 0) {
        text += chunk;
        onToken(chunk);
      }
      const reasoningChunk = normalizeDeltaReasoning(delta);
      if (reasoningChunk.length > 0) {
        reasoning += reasoningChunk;
        onReasoningToken?.(reasoningChunk);
      }
      // Final/non-delta message form used by some gateways after reasoning deltas.
      const message = choice.message as Record<string, unknown> | undefined;
      if (message) {
        const msgText = normalizeMessageContent(message);
        if (msgText && !text) {
          text = msgText;
          onToken(msgText);
        }
        const msgReasoning = extractMessageReasoning(message);
        if (msgReasoning && !reasoning) {
          reasoning = msgReasoning;
          onReasoningToken?.(msgReasoning);
        }
      }
      if (typeof choice.finish_reason === 'string') finishReason = choice.finish_reason;
    }
    if (json.usage) usage = extractUsage(json);
  };

  const drainLines = () => {
    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('data:')) handleData(line.slice(5).trim());
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    // Each chunk received is activity — a connection that keeps sending data
    // (even keep-alives) must not be killed by the idle timeout, but one that
    // goes silent mid-stream still should be.
    resetTimeout();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    drainLines();
  }
  buffer += decoder.decode();
  drainLines();
  const tail = buffer.trim();
  if (tail.startsWith('data:')) handleData(tail.slice(5).trim());

  return { text, reasoning, finishReason, model, usage };
}

/**
 * Send one chat-completion request. Returns a NormalizedResponse or throws a
 * ProviderError. Never logs or returns the API key.
 */
export async function sendChat(
  provider: Provider,
  params: ChatRequestParams,
  options: SendOptions = {},
): Promise<NormalizedResponse> {
  const validation = validateEndpoint(provider.baseUrl);
  if (!validation.ok) {
    throw new ProviderError('invalid-url', validation.reason ?? summaryFor('invalid-url'));
  }

  const body = buildBody(params);
  // `stream` is widely supported; `stream_options.include_usage` is not (many
  // local servers 400 on it). Only request usage-in-stream for hosts known to
  // support it (OpenAI, OpenRouter).
  if (options.onToken) {
    body.stream = true;
    if (supportsStreamUsage(provider.baseUrl)) {
      body.stream_options = { include_usage: true };
    }
  }
  const { response, durationMs, resetTimeout, clearRequestTimeout, timeoutSignal } = await providerRequest(
    provider,
    provider.path,
    {
      method: 'POST',
      body,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    },
  );

  if (!response.ok) {
    clearRequestTimeout();
    throw await providerErrorFromResponse(response);
  }

  // Streaming path: parse SSE when the provider actually streamed. If it ignored
  // `stream` and returned JSON, fall through and emit the whole text once below.
  const contentType = response.headers.get('content-type') ?? '';
  if (options.onToken && contentType.includes('text/event-stream')) {
    const streamStart = Date.now();
    let streamed: Awaited<ReturnType<typeof consumeStream>>;
    try {
      streamed = await consumeStream(response, options.onToken, resetTimeout, options.onReasoningToken);
    } catch (err) {
      // The idle timeout aborts the same signal that fed the original fetch —
      // classify a mid-stream stall the same way providerRequest classifies a
      // time-to-first-byte timeout, instead of surfacing an opaque abort error.
      if (timeoutSignal.aborted) {
        throw new ProviderError('timeout', summaryFor('timeout'), {
          detail: 'The connection stalled mid-response (no data received before the timeout).',
        });
      }
      if (options.signal?.aborted) {
        throw new ProviderError('aborted', summaryFor('aborted'));
      }
      throw err;
    } finally {
      clearRequestTimeout();
    }
    const model = streamed.model ?? params.model;
    const { text: cleanedText, reasoning: inlineReasoning } = extractInlineThinking(streamed.text);
    const combinedReasoning = [streamed.reasoning, inlineReasoning].filter(Boolean).join('\n\n');
    const promoted = promoteTaggedAnswerFromReasoning(cleanedText, combinedReasoning);
    return {
      text: promoted.text,
      ...(promoted.reasoning ? { reasoning: promoted.reasoning } : {}),
      model,
      finishReason: streamed.finishReason,
      ...streamed.usage,
      raw: {
        streamed: true,
        model,
        choices: [{ message: { role: 'assistant', content: streamed.text }, finish_reason: streamed.finishReason }],
        usage: {
          prompt_tokens: streamed.usage.promptTokens,
          completion_tokens: streamed.usage.completionTokens,
          total_tokens: streamed.usage.totalTokens,
        },
      },
      durationMs: durationMs + (Date.now() - streamStart),
      status: response.status,
    };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ProviderError('malformed-response', summaryFor('malformed-response'), {
      status: response.status,
    });
  } finally {
    // Not streamed — the body is fully consumed by response.json() above (or
    // the attempt already failed), so the idle timeout has no more work to do.
    clearRequestTimeout();
  }

  const { text: rawText, reasoning: messageReasoning, finishReason } = extractText(data);
  const { text: cleanedText, reasoning: inlineReasoning } = extractInlineThinking(rawText);
  const combinedReasoning = [messageReasoning, inlineReasoning].filter(Boolean).join('\n\n');
  const { text, reasoning } = promoteTaggedAnswerFromReasoning(cleanedText, combinedReasoning);
  // Non-streaming provider (or one that ignored `stream`): surface the full text
  // once so streaming consumers still get a live update.
  if (options.onToken && text) options.onToken(text);
  if (options.onReasoningToken && reasoning) options.onReasoningToken(reasoning);
  const usage = extractUsage(data);
  const model =
    (data as { model?: unknown }).model && typeof (data as { model?: unknown }).model === 'string'
      ? ((data as { model: string }).model)
      : params.model;

  return {
    text,
    ...(reasoning ? { reasoning } : {}),
    model,
    finishReason,
    ...usage,
    raw: data,
    durationMs,
    status: response.status,
  };
}

// Re-export for callers that build URLs for logging.
export { buildEndpoint } from './url';
