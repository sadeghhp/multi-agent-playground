/**
 * Global minimum spacing between LLM provider HTTP calls.
 * Anchored after each request completes (not at start) so RPM limits are
 * respected even when calls take varying amounts of time.
 *
 * Kept free of Zustand to avoid import cycles with the settings store.
 */

let delayMs = 0;
let lastRequestEndAt = 0;
/** Resolves when the previous throttled request has called markRequestComplete. */
let chain: Promise<void> = Promise.resolve();
/** One release per acquired throttle slot; FIFO matches call order. */
const releases: Array<() => void> = [];

export function setRequestDelayMs(ms: number): void {
  delayMs = Math.max(0, Math.min(60_000, Math.floor(ms)));
}

export function getRequestDelayMs(): number {
  return delayMs;
}

/** Test/reset helper — clears timing state without changing delayMs. */
export function resetRequestThrottleForTests(): void {
  lastRequestEndAt = 0;
  chain = Promise.resolve();
  while (releases.length) releases.shift()?.();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * When delay > 0, wait for the previous throttled request to finish, then wait
 * until `lastRequestEndAt + delayMs`. Concurrent callers queue; each must call
 * `markRequestComplete()` (typically in a `finally`) to release the next waiter.
 * When delay is 0, this is a no-op.
 */
export async function throttleBeforeRequest(): Promise<boolean> {
  if (delayMs <= 0) return false;

  let release!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const previous = chain;
  chain = previous.catch(() => {}).then(() => held);

  await previous.catch(() => {});
  const wait = lastRequestEndAt + delayMs - Date.now();
  if (wait > 0) await sleep(wait);
  releases.push(release);
  return true;
}

/**
 * Anchor the next request's spacing and release the next queued waiter. Pass the
 * boolean returned by `throttleBeforeRequest`: only a call that actually acquired
 * a slot may shift a release, otherwise a zero-delay request completing mid-flight
 * could pop (and fire early) a *different* throttled request's release.
 */
export function markRequestComplete(acquired = true): void {
  lastRequestEndAt = Date.now();
  if (acquired) releases.shift()?.();
}
