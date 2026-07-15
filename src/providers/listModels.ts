import type { Provider } from '../domain/schema';
import { perTokenToPer1M } from '../usage/pricing';
import { ProviderError, classifyStatus, retryEligible, safeReadErrorBody, summaryFor } from './errors';
import { providerRequest } from './providerRequest';
import { MODELS_PATH } from './url';

/** A model id returned by GET /v1/models, optionally with USD/1M prices. */
export interface ListedModel {
  id: string;
  inputPer1M?: number;
  outputPer1M?: number;
}

export interface ListModelsResult {
  ok: boolean;
  models: ListedModel[];
  durationMs: number;
  status?: number;
  errorKind?: string;
  errorSummary?: string;
  errorDetail?: string;
  retryEligible?: boolean;
}

function parsePerTokenPrice(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return perTokenToPer1M(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return perTokenToPer1M(n);
  }
  return undefined;
}

function parsePricing(obj: Record<string, unknown>): Pick<ListedModel, 'inputPer1M' | 'outputPer1M'> {
  const pricing = obj.pricing;
  if (!pricing || typeof pricing !== 'object') return {};
  const p = pricing as Record<string, unknown>;
  const inputPer1M = parsePerTokenPrice(p.prompt);
  const outputPer1M = parsePerTokenPrice(p.completion);
  return {
    ...(inputPer1M !== undefined ? { inputPer1M } : {}),
    ...(outputPer1M !== undefined ? { outputPer1M } : {}),
  };
}

function itemToListedModel(item: unknown): ListedModel | null {
  if (typeof item === 'string') {
    return item ? { id: item } : null;
  }
  if (!item || typeof item !== 'object') return null;
  const obj = item as Record<string, unknown>;
  const id =
    (typeof obj.id === 'string' && obj.id) ||
    (typeof obj.name === 'string' && obj.name) ||
    (typeof obj.model === 'string' && obj.model) ||
    '';
  if (!id) return null;
  return { id, ...parsePricing(obj) };
}

/** Parse common OpenAI-compatible /v1/models response shapes, including OpenRouter pricing. */
export function parseModelsPayload(data: unknown): ListedModel[] {
  if (!data || typeof data !== 'object') return [];
  const record = data as Record<string, unknown>;

  if (Array.isArray(record.data)) {
    return record.data.map(itemToListedModel).filter((m): m is ListedModel => Boolean(m));
  }

  if (Array.isArray(record.models)) {
    return record.models.map(itemToListedModel).filter((m): m is ListedModel => Boolean(m));
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
