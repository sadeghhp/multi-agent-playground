import type { Provider } from '../domain/schema';
import { ProviderError, retryEligible } from './errors';
import { listModels } from './listModels';
import { sendChat } from './openaiAdapter';

/**
 * Provider "Test connection" (spec §8.2). Lists models first, then optionally
 * sends a minimal chat request when a model id is available.
 */
export interface TestConnectionResult {
  ok: boolean;
  status?: number;
  durationMs: number;
  /** Models returned by GET /v1/models when that step succeeded. */
  models?: string[];
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
  model?: string,
  signal?: AbortSignal,
): Promise<TestConnectionResult> {
  const start = Date.now();
  const modelsResult = await listModels(provider, signal);
  if (!modelsResult.ok) {
    return {
      ok: false,
      durationMs: modelsResult.durationMs,
      status: modelsResult.status,
      errorKind: modelsResult.errorKind,
      errorSummary: modelsResult.errorSummary,
      errorDetail: modelsResult.errorDetail,
      retryEligible: modelsResult.retryEligible,
    };
  }

  const listedIds = modelsResult.models.map((m) => m.id);
  const modelToTest =
    model?.trim() || provider.defaultModel || provider.models[0] || listedIds[0] || '';

  if (!modelToTest) {
    return {
      ok: true,
      status: modelsResult.status,
      durationMs: modelsResult.durationMs,
      models: listedIds,
      responseText:
        listedIds.length > 0
          ? `Connected — ${listedIds.length} model(s) listed.`
          : 'Connected — /v1/models responded but listed no models.',
    };
  }

  try {
    const res = await sendChat(
      provider,
      {
        model: modelToTest,
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
      durationMs: Date.now() - start,
      models: listedIds,
      responseText: res.text,
      model: res.model,
    };
  } catch (err) {
    const pe = err instanceof ProviderError ? err : null;
    return {
      ok: false,
      status: pe?.status,
      durationMs: Date.now() - start,
      models: listedIds,
      errorKind: pe?.kind ?? 'unknown',
      errorSummary: pe?.message ?? 'Unknown error',
      errorDetail: pe?.detail,
      retryEligible: pe ? retryEligible(pe.kind) : false,
    };
  }
}
