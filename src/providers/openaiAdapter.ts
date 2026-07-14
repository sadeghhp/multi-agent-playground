import type { Provider } from '../domain/schema';
import {
  ProviderError,
  classifyStatus,
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

function extractText(data: unknown): { text: string; finishReason: string | null } {
  const choices = (data as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new ProviderError('unsupported-response', summaryFor('unsupported-response'), {
      detail: 'Response contained no choices array.',
    });
  }
  const first = choices[0] as { message?: { content?: unknown }; finish_reason?: unknown };
  const content = first.message?.content;
  if (typeof content !== 'string') {
    throw new ProviderError('unsupported-response', summaryFor('unsupported-response'), {
      detail: 'choices[0].message.content was not a string.',
    });
  }
  return {
    text: content,
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
}

/** Parse an OpenAI-compatible SSE stream, emitting each content delta via onToken. */
async function consumeStream(
  response: Response,
  onToken: (chunk: string) => void,
): Promise<{ text: string; finishReason: string | null; model?: string; usage: ReturnType<typeof extractUsage> }> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new ProviderError('malformed-response', summaryFor('malformed-response'), {
      detail: 'Streamed response had no readable body.',
    });
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
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
    if (typeof json.model === 'string') model = json.model;
    const choice = (json.choices as Array<Record<string, unknown>> | undefined)?.[0];
    if (choice) {
      const delta = (choice.delta as { content?: unknown } | undefined)?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        text += delta;
        onToken(delta);
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
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    drainLines();
  }
  buffer += decoder.decode();
  drainLines();
  const tail = buffer.trim();
  if (tail.startsWith('data:')) handleData(tail.slice(5).trim());

  return { text, finishReason, model, usage };
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
  const { response, durationMs } = await providerRequest(provider, provider.path, {
    method: 'POST',
    body,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  });

  if (!response.ok) {
    const kind = classifyStatus(response.status);
    const detail = await safeReadErrorBody(response);
    throw new ProviderError(kind, summaryFor(kind), { status: response.status, detail });
  }

  // Streaming path: parse SSE when the provider actually streamed. If it ignored
  // `stream` and returned JSON, fall through and emit the whole text once below.
  const contentType = response.headers.get('content-type') ?? '';
  if (options.onToken && contentType.includes('text/event-stream')) {
    const streamStart = Date.now();
    const streamed = await consumeStream(response, options.onToken);
    const model = streamed.model ?? params.model;
    return {
      text: streamed.text,
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
  }

  const { text, finishReason } = extractText(data);
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
    model,
    finishReason,
    ...usage,
    raw: data,
    durationMs,
    status: response.status,
  };
}

async function safeReadErrorBody(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    try {
      const json = JSON.parse(text) as { error?: { message?: string } | string };
      if (json.error && typeof json.error === 'object' && json.error.message) {
        return json.error.message;
      }
      if (typeof json.error === 'string') return json.error;
    } catch {
      /* not JSON */
    }
    return text.slice(0, 500);
  } catch {
    return undefined;
  }
}

// Re-export for callers that build URLs for logging.
export { buildEndpoint } from './url';
