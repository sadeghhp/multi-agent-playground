/**
 * Provider error taxonomy (spec §8.3, §20). In a browser-only product CORS
 * failures are common and otherwise indistinguishable from network errors, so
 * classifying them precisely is essential.
 */

export type ProviderErrorKind =
  | 'invalid-url'
  | 'cors'
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

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status?: number;
  /** Human-facing hint about how to resolve (spec §20 "technical details"). */
  readonly detail?: string;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    opts: { status?: number; detail?: string } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = opts.status;
    this.detail = opts.detail;
  }
}

const KIND_SUMMARY: Record<ProviderErrorKind, string> = {
  'invalid-url': 'The provider URL is invalid.',
  cors: 'The provider blocked this browser-origin request (CORS).',
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
          'directly from a browser. In `pnpm dev`, remote HTTPS endpoints are ' +
          'routed through a local proxy automatically; production builds still ' +
          'require CORS or a server-side proxy.',
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
