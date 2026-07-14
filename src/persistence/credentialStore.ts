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
  } catch (err) {
    // Storage full/disabled (e.g. private-browsing quota) — the key simply
    // won't persist. Warn rather than fail silently, since the caller (and
    // the user, per the UI's storage-mode warning) otherwise has no signal
    // that the save didn't actually happen.
    console.warn(`Failed to save credential for provider ${providerId}:`, err);
  }
}

export function loadCredential(providerId: string): string | undefined {
  try {
    return (
      window.sessionStorage.getItem(keyFor(providerId)) ??
      window.localStorage.getItem(keyFor(providerId)) ??
      undefined
    );
  } catch (err) {
    console.warn(`Failed to load credential for provider ${providerId}:`, err);
    return undefined;
  }
}

export function clearCredential(providerId: string): void {
  // Each removal is independent — one Storage backend throwing (disabled,
  // sandboxed iframe) must not prevent clearing the other.
  try {
    window.sessionStorage.removeItem(keyFor(providerId));
  } catch (err) {
    console.warn(`Failed to clear session credential for provider ${providerId}:`, err);
  }
  try {
    window.localStorage.removeItem(keyFor(providerId));
  } catch (err) {
    console.warn(`Failed to clear local credential for provider ${providerId}:`, err);
  }
}
