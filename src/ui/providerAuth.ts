import type { AuthMethod } from '../domain/schema';

/**
 * Derive the provider's stored `authMethod` from whether an API key is present.
 *
 * The form only exposes an API key field: empty ⇒ no auth, non-empty ⇒ bearer.
 */
export function deriveAuthMethod(apiKey: string): AuthMethod {
  return apiKey.trim() ? 'bearer' : 'none';
}
