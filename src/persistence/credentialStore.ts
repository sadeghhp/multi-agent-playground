import type { CredentialStorage } from '../domain/schema';

/**
 * Credential storage (spec §8.4, §21). API keys are kept OUT of the main
 * IndexedDB playground record and out of exports. They live here:
 *   - 'session' (default): sessionStorage, cleared when the tab/session ends.
 *   - 'local': localStorage, persists across sessions (opt-in, warned in UI).
 *
 * Keying by providerId lets us rehydrate provider.apiKey on load without ever
 * serializing the key alongside the rest of the playground.
 */

const PREFIX = 'map.cred.';

function keyFor(providerId: string): string {
  return `${PREFIX}${providerId}`;
}

export function saveCredential(
  providerId: string,
  apiKey: string,
  mode: CredentialStorage,
): void {
  // Whichever store isn't chosen must not retain a stale copy.
  clearCredential(providerId);
  if (!apiKey) return;
  const store = mode === 'local' ? window.localStorage : window.sessionStorage;
  try {
    store.setItem(keyFor(providerId), apiKey);
  } catch {
    /* storage full / disabled — key simply won't persist */
  }
}

export function loadCredential(providerId: string): string | undefined {
  return (
    window.sessionStorage.getItem(keyFor(providerId)) ??
    window.localStorage.getItem(keyFor(providerId)) ??
    undefined
  );
}

export function clearCredential(providerId: string): void {
  window.sessionStorage.removeItem(keyFor(providerId));
  window.localStorage.removeItem(keyFor(providerId));
}
