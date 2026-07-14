import type { AuthMethod } from '../domain/schema';

/** The auth schemes a user can pick in the provider form; 'none' is derived. */
export type AuthScheme = 'bearer' | 'custom-header';

/**
 * Derive the provider's stored `authMethod` from whether an API key is present.
 *
 * The form no longer exposes a "None" choice: an empty key simply means no auth.
 * Keeping `authMethod` in sync with key presence lets the run validator
 * (`orchestrator/validate.ts`) and header builder (`providers/providerRequest.ts`)
 * stay correct without change — a blank key never claims to need one.
 */
export function deriveAuthMethod(apiKey: string, scheme: AuthScheme): AuthMethod {
  return apiKey.trim() ? scheme : 'none';
}

/** Seed the form's scheme radios from a persisted provider's authMethod. */
export function schemeFromAuthMethod(authMethod: AuthMethod): AuthScheme {
  return authMethod === 'custom-header' ? 'custom-header' : 'bearer';
}
