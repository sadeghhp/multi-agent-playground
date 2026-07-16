import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// jsdom has no IndexedDB; stub persistence so the domain store imports cleanly.
vi.mock('../../../persistence/db', () => import('../../../test/persistenceDbMock'));
// The footer drives runs through the orchestrator; stub it so no real run starts.
vi.mock('../../../orchestrator/orchestrator', () => ({
  continueRun: vi.fn(),
  startRun: vi.fn(),
}));
// Footer gating consults run validation; make the test playgrounds "valid".
vi.mock('../../../orchestrator/validate', () => ({
  validateForRun: vi.fn(() => []),
  hasBlockingErrors: vi.fn((issues: unknown[]) => issues.length > 0),
}));
// Insight generation calls the provider; stub the call, keep the picker real.
vi.mock('../../../agents/conversationInsights', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../agents/conversationInsights')>();
  return {
    ...mod,
    generateConversationInsight: vi.fn(async () => ({
      ok: true,
      text: 'The gist of it.',
      model: 'test-model',
      durationMs: 5,
    })),
  };
});

import { generateConversationInsight } from '../../../agents/conversationInsights';
import { createAgent, createPlayground, createProvider } from '../../../domain/factories';
import type { TranscriptMessage } from '../../../domain/schema';
import { continueRun, startRun } from '../../../orchestrator/orchestrator';
import { useDomainStore } from '../../../store/domainStore';
import { useProviderStore } from '../../../store/providerStore';
import { useRuntimeStore } from '../../../store/runtimeStore';
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
  vi.clearAllMocks();
  useDomainStore.setState({ playground: null, index: [], saveStatus: 'saved' });
  useUiStore.setState({ openPanel: 'timeline' });
  useProviderStore.setState({ providers: [] });
  useRuntimeStore.getState().reset();
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

  it('shows a live streaming card under the current turn while a run is active', () => {
    const agent = createAgent({ name: 'Researcher', colorCategory: 'teal' });
    const playground = {
      ...createPlayground('Demo'),
      agents: [agent],
      transcript: [
        msg({ id: 'a', turn: 1, agentId: agent.id, agentName: 'Researcher', content: 'Done.' }),
      ],
    };
    useDomainStore.setState({ playground });
    useRuntimeStore.setState({
      status: 'running',
      activeAgentId: agent.id,
      currentTurn: 2,
      streamingText: { [agent.id]: 'Partial reply' },
    });

    render(<TimelinePage />);

    expect(screen.getByLabelText('Turn 2')).toBeInTheDocument();
    expect(screen.getByText('streaming…')).toBeInTheDocument();
    expect(screen.getByText(/Partial reply/)).toBeInTheDocument();
  });

  it('shows a live card when the transcript is empty but a run is streaming', () => {
    const agent = createAgent({ name: 'Opener' });
    const playground = { ...createPlayground('Demo'), agents: [agent], transcript: [] };
    useDomainStore.setState({ playground });
    useRuntimeStore.setState({
      status: 'running',
      activeAgentId: agent.id,
      currentTurn: 1,
      streamingText: { [agent.id]: '' },
    });

    render(<TimelinePage />);

    expect(screen.queryByText(/No conversation yet/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Turn 1')).toBeInTheDocument();
    expect(screen.getByText('thinking…')).toBeInTheDocument();
  });

  it('keeps live reasoning behind a thinking chip while the answer streams', () => {
    const agent = createAgent({ name: 'Reasoner' });
    const playground = { ...createPlayground('Demo'), agents: [agent], transcript: [] };
    useDomainStore.setState({ playground });
    useRuntimeStore.setState({
      status: 'running',
      activeAgentId: agent.id,
      currentTurn: 1,
      streamingText: { [agent.id]: 'visible answer' },
      streamingReasoning: { [agent.id]: 'hidden chain of thought' },
    });

    render(<TimelinePage />);

    expect(screen.getByText('streaming…')).toBeInTheDocument();
    expect(screen.getByText(/visible answer/)).toBeInTheDocument();
    expect(screen.queryByText(/hidden chain of thought/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /thinking/i }));
    expect(screen.getByText(/hidden chain of thought/)).toBeInTheDocument();
  });

  it('removes the live card after streaming clears', () => {
    const agent = createAgent({ name: 'Researcher' });
    const playground = {
      ...createPlayground('Demo'),
      agents: [agent],
      transcript: [msg({ id: 'a', turn: 1, agentId: agent.id, agentName: 'Researcher', content: 'Final.' })],
    };
    useDomainStore.setState({ playground });
    useRuntimeStore.setState({
      status: 'idle',
      activeAgentId: null,
      currentTurn: 1,
      streamingText: {},
    });

    render(<TimelinePage />);

    expect(screen.queryByText('streaming…')).not.toBeInTheDocument();
    expect(screen.queryByText('thinking…')).not.toBeInTheDocument();
    expect(screen.getByText('Final.')).toBeInTheDocument();
  });
});

describe('TimelinePage footer tools', () => {
  function seedConversation() {
    const agent = createAgent({ name: 'Researcher' });
    const playground = {
      ...createPlayground('Demo'),
      agents: [agent],
      transcript: [
        msg({ id: 'a', turn: 1, agentId: agent.id, agentName: 'Researcher', content: 'Opening idea.' }),
      ],
    };
    useDomainStore.setState({ playground });
    return { agent, playground };
  }

  it('hides the footer and disables Export while there is no conversation', () => {
    useDomainStore.setState({ playground: createPlayground('Empty') });
    render(<TimelinePage />);
    expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export ▾' })).toBeDisabled();
  });

  it('opens the export menu with all formats and a copy action', () => {
    seedConversation();
    render(<TimelinePage />);

    fireEvent.click(screen.getByRole('button', { name: 'Export ▾' }));
    expect(screen.getByRole('menuitem', { name: 'Markdown (.md)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Plain text (.txt)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'JSON (.json)' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copy as Markdown' })).toBeInTheDocument();
  });

  it('continues the run with the selected number of extra turns', () => {
    seedConversation();
    render(<TimelinePage />);

    fireEvent.change(screen.getByLabelText('How many more turns to run'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: '▶ Continue' }));
    expect(startRun).toHaveBeenCalledWith({ maxTurns: 4 });
  });

  it('disables Continue while a run is active', () => {
    seedConversation();
    useRuntimeStore.setState({ status: 'running' });
    render(<TimelinePage />);
    expect(screen.getByRole('button', { name: '▶ Continue' })).toBeDisabled();
  });

  it('keeps the interject composer collapsed until toggled, then sends via continueRun', () => {
    seedConversation();
    render(<TimelinePage />);

    expect(screen.queryByLabelText('Message to the agents')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Interject/ }));

    const box = screen.getByLabelText('Message to the agents');
    fireEvent.change(box, { target: { value: 'Please argue the other side.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(continueRun).toHaveBeenCalledWith('Please argue the other side.');
    expect((box as HTMLTextAreaElement).value).toBe('');
  });

  it('generates and shows a summary via the borrowed agent provider', async () => {
    const provider = createProvider({ displayName: 'Local' });
    useProviderStore.setState({ providers: [provider] });
    const agent = createAgent({ name: 'Researcher' });
    agent.llm.providerId = provider.id;
    agent.llm.model = 'test-model';
    const playground = {
      ...createPlayground('Demo'),
      agents: [agent],
      transcript: [
        msg({ id: 'a', turn: 1, agentId: agent.id, agentName: 'Researcher', content: 'Opening idea.' }),
      ],
    };
    useDomainStore.setState({ playground });

    render(<TimelinePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Summarize' }));

    expect(await screen.findByText('The gist of it.')).toBeInTheDocument();
    expect(vi.mocked(generateConversationInsight).mock.calls[0][0]).toBe('summary');
  });

  it('disables Summarize/Review when no agent has a usable provider', () => {
    seedConversation(); // agent has no providerId/model
    render(<TimelinePage />);
    expect(screen.getByRole('button', { name: 'Summarize' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Review' })).toBeDisabled();
  });
});
