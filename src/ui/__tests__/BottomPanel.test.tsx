import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, fireEvent, screen } from '@testing-library/react';

// jsdom has no IndexedDB; stub persistence so the domain store imports cleanly.
vi.mock('../../persistence/db', () => ({
  savePlayground: vi.fn().mockResolvedValue(undefined),
  loadPlayground: vi.fn().mockResolvedValue(undefined),
  loadAllPlaygrounds: vi.fn().mockResolvedValue([]),
  deletePlayground: vi.fn().mockResolvedValue(undefined),
}));

import { createPlayground } from '../../domain/factories';
import type { TranscriptMessage } from '../../domain/schema';
import { useDomainStore } from '../../store/domainStore';
import { useRuntimeStore } from '../../store/runtimeStore';
import { BottomPanel } from '../BottomPanel';

function msg(id: string): TranscriptMessage {
  return {
    id, turn: 1, agentId: null, agentName: 'Agent', agentDeleted: false,
    role: '', language: 'en', model: '', providerId: null, content: `content ${id}`, status: 'completed',
    sourceAgentId: null, connectionType: null, timestamp: 1_700_000_000_000,
  };
}

interface ScrollState {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/**
 * jsdom reports 0 for all layout metrics. Backing the element's scroll
 * properties with a single shared, mutable object (instead of re-calling
 * `Object.defineProperty` later) lets a test grow `scrollHeight` — simulating
 * new content arriving — and then observe what the component's own effect
 * does to `scrollTop` in response, exactly as it would in a real browser.
 */
function stubScrollMetrics(el: HTMLElement, state: ScrollState) {
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => state.clientHeight });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => state.scrollHeight });
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => state.scrollTop,
    set: (v) => { state.scrollTop = v; },
  });
}

afterEach(() => cleanup());
beforeEach(() => {
  useDomainStore.setState({ playground: null, index: [], saveStatus: 'saved' });
  useRuntimeStore.getState().reset();
});

describe('BottomPanel auto-scroll (M-13 regression)', () => {
  it('does not force scroll-to-bottom when the user has scrolled up to read history', () => {
    const playground = { ...createPlayground('Demo'), transcript: [msg('a'), msg('b')] };
    useDomainStore.setState({ playground });

    const { container } = render(<BottomPanel />);
    const content = container.querySelector('[data-testid="bottom-panel-content"]') as HTMLElement;

    // Simulate the user having scrolled well away from the bottom.
    const state: ScrollState = { scrollTop: 0, clientHeight: 200, scrollHeight: 2000 };
    stubScrollMetrics(content, state);
    fireEvent.scroll(content);

    // New content arrives (e.g. a streamed token) while scrolled up.
    state.scrollHeight = 2200;
    act(() => {
      useDomainStore.setState({
        playground: { ...playground, transcript: [...playground.transcript, msg('c')] },
      });
    });

    // The panel must NOT have yanked the user back to the bottom.
    expect(content.scrollTop).toBe(0);
  });

  it('keeps auto-scrolling when the user is already at the bottom', () => {
    const playground = { ...createPlayground('Demo'), transcript: [msg('a'), msg('b')] };
    useDomainStore.setState({ playground });

    const { container } = render(<BottomPanel />);
    const content = container.querySelector('[data-testid="bottom-panel-content"]') as HTMLElement;

    // At the bottom already.
    const state: ScrollState = { scrollTop: 1800, clientHeight: 200, scrollHeight: 2000 };
    stubScrollMetrics(content, state);
    fireEvent.scroll(content);

    // New content grows the scrollable area.
    state.scrollHeight = 2200;
    act(() => {
      useDomainStore.setState({
        playground: { ...playground, transcript: [...playground.transcript, msg('c')] },
      });
    });

    expect(content.scrollTop).toBe(2200);
  });
});

describe('BottomPanel tab ARIA wiring (L-17 regression)', () => {
  it('links each tab to its panel via aria-controls/id, and roves tabindex to the active tab only', () => {
    const playground = { ...createPlayground('Demo'), transcript: [msg('a')] };
    useDomainStore.setState({ playground });
    render(<BottomPanel />);

    const transcriptTab = screen.getByRole('tab', { name: /transcript/i });
    const logTab = screen.getByRole('tab', { name: /event log/i });
    const panel = screen.getByRole('tabpanel');

    // The active tab's id matches the panel's aria-labelledby, and the panel's
    // id matches the active tab's aria-controls — a real bidirectional link.
    expect(transcriptTab.id).toBe(panel.getAttribute('aria-labelledby'));
    expect(panel.id).toBe(transcriptTab.getAttribute('aria-controls'));

    // Only the active tab is in the regular tab order.
    expect(transcriptTab.tabIndex).toBe(0);
    expect(logTab.tabIndex).toBe(-1);

    fireEvent.click(logTab);
    expect(logTab.tabIndex).toBe(0);
    expect(transcriptTab.tabIndex).toBe(-1);
    const panelAfter = screen.getByRole('tabpanel');
    expect(logTab.id).toBe(panelAfter.getAttribute('aria-labelledby'));
  });
});
