import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

function Boom(): never {
  throw new Error('kaboom');
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // React logs the caught error to console.error too; keep test output clean.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  consoleErrorSpy.mockRestore();
});

describe('ErrorBoundary (M-14 regression)', () => {
  it('renders children normally when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>all good</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('all good')).toBeInTheDocument();
  });

  it('catches a render-time error and shows a fallback instead of crashing the whole tree', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
    expect(screen.getByText('kaboom')).toBeInTheDocument();
  });
});
