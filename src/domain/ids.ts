/**
 * ID generation. A single choke point so IDs are consistent and easy to stub in tests.
 * Browser + Node 18+ both provide crypto.randomUUID.
 */

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Extremely defensive fallback; should not run in supported environments.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const newPlaygroundId = () => `pg_${uuid()}`;
export const newLibraryAgentId = () => `lib_${uuid()}`;
export const newRunPresetId = () => `rp_${uuid()}`;
export const newAgentId = () => `ag_${uuid()}`;
export const newConnectionId = () => `cn_${uuid()}`;
export const newProviderId = () => `pv_${uuid()}`;
export const newSkillId = () => `sk_${uuid()}`;
export const newMessageId = () => `msg_${uuid()}`;
export const newRunId = () => `run_${uuid()}`;
export const newLogId = () => `log_${uuid()}`;
export const newErrorId = () => `err_${uuid()}`;
