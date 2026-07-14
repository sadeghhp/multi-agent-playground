/**
 * Parse a numeric text input into a bounded integer, returning null for empty /
 * NaN / out-of-range values so callers can ignore invalid edits rather than
 * persisting them. HTML `min` is only a hint — clearing a field yields `''`,
 * whose `Number('')` is `0`, which then bypasses schema `.positive()` validation
 * (that only runs at parse/import, not on live store patches).
 */
export function parseBoundedInt(raw: string, min: number): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const int = Math.trunc(n);
  if (int < min) return null;
  return int;
}
