/**
 * Endpoint URL construction and validation (spec §19, §21).
 */

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Path segments relative to the OpenAI-style /v1 API root. */
export const CHAT_COMPLETIONS_PATH = '/chat/completions';
export const MODELS_PATH = '/models';

export function isLocalhost(hostname: string): boolean {
  return LOCALHOST_HOSTS.has(hostname) || hostname.endsWith('.localhost');
}

export interface UrlValidation {
  ok: boolean;
  reason?: string;
}

export function validateEndpoint(baseUrl: string): UrlValidation {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { ok: false, reason: 'Not a valid URL.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: 'URL must use http or https.' };
  }
  return { ok: true };
}

/**
 * Resolve the OpenAI-compatible API root from a provider base URL.
 * Examples:
 * - https://host           -> https://host/v1
 * - https://host/v1/       -> https://host/v1
 * - https://host/custom/v1 -> https://host/custom/v1
 */
export function resolveApiBase(baseUrl: string): string {
  const normalized = baseUrl.trim();
  if (!normalized) return '';
  const url = new URL(normalized);
  const path = url.pathname.replace(/\/+$/, '');
  if (!path || path === '/') return `${url.origin}/v1`;
  if (path.endsWith('/v1')) return `${url.origin}${path}`;
  return `${url.origin}${path}`;
}

/**
 * Join base URL and API path without duplicating /v1 segments.
 * Empty path defaults to /chat/completions.
 */
export function buildEndpoint(baseUrl: string, path: string): string {
  const apiBase = resolveApiBase(baseUrl);
  let segment = path.trim();
  if (!segment) segment = CHAT_COMPLETIONS_PATH;
  else if (!segment.startsWith('/')) segment = `/${segment}`;

  if (apiBase.endsWith('/v1') && segment.startsWith('/v1/')) {
    segment = segment.slice(3);
  } else if (apiBase.endsWith('/v1') && segment === '/v1') {
    segment = '';
  }

  return `${apiBase}${segment}`;
}
