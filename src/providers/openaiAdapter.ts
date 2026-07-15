import type { Provider } from '../domain/schema';
import {
  ProviderError,
  classifyStatus,
  safeReadErrorBody,
  summaryFor,
} from './errors';
import type {
  ChatRequestParams,
  NormalizedResponse,
} from './types';
import { validateEndpoint } from './url';
import { providerRequest } from './providerRequest';

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

  // Reasoning models and some compat servers put the visible answer elsewhere.
  for (const key of ['reasoning_content', 'reasoning', 'text']) {
    const v = message[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }

  // Allow empty string content when it was explicitly provided.
  if (typeof content === 'string') return content;

  return null;
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

/**
 * Some reasoning models (e.g. local DeepSeek-R1/QwQ-style servers) don't use a
 * separate `reasoning_content` field at all — they emit `<think>...</think>`
 * inline inside the normal content string. Strip it out so it never gets
 * treated as (or fed back to other agents as) the agent's visible reply.
 * A dangling unterminated `<think>` (output truncated mid-thought) is also
 * treated as reasoning through to the end of the string.
 */
function extractInlineThinking(raw: string): { text: string; reasoning: string } {
  if (!/<think>/i.test(raw)) return { text: raw, reasoning: '' };
  let reasoning = '';
  let text = raw.replace(/<think>([\s\S]*?)<\/think>/gi, (_, inner: string) => {
    reasoning += inner;
    return '';
  });
  const openIdx = text.search(/<think>/i);
  if (openIdx !== -1) {
    reasoning += text.slice(openIdx).replace(/<think>/i, '');
    text = text.slice(0, openIdx);
  }
  return { text: text.trim(), reasoning: reasoning.trim() };
}

function extractText(data: unknown): { text: string; finishReason: string | null } {
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
  if (text === null) {
    throw new ProviderError('unsupported-response', summaryFor('unsupported-response'), {
      detail:
        'Could not read assistant text from choices[0].message.content ' +
        '(expected a string, content-part array, or a reasoning/text fallback).',
    });
  }
  return {
    text,
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
      const err = json.error;
      const message =
        typeof err === 'string'
          ? err
          : typeof (err as { message?: unknown })?.message === 'string'
            ? (err as { message: string }).message
            : undefined;
      throw new ProviderError('server-error', summaryFor('server-error'), {
        detail: message ?? 'The provider returned an in-stream error.',
      });
    }
    if (typeof json.model === 'string') model = json.model;
    const choice = (json.choices as Array<Record<string, unknown>> | undefined)?.[0];
    if (choice) {
      const delta = (choice.delta as Record<string, unknown> | undefined) ?? {};
      const chunk = normalizeDeltaContent(delta.content);
      if (chunk.length > 0) {
        text += chunk;
        onToken(chunk);
      }
      const reasoningChunk = normalizeDeltaReasoning(delta);
      if (reasoningChunk.length > 0) {
        reasoning += reasoningChunk;
        onReasoningToken?.(reasoningChunk);
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
  // `stream` is widely supported; `stream_options` (usage-in-stream) is not, and
  // some local OpenAI-compatible servers 400 on it — so we don't send it. Token
  // counts are simply absent for streamed turns, which the UI already tolerates.
  if (options.onToken) body.stream = true;
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
    const kind = classifyStatus(response.status);
    const detail = await safeReadErrorBody(response);
    throw new ProviderError(kind, summaryFor(kind), { status: response.status, detail });
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
    return {
      text: cleanedText,
      ...(combinedReasoning ? { reasoning: combinedReasoning } : {}),
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

  const { text: rawText, finishReason } = extractText(data);
  const { text, reasoning: inlineReasoning } = extractInlineThinking(rawText);
  // Non-streaming provider (or one that ignored `stream`): surface the full text
  // once so streaming consumers still get a live update.
  if (options.onToken && text) options.onToken(text);
  const usage = extractUsage(data);
  const model =
    (data as { model?: unknown }).model && typeof (data as { model?: unknown }).model === 'string'
      ? ((data as { model: string }).model)
      : params.model;

  return {
    text,
    ...(inlineReasoning ? { reasoning: inlineReasoning } : {}),
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
