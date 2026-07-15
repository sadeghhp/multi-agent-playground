import type { Provider } from '../domain/schema';
import type { ProviderErrorKind } from '../providers/errors';

/** Error kinds that warrant offering a temporary provider switch. */
const SUGGESTABLE: ReadonlySet<ProviderErrorKind> = new Set([
  'network',
  'cors',
  'timeout',
  'server-error',
  'rate-limit',
  'model-not-found',
]);

export function isSuggestableFailure(kind: ProviderErrorKind): boolean {
  return SUGGESTABLE.has(kind);
}

export interface FallbackCandidate {
  providerId: string;
  displayName: string;
  models: string[];
  defaultModel: string;
}

/** Other enabled providers that can serve a chat call right now. */
export function listFallbackCandidates(
  providers: Provider[],
  failedProviderId: string | null,
): FallbackCandidate[] {
  const result: FallbackCandidate[] = [];
  for (const p of providers) {
    if (p.id === failedProviderId) continue;
    if (!p.enabled) continue;
    if (!p.baseUrl.trim()) continue;
    if (p.authMethod !== 'none' && !p.apiKey?.trim()) continue;
    const models = p.models.length > 0 ? p.models : p.defaultModel ? [p.defaultModel] : [];
    if (models.length === 0) continue;
    result.push({
      providerId: p.id,
      displayName: p.displayName,
      models,
      defaultModel: p.defaultModel && models.includes(p.defaultModel) ? p.defaultModel : models[0],
    });
  }
  return result;
}

/** Hosts that commonly support OpenAI stream_options.include_usage. */
export function supportsStreamUsage(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return (
      host === 'api.openai.com' ||
      host === 'openrouter.ai' ||
      host.endsWith('.openrouter.ai')
    );
  } catch {
    return false;
  }
}
