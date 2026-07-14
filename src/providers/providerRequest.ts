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
    headers[provider.authHeaderName || 'Authorization'] = `${prefix}${provider.apiKey}`;
  } else if (provider.authMethod === 'custom-header' && provider.apiKey) {
    // Custom-header schemes (e.g. `x-api-key`) carry the raw key with NO prefix by
    // default; only prepend one when the user explicitly set an authPrefix.
    const prefix = provider.authPrefix?.trim() ? `${provider.authPrefix.trim()} ` : '';
    headers[provider.authHeaderName || 'Authorization'] = `${prefix}${provider.apiKey}`;
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
export async function providerRequest(
  provider: Provider,
  path: string,
  options: ProviderRequestOptions = {},
): Promise<{ response: Response; durationMs: number }> {
  const method = options.method ?? 'GET';
  const validation = validateEndpoint(provider.baseUrl);
  if (!validation.ok) {
    throw new ProviderError('invalid-url', validation.reason ?? summaryFor('invalid-url'));
  }

  const endpoint = buildEndpoint(provider.baseUrl, path);
  const { url: fetchUrl, proxyTarget } = resolveFetchTarget(endpoint);
  const headers = buildProviderHeaders(provider, method === 'POST' && options.body !== undefined);
  if (proxyTarget) headers[DEV_PROXY_TARGET_HEADER] = proxyTarget;

  const timeoutMs = options.timeoutMs ?? provider.timeoutMs ?? 60_000;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(new DOMException('Request timed out', 'TimeoutError')),
    timeoutMs,
  );
  const signal = mergeSignals(options.signal, timeoutController.signal);

  const start = Date.now();
  try {
    const response = await fetch(fetchUrl, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal,
    });
    clearTimeout(timeoutId);
    return { response, durationMs: Date.now() - start };
  } catch (err) {
    clearTimeout(timeoutId);
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

function mergeSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  const AnyCtor = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof AnyCtor === 'function') return AnyCtor([a, b]);
  const controller = new AbortController();
  const onAbort = (reason: unknown) => controller.abort(reason);
  if (a.aborted) controller.abort(a.reason);
  else a.addEventListener('abort', () => onAbort(a.reason), { once: true });
  if (b.aborted) controller.abort(b.reason);
  else b.addEventListener('abort', () => onAbort(b.reason), { once: true });
  return controller.signal;
}
