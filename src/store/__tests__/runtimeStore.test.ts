import { beforeEach, describe, expect, it } from 'vitest';
import { useRuntimeStore } from '../runtimeStore';

beforeEach(() => {
  useRuntimeStore.getState().reset();
});

describe('unbounded growth caps (regression)', () => {
  it('caps events at a bounded size, keeping the most recent entries', () => {
    const store = useRuntimeStore.getState();
    for (let i = 0; i < 600; i++) {
      store.logEvent({ id: `e${i}`, at: i, kind: 'test', message: `msg ${i}` });
    }
    const events = useRuntimeStore.getState().events;
    expect(events.length).toBeLessThanOrEqual(500);
    // The tail (most recent) survives; the head (oldest) was evicted.
    expect(events[events.length - 1].id).toBe('e599');
    expect(events.some((e) => e.id === 'e0')).toBe(false);
  });

  it('caps errors at a bounded size, keeping the most recent entries', () => {
    const store = useRuntimeStore.getState();
    for (let i = 0; i < 600; i++) {
      store.addError({ id: `err_${i}`, level: 'agent', summary: `err ${i}`, at: i });
    }
    const errors = useRuntimeStore.getState().errors;
    expect(errors.length).toBeLessThanOrEqual(500);
    expect(errors[errors.length - 1].summary).toBe('err 599');
    expect(errors.some((e) => e.summary === 'err 0')).toBe(false);
  });

  it('caps request snapshots at a bounded size, evicting the oldest by insertion order', () => {
    const store = useRuntimeStore.getState();
    for (let i = 0; i < 600; i++) {
      store.recordSnapshot(`m${i}`, {
        url: 'http://x',
        providerName: 'p',
        model: 'm',
        messages: [],
        params: {},
      });
    }
    const snapshots = useRuntimeStore.getState().requestSnapshots;
    expect(Object.keys(snapshots).length).toBeLessThanOrEqual(500);
    expect(snapshots['m599']).toBeDefined();
    expect(snapshots['m0']).toBeUndefined();
  });
});

describe('flow control: run-scoped disable + failure streaks', () => {
  it('removes an agent from the circuit for the run', () => {
    const store = useRuntimeStore.getState();
    expect(store.isAgentDisabledForRun('a')).toBe(false);
    store.disableAgentForRun('a');
    expect(useRuntimeStore.getState().isAgentDisabledForRun('a')).toBe(true);
    expect(useRuntimeStore.getState().isAgentDisabledForRun('b')).toBe(false);
  });

  it('counts consecutive failures and resets them on success', () => {
    const store = useRuntimeStore.getState();
    expect(store.bumpConsecutiveFailures('a')).toBe(1);
    expect(store.bumpConsecutiveFailures('a')).toBe(2);
    // Independent per agent.
    expect(store.bumpConsecutiveFailures('b')).toBe(1);
    store.resetConsecutiveFailures('a');
    expect(useRuntimeStore.getState().consecutiveFailures['a']).toBeUndefined();
    // Streak restarts from 1 after a reset.
    expect(store.bumpConsecutiveFailures('a')).toBe(1);
    expect(useRuntimeStore.getState().consecutiveFailures['b']).toBe(1);
  });

  it('clears the disabled set and streaks when a new run starts', () => {
    const store = useRuntimeStore.getState();
    store.disableAgentForRun('a');
    store.bumpConsecutiveFailures('a');
    store.startRun('run-1', new AbortController());
    expect(useRuntimeStore.getState().isAgentDisabledForRun('a')).toBe(false);
    expect(useRuntimeStore.getState().consecutiveFailures).toEqual({});
  });
});
