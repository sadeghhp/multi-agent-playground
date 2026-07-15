import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';

// IndexedDB isn't available in jsdom; stub persistence so hydration resolves.
vi.mock('../persistence/db', () => import('../test/persistenceDbMock'));

// React Flow measures real DOM layout that jsdom can't provide; stub the canvas.
vi.mock('../graph/GraphCanvas', () => ({
  GraphCanvas: () => <div data-testid="graph-canvas-stub" />,
}));

import App from '../App';
import { useIsMobile } from '../ui/useIsMobile';

/** Force matchMedia to a fixed result for the mobile breakpoint query. */
function stubMatchMedia(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  stubMatchMedia(false); // restore desktop default for other suites
});

describe('useIsMobile', () => {
  it('is false on a desktop-width viewport', () => {
    stubMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('is true below the mobile breakpoint', () => {
    stubMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });
});

describe('mobile layout', () => {
  it('renders the touch shell (not the desktop editor) below the breakpoint', async () => {
    stubMatchMedia(true);
    render(<App />);

    // Bottom tab bar is present…
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Agents' })).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'More' })).toBeInTheDocument();

    // …and the desktop shell (toolbar brand + canvas) is not mounted.
    expect(screen.queryByText('Multi-Agent Playground')).not.toBeInTheDocument();
    expect(screen.queryByTestId('graph-canvas-stub')).not.toBeInTheDocument();
  });
});
