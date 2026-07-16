/**
 * ID generation. A single choke point so IDs are consistent and easy to stub in tests.
 *
 * IDs are short (prefix + 8 random chars) rather than UUIDs so they stay compact and
 * token-cheap when they appear in prompts/transcripts handed to an LLM. The random part
 * draws from a 32-char base32-style alphabet with the characters most easily confused
 * with each other removed (0, 1, l, o). Exactly 32 chars so a 5-bit mask over random
 * bytes selects uniformly, with no modulo bias. Browser + Node 18+ both provide
 * crypto.getRandomValues.
 *
 * Collision odds: 32^8 ≈ 1.1e12 combinations per prefix; nothing here checks or
 * retries on collision, so this assumes each individually-prefixed id space (e.g. all
 * `usg_` usage-ledger ids ever minted) stays well under ~10^5 entries, where collision
 * probability is still negligible. Most prefixes (agent, connection, skill, ...) are
 * bounded by a single playground's size and never approach that. The ledger-style
 * prefixes (`usg_`, `log_`, `msg_`, `err_`, `run_`) accumulate without pruning, so this
 * is worth revisiting if usage grows enough for that bound to matter.
 */
const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const ID_LENGTH = 8;

function shortId(): string {
  const out = new Array(ID_LENGTH);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(ID_LENGTH);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < ID_LENGTH; i++) {
      out[i] = ID_ALPHABET[bytes[i] & 31]; // 32 = 2^5, so masking 5 bits is unbiased
    }
  } else {
    // Extremely defensive fallback; should not run in supported environments.
    for (let i = 0; i < ID_LENGTH; i++) {
      out[i] = ID_ALPHABET[(Math.random() * 32) | 0];
    }
  }
  return out.join('');
}

export const newPlaygroundId = () => `pg_${shortId()}`;
export const newLibraryAgentId = () => `lib_${shortId()}`;
export const newRunPresetId = () => `rp_${shortId()}`;
export const newAgentId = () => `ag_${shortId()}`;
export const newConnectionId = () => `cn_${shortId()}`;
export const newProviderId = () => `pv_${shortId()}`;
export const newSkillId = () => `sk_${shortId()}`;
export const newMessageId = () => `msg_${shortId()}`;
export const newRunId = () => `run_${shortId()}`;
export const newLogId = () => `log_${shortId()}`;
export const newErrorId = () => `err_${shortId()}`;
export const newUsageId = () => `usg_${shortId()}`;
export const newPriceId = () => `prc_${shortId()}`;
