/**
 * Endpoint URL construction and validation (spec §19, §21).
 */

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
/** Cloud metadata services — never treated as a legitimate local LLM host. */
const METADATA_SERVICE_HOST = '169.254.169.254';

/** Path segments relative to the OpenAI-style /v1 API root. */
export const CHAT_COMPLETIONS_PATH = '/chat/completions';
export const MODELS_PATH = '/models';

export function isLocalhost(hostname: string): boolean {
  return LOCALHOST_HOSTS.has(hostname) || hostname.endsWith('.localhost');
}

/**
 * True for hostnames that resolve to loopback, private LAN, or link-local
 * addresses — targets browsers treat as the private network address space.
 */
export function isPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === METADATA_SERVICE_HOST) return false;
  if (LOCALHOST_HOSTS.has(hostname) || host === 'localhost') return true;
  if (host.endsWith('.localhost') || host.endsWith('.local')) return true;

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1, 3).map(Number);
    if (a === 10 || a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  if (host === '::1') return true;
  if (host.startsWith('fc') || host.startsWith('fd')) return true;
  if (host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) {
    return true;
  }

  return false;
}

/** True when the app itself is served from loopback (local `vite` / preview). */
export function isAppOnLocalhost(origin: string): boolean {
  try {
    return isLocalhost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** True for `http://` targets that are not on the private network (spec §21). */
export function isRemoteHttp(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === 'http:' && !isPrivateNetworkHost(url.hostname);
  } catch {
    return false;
  }
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
  // Preserve any query string on the base URL — some gateways carry an
  // api-version or key in the query, and dropping it silently breaks the call.
  const query = url.search;
  const path = url.pathname.replace(/\/+$/, '');
  if (!path || path === '/') return `${url.origin}/v1${query}`;
  return `${url.origin}${path}${query}`;
}

/**
 * Join base URL and API path without duplicating /v1 segments.
 * Empty path defaults to /chat/completions.
 */
export function buildEndpoint(baseUrl: string, path: string): string {
  const apiBase = resolveApiBase(baseUrl);
  // Split off any query so the path segment is inserted before it, not after.
  const qIdx = apiBase.indexOf('?');
  const base = qIdx === -1 ? apiBase : apiBase.slice(0, qIdx);
  const query = qIdx === -1 ? '' : apiBase.slice(qIdx);

  let segment = path.trim();
  if (!segment) segment = CHAT_COMPLETIONS_PATH;
  else if (!segment.startsWith('/')) segment = `/${segment}`;

  if (base.endsWith('/v1') && segment.startsWith('/v1/')) {
    segment = segment.slice(3);
  } else if (base.endsWith('/v1') && segment === '/v1') {
    segment = '';
  }

  return `${base}${segment}${query}`;
}
