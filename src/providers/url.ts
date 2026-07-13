/**
 * Endpoint URL construction and validation (spec §19, §21).
 * Remote endpoints must be HTTPS; HTTP is permitted only for localhost dev.
 */

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

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
  if (url.protocol === 'http:' && !isLocalhost(url.hostname)) {
    return {
      ok: false,
      reason: 'Only HTTPS is allowed for remote endpoints (HTTP is permitted for localhost only).',
    };
  }
  return { ok: true };
}

/** Join base URL and path, tolerating trailing/leading slashes. */
export function buildEndpoint(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${base}${suffix}`;
}
