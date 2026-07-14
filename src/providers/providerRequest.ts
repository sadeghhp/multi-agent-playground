import type { Provider } from '../domain/schema';
import { ProviderError, classifyThrown, summaryFor } from './errors';
import { buildEndpoint, validateEndpoint } from './url';
import { DEV_PROXY_TARGET_HEADER, resolveFetchTarget } from './devProxy';

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

/** The header the API key is written to, falling back to Authorization if the
 * configured name is one the browser controls or the transport forbids. */
function resolveAuthHeaderName(provider: Provider): string {
  const configured = provider.authHeaderName?.trim();
  if (!configured || FORBIDDEN_HEADER_NAMES.has(configured.toLowerCase())) return 'Authorization';
  return configured;
}

export function buildProviderHeaders(provider: Provider, jsonBody = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (jsonBody) headers['Content-Type'] = 'application/json';

  for (const [name, value] of Object.entries(provider.customHeaders ?? {})) {
    if (FORBIDDEN_HEADER_NAMES.has(name.toLowerCase())) continue;
    headers[name] = value;
  }

  if (provider.authMethod === 'bearer' && provider.apiKey) {
    // Bearer defaults to the "Bearer" scheme prefix; a set authPrefix overrides it.
    const prefix = provider.authPrefix?.trim() ? `${provider.authPrefix.trim()} ` : 'Bearer ';
    headers[resolveAuthHeaderName(provider)] = `${prefix}${provider.apiKey}`;
  } else if (provider.authMethod === 'custom-header' && provider.apiKey) {
    // Custom-header schemes (e.g. `x-api-key`) carry the raw key with NO prefix by
    // default; only prepend one when the user explicitly set an authPrefix.
    const prefix = provider.authPrefix?.trim() ? `${provider.authPrefix.trim()} ` : '';
    headers[resolveAuthHeaderName(provider)] = `${prefix}${provider.apiKey}`;
  }
  return headers;
}

export interface ProviderRequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * Fetch a provider endpoint with dev-proxy routing, auth headers, and timeout.
 * Throws ProviderError on failure.
 */
export interface ProviderRequestResult {
  response: Response;
  durationMs: number;
  /**
   * Re-arms the idle timeout for `timeoutMs` from now. Callers streaming the
   * response body should call this on every chunk received so a connection
   * that keeps sending data is never killed, while one that goes silent still
   * gets aborted instead of hanging forever.
   */
  resetTimeout: () => void;
  /** Permanently cancels the idle timeout once the response is fully consumed. */
  clearRequestTimeout: () => void;
  /**
   * Aborts (only) when the idle timeout fires — including mid-stream, after
   * the initial fetch already resolved. Callers reading a streamed body
   * should check this after a read rejects, to classify a stalled connection
   * as a timeout rather than an opaque/unknown error.
   */
  timeoutSignal: AbortSignal;
}

export async function providerRequest(
  provider: Provider,
  path: string,
  options: ProviderRequestOptions = {},
): Promise<ProviderRequestResult> {
  const method = options.method ?? 'GET';
  const validation = validateEndpoint(provider.baseUrl);
  if (!validation.ok) {
    throw new ProviderError('invalid-url', validation.reason ?? summaryFor('invalid-url'));
  }

  const endpoint = buildEndpoint(provider.baseUrl, path);
  const { url: fetchUrl, proxyTarget } = resolveFetchTarget(endpoint, provider);
  const headers = buildProviderHeaders(provider, method === 'POST' && options.body !== undefined);
  if (proxyTarget) headers[DEV_PROXY_TARGET_HEADER] = proxyTarget;

  const timeoutMs = options.timeoutMs ?? provider.timeoutMs ?? 60_000;
  const timeoutController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const armTimeout = () => {
    timeoutId = setTimeout(
      () => timeoutController.abort(new DOMException('Request timed out', 'TimeoutError')),
      timeoutMs,
    );
  };
  const clearRequestTimeout = () => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    timeoutId = undefined;
    signalCleanup();
  };
  const resetTimeout = () => {
    clearRequestTimeout();
    armTimeout();
  };
  armTimeout();
  const { signal, cleanup: signalCleanup } = mergeSignals(options.signal, timeoutController.signal);

  const start = Date.now();
  try {
    const response = await fetch(fetchUrl, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal,
    });
    // NOTE: intentionally not clearing the timeout here — headers have
    // arrived, but a streamed body can still stall indefinitely. The caller
    // is responsible for calling resetTimeout()/clearRequestTimeout() as it
    // reads (or finishes reading) the body, so a connection that stops
    // sending data mid-stream is still bounded by timeoutMs.
    return {
      response,
      durationMs: Date.now() - start,
      resetTimeout,
      clearRequestTimeout,
      timeoutSignal: timeoutController.signal,
    };
  } catch (err) {
    clearRequestTimeout();
    if (options.signal?.aborted) {
      throw new ProviderError('aborted', summaryFor('aborted'));
    }
    if (timeoutController.signal.aborted) {
      throw new ProviderError('timeout', summaryFor('timeout'), {
        detail:
          `No response within ${timeoutMs}ms. Verify the base URL, API key, and network/VPN access. ` +
          'Try Fetch models first — it is faster than a full chat test.',
      });
    }
    throw classifyThrown(err);
  }
}

interface MergedSignal {
  signal: AbortSignal;
  /** Detaches any listeners this attached to the caller-supplied signals. */
  cleanup: () => void;
}

function mergeSignals(a: AbortSignal | undefined, b: AbortSignal): MergedSignal {
  const noopCleanup = () => {};
  if (!a) return { signal: b, cleanup: noopCleanup };
  const AnyCtor = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof AnyCtor === 'function') return { signal: AnyCtor([a, b]), cleanup: noopCleanup };
  // Fallback for environments without AbortSignal.any: listeners are removed
  // explicitly once the request settles, rather than relying on `{ once: true }`
  // alone — that only detaches after firing, so a signal that never aborts
  // (e.g. a long-lived, per-conversation controller reused across many
  // requests) would otherwise accumulate one listener per call forever.
  const controller = new AbortController();
  const onAbort = (reason: unknown) => controller.abort(reason);
  const onA = () => onAbort(a.reason);
  const onB = () => onAbort(b.reason);
  if (a.aborted) controller.abort(a.reason);
  else a.addEventListener('abort', onA, { once: true });
  if (b.aborted) controller.abort(b.reason);
  else b.addEventListener('abort', onB, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      a.removeEventListener('abort', onA);
      b.removeEventListener('abort', onB);
    },
  };
}
