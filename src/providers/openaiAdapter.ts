import type { Provider } from '../domain/schema';
import {
  ProviderError,
  classifyStatus,
  classifyThrown,
  summaryFor,
} from './errors';
import type {
  ChatRequestParams,
  NormalizedResponse,
} from './types';
import { buildEndpoint, validateEndpoint } from './url';

/**
 * OpenAI-compatible chat-completions adapter (spec §17). The single place that
 * knows the wire format. Everything else speaks ChatMessage / NormalizedResponse.
 */

/** Headers the browser controls and that custom headers must never override (spec §21). */
const FORBIDDEN_HEADER_NAMES = new Set([
  'host',
  'origin',
  'referer',
  'content-length',
  'connection',
  'cookie',
  'user-agent',
  'accept-encoding',
]);

function buildHeaders(provider: Provider): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  // Custom headers first, so auth below always wins and forbidden names are dropped.
  for (const [name, value] of Object.entries(provider.customHeaders ?? {})) {
    if (FORBIDDEN_HEADER_NAMES.has(name.toLowerCase())) continue;
    headers[name] = value;
  }

  if (provider.authMethod === 'bearer' && provider.apiKey) {
    const prefix = provider.authPrefix ? `${provider.authPrefix} ` : '';
    headers[provider.authHeaderName || 'Authorization'] = `${prefix}${provider.apiKey}`;
  } else if (provider.authMethod === 'custom-header' && provider.apiKey) {
    const prefix = provider.authPrefix ? `${provider.authPrefix} ` : '';
    headers[provider.authHeaderName || 'Authorization'] = `${prefix}${provider.apiKey}`;
  }
  return headers;
}

function buildBody(params: ChatRequestParams): Record<string, unknown> {
  // Omit unsupported/undefined fields rather than sending them blindly (spec §7.2).
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

  const endpoint = buildEndpoint(provider.baseUrl, provider.path);
  const headers = buildHeaders(provider);
  const body = buildBody(params);

  const timeoutMs = options.timeoutMs ?? provider.timeoutMs ?? 60_000;

  // Combine caller cancellation (Stop button) with a timeout (spec §11.4, §14).
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(new DOMException('Request timed out', 'TimeoutError')),
    timeoutMs,
  );
  const signal = mergeSignals(options.signal, timeoutController.signal);

  const start = Date.now();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    // If the caller aborted, report aborted rather than CORS.
    if (options.signal?.aborted) {
      throw new ProviderError('aborted', summaryFor('aborted'));
    }
    if (timeoutController.signal.aborted) {
      throw new ProviderError('timeout', summaryFor('timeout'));
    }
    throw classifyThrown(err);
  }
  clearTimeout(timeoutId);

  const durationMs = Date.now() - start;

  if (!response.ok) {
    const kind = classifyStatus(response.status);
    const detail = await safeReadErrorBody(response);
    throw new ProviderError(kind, summaryFor(kind), { status: response.status, detail });
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

/** Read an error response body for diagnostics without ever throwing. */
async function safeReadErrorBody(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    // Prefer a message field if present, else truncate raw text.
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

/** Merge up to two AbortSignals into one (native AbortSignal.any where available). */
function mergeSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  const AnyCtor = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof AnyCtor === 'function') return AnyCtor([a, b]);
  // Fallback: propagate whichever aborts first.
  const controller = new AbortController();
  const onAbort = (reason: unknown) => controller.abort(reason);
  if (a.aborted) controller.abort(a.reason);
  else a.addEventListener('abort', () => onAbort(a.reason), { once: true });
  if (b.aborted) controller.abort(b.reason);
  else b.addEventListener('abort', () => onAbort(b.reason), { once: true });
  return controller.signal;
}
