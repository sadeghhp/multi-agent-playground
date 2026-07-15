import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getRequestDelayMs,
  markRequestComplete,
  resetRequestThrottleForTests,
  setRequestDelayMs,
  throttleBeforeRequest,
} from '../requestThrottle';

beforeEach(() => {
  vi.useFakeTimers();
  setRequestDelayMs(0);
  resetRequestThrottleForTests();
});

afterEach(() => {
  vi.useRealTimers();
  setRequestDelayMs(0);
  resetRequestThrottleForTests();
});

describe('requestThrottle', () => {
  it('clamps delay to 0..60000', () => {
    setRequestDelayMs(-10);
    expect(getRequestDelayMs()).toBe(0);
    setRequestDelayMs(90_000);
    expect(getRequestDelayMs()).toBe(60_000);
    setRequestDelayMs(250.9);
    expect(getRequestDelayMs()).toBe(250);
  });

  it('does not wait when delay is 0', async () => {
    setRequestDelayMs(0);
    const start = Date.now();
    const p = throttleBeforeRequest();
    await vi.runAllTimersAsync();
    await p;
    expect(Date.now() - start).toBe(0);
  });

  it('spaces two sequential calls by at least the configured delay', async () => {
    setRequestDelayMs(100);

    const firstDone = throttleBeforeRequest().then(() => {
      const t = Date.now();
      markRequestComplete();
      return t;
    });
    // First request: lastRequestEndAt is 0, so no delay.
    await vi.advanceTimersByTimeAsync(0);
    const t1 = await firstDone;

    const secondDone = throttleBeforeRequest().then(() => Date.now());
    await vi.advanceTimersByTimeAsync(100);
    const t2 = await secondDone;
    markRequestComplete();

    expect(t2 - t1).toBeGreaterThanOrEqual(100);
  });

  it('serializes concurrent callers so they do not burst', async () => {
    setRequestDelayMs(50);

    const starts: number[] = [];
    const a = throttleBeforeRequest().then(() => {
      starts.push(Date.now());
      markRequestComplete();
    });
    const b = throttleBeforeRequest().then(() => {
      starts.push(Date.now());
      markRequestComplete();
    });
    const c = throttleBeforeRequest().then(() => {
      starts.push(Date.now());
      markRequestComplete();
    });

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(50);
    await Promise.all([a, b, c]);

    expect(starts).toHaveLength(3);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(50);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(50);
  });
});
