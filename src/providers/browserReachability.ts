/**
 * Static analysis of whether a provider URL is reachable from the current
 * browser origin. No network I/O — used by pre-run validation, the provider
 * editor, and the fetch path to fail fast on known-impossible combinations
 * (public site → localhost, remote HTTP).
 */

import { isAppOnLocalhost, isPrivateNetworkHost, isRemoteHttp } from './url';

export type ReachabilityIssue =
  | 'private-network' // public app → loopback/LAN
  | 'insecure-remote' // remote http:// (spec §21)
  | 'cors-required'; // remote https — may work if provider allows CORS
  | 'invalid-url';

export interface ReachabilityResult {
  ok: boolean;
  issue?: ReachabilityIssue;
  message: string;
  hints: string[];
}

function defaultAppOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost';
}

/**
 * Assess whether `baseUrl` can be called from this browser origin.
 *
 * - `ok: false` → hard block (private-network from public site, remote HTTP, bad URL)
 * - `ok: true` with `cors-required` → warning only (CORS cannot be proven statically)
 * - `ok: true` with no issue → fine (e.g. localhost app + local Ollama)
 */
export function assessProviderReachability(
  baseUrl: string,
  appOrigin: string = defaultAppOrigin(),
): ReachabilityResult {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    return {
      ok: false,
      issue: 'invalid-url',
      message: 'Not a valid URL.',
      hints: ['Enter a full http(s) base URL, for example https://api.openai.com.'],
    };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return {
      ok: false,
      issue: 'invalid-url',
      message: 'URL must use http or https.',
      hints: ['Use https:// for remote APIs, or http:// only for localhost.'],
    };
  }

  const appLocal = isAppOnLocalhost(appOrigin);
  const providerPrivate = isPrivateNetworkHost(url.hostname);

  if (!appLocal && providerPrivate) {
    return {
      ok: false,
      issue: 'private-network',
      message:
        'Browsers block public websites from reaching localhost or your local network (Private Network Access).',
      hints: [
        'Run the app locally with `npm run dev` at http://localhost:5173, then use Ollama or LM Studio on localhost.',
        'Or set the provider base URL to a public HTTPS endpoint you control that sends CORS headers — not localhost.',
      ],
    };
  }

  if (isRemoteHttp(baseUrl)) {
    return {
      ok: false,
      issue: 'insecure-remote',
      message: 'Remote endpoints must use HTTPS. HTTP is only allowed for localhost.',
      hints: [
        'Change the base URL to https://…',
        'Use http:// only for local servers such as http://localhost:11434.',
      ],
    };
  }

  if (url.protocol === 'https:' && !providerPrivate) {
    return {
      ok: true,
      issue: 'cors-required',
      message:
        'Remote providers must allow browser-origin requests (CORS) from this page.',
      hints: [
        'Use Test connection before running a conversation.',
        'Providers built for server-to-server only will not work in this browser-only app.',
      ],
    };
  }

  return {
    ok: true,
    message: 'This endpoint can be reached from this browser origin.',
    hints: [],
  };
}
