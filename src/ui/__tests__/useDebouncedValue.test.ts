import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDebouncedValue } from '../useDebouncedValue';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebouncedValue (L-18 support)', () => {
  it('does not update immediately when the input changes rapidly', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    });
    expect(result.current).toBe('a');

    rerender({ value: 'ab' });
    act(() => vi.advanceTimersByTime(100));
    rerender({ value: 'abc' });
    act(() => vi.advanceTimersByTime(100));
    rerender({ value: 'abcd' });
    act(() => vi.advanceTimersByTime(100));

    // Still the initial value — each keystroke reset the timer before it fired.
    expect(result.current).toBe('a');
  });

  it('updates once the input stops changing for the full delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'final' });
    act(() => vi.advanceTimersByTime(300));
    expect(result.current).toBe('final');
  });
});
