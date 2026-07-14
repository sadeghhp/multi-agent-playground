import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

// IndexedDB isn't available in jsdom; stub persistence so hydration resolves.
vi.mock('../persistence/db', () => ({
  savePlayground: vi.fn().mockResolvedValue(undefined),
  loadPlayground: vi.fn().mockResolvedValue(undefined),
  loadAllPlaygrounds: vi.fn().mockResolvedValue([]),
  deletePlayground: vi.fn().mockResolvedValue(undefined),
  saveProvider: vi.fn().mockResolvedValue(undefined),
  loadAllProviders: vi.fn().mockResolvedValue([]),
  deleteProvider: vi.fn().mockResolvedValue(undefined),
  saveLibraryAgent: vi.fn().mockResolvedValue(undefined),
  loadAllLibraryAgents: vi.fn().mockResolvedValue([]),
  deleteLibraryAgent: vi.fn().mockResolvedValue(undefined),
}));

// React Flow measures real DOM layout that jsdom can't provide; stub the canvas.
vi.mock('../graph/GraphCanvas', () => ({
  GraphCanvas: () => <div data-testid="graph-canvas-stub" />,
}));

import App from '../App';

afterEach(() => cleanup());

describe('App shell', () => {
  it('boots, creates a starter playground, and renders the five regions', async () => {
    render(<App />);

    // Toolbar brand + a name input appear.
    expect(screen.getByText('Multi-Agent Playground')).toBeInTheDocument();

    // After hydration, a playground exists so the canvas + palette render.
    await waitFor(() => {
      expect(screen.getByTestId('graph-canvas-stub')).toBeInTheDocument();
    });

    // Left palette
    expect(screen.getByRole('button', { name: /add agent/i })).toBeInTheDocument();
    // Right inspector empty state
    expect(screen.getByText(/select an agent or connection/i)).toBeInTheDocument();
    // Bottom execution panel
    expect(screen.getByRole('tab', { name: /transcript/i })).toBeInTheDocument();
    // Security notice from spec §4.1
    expect(screen.getByText(/do not use unrestricted/i)).toBeInTheDocument();
  });
});
