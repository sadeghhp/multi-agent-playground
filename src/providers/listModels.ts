import type { Provider } from '../domain/schema';
import { ProviderError, classifyStatus, retryEligible, safeReadErrorBody, summaryFor } from './errors';
import { providerRequest } from './providerRequest';
import { MODELS_PATH } from './url';

export interface ListModelsResult {
  ok: boolean;
  models: string[];
  durationMs: number;
  status?: number;
  errorKind?: string;
  errorSummary?: string;
  errorDetail?: string;
  retryEligible?: boolean;
}

/** Parse common OpenAI-compatible /v1/models response shapes. */
export function parseModelsPayload(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;

  if (Array.isArray(record.data)) {
    return record.data
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          if (typeof obj.id === 'string') return obj.id;
          if (typeof obj.name === 'string') return obj.name;
          if (typeof obj.model === 'string') return obj.model;
        }
        return null;
      })
      .filter((id): id is string => Boolean(id));
  }

  if (Array.isArray(record.models)) {
    return record.models
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          if (typeof obj.name === 'string') return obj.name;
          if (typeof obj.model === 'string') return obj.model;
        }
        return null;
      })
      .filter((id): id is string => Boolean(id));
  }

  return [];
}

/**
 * GET /v1/models from the provider. Lightweight connectivity check that does
 * not require a model id and usually responds faster than chat completions.
 */
export async function listModels(
  provider: Provider,
  signal?: AbortSignal,
): Promise<ListModelsResult> {
  const start = Date.now();
  const modelsTimeoutMs = Math.min(provider.timeoutMs ?? 60_000, 30_000);

  try {
    const { response, durationMs, clearRequestTimeout } = await providerRequest(provider, MODELS_PATH, {
      method: 'GET',
      signal,
      timeoutMs: modelsTimeoutMs,
    });
    // This call never streams — the body is read in full immediately below, so
    // the idle timeout has no more work to do once we have the response.
    clearRequestTimeout();

    if (!response.ok) {
      const kind = classifyStatus(response.status);
      const detail = await safeReadErrorBody(response);
      const pe = new ProviderError(kind, summaryFor(kind), { status: response.status, detail });
      return {
        ok: false,
        models: [],
        durationMs,
        status: response.status,
        errorKind: pe.kind,
        errorSummary: pe.message,
        errorDetail: pe.detail,
        retryEligible: retryEligible(pe.kind),
      };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      const pe = new ProviderError('malformed-response', summaryFor('malformed-response'), {
        status: response.status,
      });
      return {
        ok: false,
        models: [],
        durationMs,
        status: response.status,
        errorKind: pe.kind,
        errorSummary: pe.message,
        retryEligible: false,
      };
    }

    const models = parseModelsPayload(data);
    return { ok: true, models, durationMs, status: response.status };
  } catch (err) {
    const pe = err instanceof ProviderError ? err : null;
    return {
      ok: false,
      models: [],
      durationMs: Date.now() - start,
      status: pe?.status,
      errorKind: pe?.kind ?? 'unknown',
      errorSummary: pe?.message ?? 'Unknown error',
      errorDetail: pe?.detail,
      retryEligible: pe ? retryEligible(pe.kind) : false,
    };
  }
}
