import { isLocalhost } from './url';

/** Dev-server path that forwards provider requests without browser CORS. */
export const DEV_PROXY_PATH = '/__provider_proxy';
export const DEV_PROXY_TARGET_HEADER = 'X-Proxy-Target';

/**
 * In dev, route remote provider calls through the Vite proxy so endpoints that
 * don't allow browser CORS (most internal LLM gateways) still work locally.
 * Localhost targets are called directly; production builds are unchanged.
 */
export function shouldUseDevProxy(endpoint: string): boolean {
  if (!import.meta.env.DEV || import.meta.env.MODE === 'test') return false;
  try {
    const url = new URL(endpoint);
    return !isLocalhost(url.hostname);
  } catch {
    return false;
  }
}

export function resolveFetchTarget(endpoint: string): { url: string; proxyTarget?: string } {
  if (!shouldUseDevProxy(endpoint)) return { url: endpoint };
  return { url: DEV_PROXY_PATH, proxyTarget: endpoint };
}
