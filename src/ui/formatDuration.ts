/**
 * Human-readable duration for message metadata. Sub-second values stay in ms;
 * anything longer is shown in seconds with one decimal. Single source of truth so
 * the transcript, timeline, and run-review views render durations identically.
 */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
