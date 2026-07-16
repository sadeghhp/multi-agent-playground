/**
 * Provider error taxonomy (spec §8.3, §20). In a browser-only product CORS
 * failures are common and otherwise indistinguishable from network errors, so
 * classifying them precisely is essential.
 */

export type ProviderErrorKind =
  | 'invalid-url'
  | 'cors'
  | 'private-network'
  | 'insecure-remote'
  | 'network'
  | 'auth'
  | 'model-not-found'
  | 'bad-request'
  | 'rate-limit'
  | 'malformed-response'
  | 'timeout'
  | 'unsupported-response'
  | 'server-error'
  | 'aborted'
  | 'unknown';

const RAW_UPSTREAM_MAX = 500;

// Signals of a client/argument problem (context overflow, bad params) that a
// gateway sometimes wraps in a 5xx or an in-band SSE error with no status. Kept
// deliberately specific: a bare "token" (e.g. "token service unavailable") is a
// transient server-side message, and re-tagging it 'bad-request' would wrongly
// flip a retry-eligible failure to non-retryable.
const CLIENT_ARG_RE =
  /invalid argument|context length|context window|maximum context|max_tokens|token limit|too many tokens|maximum .*tokens/i;

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  /** Human-facing hint about how to resolve (spec §20 "technical details"). */
  readonly detail?: string;
  /** OpenRouter-style `error.metadata.error_type`, when present. */
  readonly errorType?: string;
  /** OpenRouter-style `error.metadata.provider_code`, when present. */
  readonly providerCode?: string;
  /** Upstream/provider raw body (`error.metadata.raw`), truncated. */
  readonly rawUpstream?: string;
  /** True when the error arrived in-band on an SSE stream after HTTP 200. */
  readonly streamed?: boolean;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    opts: {
      status?: number;
      detail?: string;
      errorType?: string;
      providerCode?: string;
      rawUpstream?: string;
      streamed?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = opts.status;
    this.detail = opts.detail;
    this.errorType = opts.errorType;
    this.providerCode = opts.providerCode;
    this.rawUpstream = opts.rawUpstream;
    this.streamed = opts.streamed;
  }
}

const KIND_SUMMARY: Record<ProviderErrorKind, string> = {
  'invalid-url': 'The provider URL is invalid.',
  cors: 'The provider blocked this browser-origin request (CORS).',
  'private-network':
    'Browsers block public websites from reaching localhost or your local network.',
  'insecure-remote': 'Remote endpoints must use HTTPS. HTTP is only allowed for localhost.',
  network: 'Could not reach the provider (network error).',
  auth: 'Authentication failed. Check the API key and auth header.',
  'model-not-found': 'The requested model was not found on this provider.',
  'bad-request': 'The provider rejected the request (check the model and parameters).',
  'rate-limit': 'The provider rate-limited this request.',
  'malformed-response': 'The provider response could not be parsed.',
  timeout: 'The request timed out.',
  'unsupported-response': 'The provider returned an unsupported response shape.',
  'server-error': 'The provider returned a server error.',
  aborted: 'The request was cancelled.',
  unknown: 'An unknown provider error occurred.',
};

export function summaryFor(kind: ProviderErrorKind): string {
  return KIND_SUMMARY[kind];
}

/**
 * Classify an HTTP status code into an error kind (spec §8.3). Called after we
 * have a response but status is not OK.
 */
export function classifyStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'model-not-found';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate-limit';
  if (status >= 500) return 'server-error';
  // Other 4xx (400/402/409/413/422, …) are client errors: a retry with the same
  // request can't succeed, so classify them as non-retryable rather than server-error.
  if (status >= 400) return 'bad-request';
  return 'server-error';
}

/**
 * Classify a thrown fetch error (no HTTP response was received).
 *
 * A browser fetch that is blocked by CORS rejects with a TypeError whose
 * message is typically "Failed to fetch" (Chrome) / "NetworkError when
 * attempting to fetch resource" (Firefox) / "Load failed" (Safari) — the SAME
 * error the browser throws for a genuinely unreachable host. We cannot tell
 * them apart from JS alone, so we classify these as `cors` and surface guidance
 * that covers both causes, because CORS is the more common and more confusing
 * one in this product (spec §4.1, §8.3).
 */
export function classifyThrown(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;

  if (err instanceof DOMException && err.name === 'AbortError') {
    return new ProviderError('aborted', summaryFor('aborted'));
  }
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    return new ProviderError('timeout', summaryFor('timeout'));
  }

  if (err instanceof TypeError) {
    const msg = err.message || '';
    // The opaque browser fetch failure — most often CORS in this product.
    if (
      /failed to fetch|networkerror|load failed|fetch resource/i.test(msg)
    ) {
      return new ProviderError('cors', summaryFor('cors'), {
        detail:
          'The browser blocked the request before a response was received. ' +
          'This usually means the provider did not allow cross-origin (CORS) ' +
          'requests from this page, but can also mean the host is unreachable. ' +
          'Providers built for server-to-server use often cannot be called ' +
          'directly from a browser. Under `npm run dev`, remote HTTPS endpoints ' +
          'are routed through a local proxy automatically; production (including ' +
          'GitHub Pages) requires CORS from the provider itself.',
      });
    }
    return new ProviderError('network', summaryFor('network'), {
      detail: msg,
    });
  }

  const message = err instanceof Error ? err.message : String(err);
  return new ProviderError('unknown', summaryFor('unknown'), { detail: message });
}

export function retryEligible(kind: ProviderErrorKind): boolean {
  return kind === 'rate-limit' || kind === 'timeout' || kind === 'server-error' || kind === 'network';
}

/** Normalized fields from an OpenAI/OpenRouter-compatible `error` object. */
export interface ParsedProviderErrorPayload {
  message?: string;
  status?: number;
  errorType?: string;
  providerCode?: string;
  rawUpstream?: string;
}

function truncateRaw(value: string): string {
  return value.length > RAW_UPSTREAM_MAX ? value.slice(0, RAW_UPSTREAM_MAX) : value;
}

function coerceStatusCode(code: unknown): number | undefined {
  if (typeof code === 'number' && Number.isFinite(code)) return code;
  if (typeof code === 'string' && /^\d+$/.test(code.trim())) return Number(code.trim());
  return undefined;
}

/**
 * Normalize an OpenAI/OpenRouter `error` field from a JSON body or SSE chunk
 * into structured fields used for classification and diagnostics.
 */
export function parseProviderErrorPayload(error: unknown): ParsedProviderErrorPayload {
  if (typeof error === 'string') {
    return { message: error };
  }
  if (!error || typeof error !== 'object') {
    return {};
  }
  const obj = error as Record<string, unknown>;
  const message = typeof obj.message === 'string' ? obj.message : undefined;
  const status = coerceStatusCode(obj.code) ?? coerceStatusCode(obj.status);
  const metadata =
    obj.metadata && typeof obj.metadata === 'object'
      ? (obj.metadata as Record<string, unknown>)
      : undefined;
  const errorType =
    typeof metadata?.error_type === 'string'
      ? metadata.error_type
      : typeof obj.error_type === 'string'
        ? obj.error_type
        : undefined;
  const providerCode =
    typeof metadata?.provider_code === 'string'
      ? metadata.provider_code
      : typeof obj.provider_code === 'string'
        ? obj.provider_code
        : undefined;
  let rawUpstream: string | undefined;
  if (typeof metadata?.raw === 'string') {
    rawUpstream = truncateRaw(metadata.raw);
  } else if (metadata?.raw && typeof metadata.raw === 'object') {
    try {
      rawUpstream = truncateRaw(JSON.stringify(metadata.raw));
    } catch {
      /* ignore */
    }
  }
  return { message, status, errorType, providerCode, rawUpstream };
}

/**
 * Build a ProviderError from a parsed payload (HTTP body or in-band SSE).
 * Uses `error.code` for classification when present; overrides to `bad-request`
 * when upstream raw text clearly indicates a client/argument problem wrapped
 * in a gateway 5xx (common OpenRouter + Gemini pattern).
 */
export function providerErrorFromPayload(
  error: unknown,
  opts: { streamed?: boolean; fallbackStatus?: number } = {},
): ProviderError {
  const parsed = parseProviderErrorPayload(error);
  const status = parsed.status ?? opts.fallbackStatus;
  let kind = status !== undefined ? classifyStatus(status) : 'server-error';
  const signals = [parsed.message, parsed.rawUpstream, parsed.errorType]
    .filter(Boolean)
    .join(' ');
  if (CLIENT_ARG_RE.test(signals) && (kind === 'server-error' || status === undefined)) {
    kind = 'bad-request';
  }
  const detail =
    parsed.message ??
    (opts.streamed
      ? 'The provider returned an in-stream error.'
      : summaryFor(kind));
  return new ProviderError(kind, summaryFor(kind), {
    status,
    detail,
    errorType: parsed.errorType,
    providerCode: parsed.providerCode,
    rawUpstream: parsed.rawUpstream,
    streamed: opts.streamed,
  });
}

/**
 * Single string for transcript / Errors tab. Prefer the upstream raw cause when
 * the gateway wrapped it (e.g. "JSON error injected into SSE stream").
 */
export function formatProviderErrorDetail(pe: ProviderError): string {
  const primary = pe.rawUpstream?.trim() || pe.detail?.trim() || pe.message;
  const bits = [pe.message];
  if (primary && primary !== pe.message) bits.push(`(${primary})`);
  if (pe.streamed && !/in-stream|SSE|stream/i.test(bits.join(' '))) {
    bits.push('(mid-stream)');
  }
  return bits.join(' ');
}

export interface TroubleshootingContext {
  promptChars?: number;
  maxOutputTokens?: number;
  includeHistory?: boolean;
}

/** Deterministic, short troubleshooting tips for the failure panel (max 4). */
export function troubleshootingHints(
  pe: ProviderError | { kind: ProviderErrorKind; streamed?: boolean; rawUpstream?: string },
  ctx: TroubleshootingContext = {},
): string[] {
  const hints: string[] = [];
  const kind = pe.kind;
  const streamed = 'streamed' in pe ? pe.streamed : undefined;
  const raw = 'rawUpstream' in pe ? pe.rawUpstream : undefined;

  if (kind === 'bad-request') {
    if ((ctx.promptChars ?? 0) > 12_000) {
      hints.push('Reduce History window or disable Include history for this agent.');
    }
    if ((ctx.maxOutputTokens ?? 0) >= 4096) {
      hints.push('Lower Max output tokens (try 2048).');
    }
    if (CLIENT_ARG_RE.test(raw ?? '')) {
      hints.push('Check the request params and prompt size against this model\'s limits.');
    } else if (hints.length === 0) {
      hints.push('Check the model name and request parameters, then retry with a smaller prompt.');
    }
  } else if (kind === 'rate-limit') {
    hints.push('Wait briefly and retry; check the provider quota.');
  } else if (kind === 'timeout') {
    hints.push('Increase the response timeout or retry the turn.');
  } else if (kind === 'server-error') {
    if (streamed) {
      hints.push('Retry this turn, or switch model; check the provider status page.');
    } else {
      hints.push('Retry the request; if it keeps failing, switch model or provider.');
    }
  } else if (kind === 'auth') {
    hints.push('Verify the API key in Provider settings.');
  } else if (kind === 'private-network') {
    hints.push(
      'Run the app locally with `npm run dev` at http://localhost:5173 to use Ollama or LM Studio.',
    );
    hints.push(
      'Or switch the provider to a public HTTPS API that allows browser CORS (not localhost).',
    );
  } else if (kind === 'insecure-remote') {
    hints.push('Change the provider base URL to https://…');
    hints.push('HTTP is only allowed for localhost development endpoints.');
  } else if (kind === 'cors') {
    hints.push(
      'This provider must allow CORS from this page, or you must call it from `npm run dev` (dev proxy).',
    );
    hints.push(
      'Providers built for server-to-server use often cannot be called from a browser-only app.',
    );
  } else if (kind === 'model-not-found') {
    hints.push('Pick a model this provider lists under Fetch models.');
  } else if (kind === 'network') {
    hints.push('Check network/VPN access and the provider base URL.');
  }

  if (ctx.includeHistory === false && kind === 'bad-request' && (ctx.promptChars ?? 0) > 12_000) {
    // Already covered by the history hint when includeHistory is unknown/true;
    // if history is off, the system+task alone is large — still suggest shortening.
    if (!hints.some((h) => /History|Include history/i.test(h))) {
      hints.push('Shorten the system instruction, subject, or objective — the prompt is very large.');
    }
  }

  return hints.slice(0, 4);
}

/** Best-effort extraction of a human-readable message from an error response body. */
export async function safeReadErrorBody(response: Response): Promise<string | undefined> {
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

/**
 * Read an error response body and return both a ProviderError (when JSON) and
 * the raw text fallback. Prefer this over safeReadErrorBody when structured
 * metadata should be preserved.
 */
export async function providerErrorFromResponse(response: Response): Promise<ProviderError> {
  const kind = classifyStatus(response.status);
  try {
    const text = await response.text();
    if (!text) {
      return new ProviderError(kind, summaryFor(kind), { status: response.status });
    }
    try {
      const json = JSON.parse(text) as { error?: unknown };
      if (json.error !== undefined) {
        return providerErrorFromPayload(json.error, { fallbackStatus: response.status });
      }
    } catch {
      /* not JSON */
    }
    return new ProviderError(kind, summaryFor(kind), {
      status: response.status,
      detail: text.slice(0, 500),
    });
  } catch {
    return new ProviderError(kind, summaryFor(kind), { status: response.status });
  }
}
