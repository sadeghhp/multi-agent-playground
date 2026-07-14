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
