import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

// jsdom has no IndexedDB; stub persistence so the domain store imports cleanly.
vi.mock('../../../persistence/db', () => ({
  savePlayground: vi.fn().mockResolvedValue(undefined),
  loadPlayground: vi.fn().mockResolvedValue(undefined),
  loadAllPlaygrounds: vi.fn().mockResolvedValue([]),
  deletePlayground: vi.fn().mockResolvedValue(undefined),
}));

import { createAgent, createPlayground } from '../../../domain/factories';
import type { TranscriptMessage } from '../../../domain/schema';
import { useDomainStore } from '../../../store/domainStore';
import { useUiStore } from '../../../store/uiStore';
import { TimelinePage } from '../TimelinePage';

function msg(over: Partial<TranscriptMessage>): TranscriptMessage {
  return {
    id: 'm', turn: 1, agentId: null, agentName: 'Agent', agentDeleted: false,
    role: '', model: '', providerId: null, content: '', status: 'completed',
    sourceAgentId: null, connectionType: null, timestamp: 1_700_000_000_000,
    language: 'en',
    ...over,
  };
}

afterEach(() => cleanup());
beforeEach(() => {
  useDomainStore.setState({ playground: null, index: [], saveStatus: 'saved' });
  useUiStore.setState({ openPanel: 'timeline' });
});

describe('TimelinePage', () => {
  it('groups messages under per-turn dividers and renders their bodies', () => {
    const researcher = createAgent({ name: 'Researcher', colorCategory: 'teal' });
    const critic = createAgent({ name: 'Critic', colorCategory: 'red' });
    const playground = {
      ...createPlayground('Demo'),
      agents: [researcher, critic],
      transcript: [
        msg({ id: 'a', turn: 1, agentId: researcher.id, agentName: 'Researcher', content: 'Opening idea.' }),
        msg({ id: 'b', turn: 2, agentId: critic.id, agentName: 'Critic', content: 'A rebuttal.' }),
        msg({ id: 'c', turn: 2, agentId: researcher.id, agentName: 'Researcher', content: 'Fair point.' }),
      ],
    };
    useDomainStore.setState({ playground });

    render(<TimelinePage />);

    // Two turn dividers, three message bodies.
    expect(screen.getByLabelText('Turn 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Turn 2')).toBeInTheDocument();
    expect(screen.getByText('Opening idea.')).toBeInTheDocument();
    expect(screen.getByText('A rebuttal.')).toBeInTheDocument();
    expect(screen.getByText('Fair point.')).toBeInTheDocument();
  });

  it('renders failed messages with their error text', () => {
    const playground = {
      ...createPlayground('Demo'),
      transcript: [msg({ id: 'e', status: 'failed', error: 'timeout' })],
    };
    useDomainStore.setState({ playground });

    render(<TimelinePage />);
    expect(screen.getByText(/Failed: timeout/)).toBeInTheDocument();
  });

  it('renders a Persian message card right-to-left', () => {
    const agent = createAgent({ name: 'تحلیل‌گر', language: 'fa' });
    const playground = {
      ...createPlayground('Demo'),
      agents: [agent],
      transcript: [msg({ id: 'fa1', agentId: agent.id, agentName: 'تحلیل‌گر', language: 'fa', content: 'سلام دنیا' })],
    };
    useDomainStore.setState({ playground });

    render(<TimelinePage />);
    const card = screen.getByText('سلام دنیا').closest('[dir="rtl"]');
    expect(card).not.toBeNull();
    // Regression guard: no descendant (e.g. the body) may re-declare its own
    // dir (such as dir="auto"), which would silently override this forced rtl.
    expect(card!.querySelectorAll('[dir]')).toHaveLength(0);
  });

  it('shows the empty state when there is no transcript', () => {
    useDomainStore.setState({ playground: createPlayground('Empty') });
    render(<TimelinePage />);
    expect(screen.getByText(/No conversation yet/i)).toBeInTheDocument();
  });
});
