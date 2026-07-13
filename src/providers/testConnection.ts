import type { Provider } from '../domain/schema';
import { ProviderError, retryEligible } from './errors';
import { sendChat } from './openaiAdapter';

/**
 * Provider "Test connection" (spec §8.2). Sends a minimal request and returns a
 * structured, secret-free result suitable for display.
 */
export interface TestConnectionResult {
  ok: boolean;
  status?: number;
  durationMs: number;
  /** Parsed model text on success. */
  responseText?: string;
  model?: string;
  /** Sanitized error info on failure — never contains credentials. */
  errorKind?: string;
  errorSummary?: string;
  errorDetail?: string;
  retryEligible?: boolean;
}

export async function testConnection(
  provider: Provider,
  model: string,
  signal?: AbortSignal,
): Promise<TestConnectionResult> {
  const start = Date.now();
  try {
    const res = await sendChat(
      provider,
      {
        model,
        messages: [
          { role: 'system', content: 'You are a connectivity test.' },
          { role: 'user', content: 'Reply with the single word: ok' },
        ],
        maxOutputTokens: 5,
        temperature: 0,
      },
      { signal },
    );
    return {
      ok: true,
      status: res.status,
      durationMs: res.durationMs,
      responseText: res.text,
      model: res.model,
    };
  } catch (err) {
    const pe = err instanceof ProviderError ? err : null;
    return {
      ok: false,
      status: pe?.status,
      durationMs: Date.now() - start,
      errorKind: pe?.kind ?? 'unknown',
      errorSummary: pe?.message ?? 'Unknown error',
      errorDetail: pe?.detail,
      retryEligible: pe ? retryEligible(pe.kind) : false,
    };
  }
}
