import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../persistence/db', () => import('../../test/persistenceDbMock'));

vi.mock('../../providers/openaiAdapter', () => ({
  sendChat: vi.fn(),
}));
import { sendChat } from '../../providers/openaiAdapter';
const sendChatMock = vi.mocked(sendChat);

import type { NormalizedResponse } from '../../providers/types';
import { createAgent, createPlayground, createProvider } from '../../domain/factories';
import { useDomainStore } from '../../store/domainStore';
import { useProviderStore } from '../../store/providerStore';
import { useUiStore } from '../../store/uiStore';
import { SmartArrangeModal } from '../SmartArrangeModal';

function reply(text: string): NormalizedResponse {
  return { text, model: 'm1', finishReason: 'stop', raw: {}, durationMs: 5, status: 200 };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useProviderStore.setState({ providers: [], hydrated: false });
  useUiStore.setState({ selection: { kind: 'none' }, openPanel: 'none', fitViewNonce: 0 });
});

function seed() {
  const provider = createProvider({
    displayName: 'P',
    baseUrl: 'https://x.test',
    apiKey: 'k',
    enabled: true,
    defaultModel: 'm1',
    models: ['m1'],
  });
  const pg = createPlayground();
  pg.agents.push(
    createAgent({ id: 'ag_r', name: 'Researcher' }),
    createAgent({ id: 'ag_c', name: 'Critic' }),
  );
  pg.connections.push({
    id: 'old1',
    source: 'ag_c',
    target: 'ag_r',
    enabled: true,
    type: 'conversation',
    priority: 0,
  });
  useProviderStore.setState({ providers: [provider], hydrated: true });
  useDomainStore.setState({ playground: pg, saveStatus: 'saved' });
  return provider;
}

const VALID_ARRANGEMENT = JSON.stringify({
  startingAgentId: 'ag_r',
  connections: [
    { source: 'ag_r', target: 'ag_c', type: 'review', priority: 0 },
    { source: 'ag_c', target: 'ag_r', type: 'conversation', priority: 0 },
  ],
  settings: { conversationMode: 'debate', maxTotalTurns: 20 },
  rationale: 'Researcher proposes; critic reviews in a loop.',
});

describe('SmartArrangeModal', () => {
  it('disables Arrange until a subject is entered', () => {
    seed();
    render(<SmartArrangeModal />);
    const btn = screen.getByRole('button', { name: /^arrange$/i });
    expect(btn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/subject of the conversation/i), {
      target: { value: 'Should we ship?' },
    });
    expect(btn).not.toBeDisabled();
  });

  it('blocks with fewer than 2 enabled agents', () => {
    seed();
    const pg = useDomainStore.getState().playground!;
    useDomainStore.setState({
      playground: { ...pg, agents: pg.agents.slice(0, 1), connections: [] },
    });
    render(<SmartArrangeModal />);
    expect(screen.getByText(/add at least 2 enabled agents/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^arrange$/i })).toBeDisabled();
  });

  it('applies the arrangement instantly and shows the applied summary with Revert', async () => {
    seed();
    sendChatMock.mockResolvedValue(reply(VALID_ARRANGEMENT));

    render(<SmartArrangeModal />);
    fireEvent.change(screen.getByLabelText(/subject of the conversation/i), {
      target: { value: 'Should we ship?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^arrange$/i }));

    await waitFor(() => expect(screen.getByText(/arrangement applied/i)).toBeInTheDocument());

    const pg = useDomainStore.getState().playground!;
    expect(pg.connections).toHaveLength(2);
    expect(pg.connections.some((c) => c.source === 'ag_r' && c.target === 'ag_c' && c.type === 'review')).toBe(true);
    expect(pg.connections.some((c) => c.id === 'old1')).toBe(false); // replaced wholesale
    expect(pg.conversation.startingAgentId).toBe('ag_r');
    expect(pg.conversation.subject).toBe('Should we ship?');
    expect(pg.conversation.conversationMode).toBe('debate');
    expect(pg.conversation.maxTotalTurns).toBe(20);
    // Layout applied: the two agents no longer share a position.
    const [a, b] = pg.agents;
    expect(a.position).not.toEqual(b.position);
    expect(useUiStore.getState().fitViewNonce).toBeGreaterThan(0);
    expect(screen.getByText(/researcher proposes; critic reviews/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^revert$/i })).toBeInTheDocument();
  });

  it('restores the previous graph exactly on Revert', async () => {
    seed();
    const before = useDomainStore.getState().playground!;
    const beforeConnections = before.connections.map((c) => ({ ...c }));
    const beforePositions = before.agents.map((a) => ({ ...a.position }));
    sendChatMock.mockResolvedValue(reply(VALID_ARRANGEMENT));

    render(<SmartArrangeModal />);
    fireEvent.change(screen.getByLabelText(/subject of the conversation/i), {
      target: { value: 'Should we ship?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^arrange$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^revert$/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^revert$/i }));

    const after = useDomainStore.getState().playground!;
    expect(after.connections).toEqual(beforeConnections);
    expect(after.agents.map((a) => a.position)).toEqual(beforePositions);
    expect(after.conversation.startingAgentId).toBe(before.conversation.startingAgentId);
    expect(after.conversation.maxTotalTurns).toBe(before.conversation.maxTotalTurns);
  });

  it('shows an error with the raw response when the reply is not an arrangement', async () => {
    seed();
    sendChatMock.mockResolvedValue(reply('I cannot help with that.'));

    render(<SmartArrangeModal />);
    fireEvent.change(screen.getByLabelText(/subject of the conversation/i), {
      target: { value: 'Should we ship?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^arrange$/i }));

    await waitFor(() => expect(screen.getByText(/invalid-json/i)).toBeInTheDocument());
    // Graph untouched on failure.
    expect(useDomainStore.getState().playground!.connections.map((c) => c.id)).toEqual(['old1']);

    fireEvent.click(screen.getByRole('button', { name: /show raw response/i }));
    expect(screen.getByText(/i cannot help with that/i)).toBeInTheDocument();
  });

  it('aborts the in-flight request when the modal is closed mid-arrangement', async () => {
    seed();
    sendChatMock.mockImplementation(() => new Promise<NormalizedResponse>(() => {}));

    render(<SmartArrangeModal />);
    fireEvent.change(screen.getByLabelText(/subject of the conversation/i), {
      target: { value: 'Should we ship?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^arrange$/i }));

    await waitFor(() => expect(sendChatMock).toHaveBeenCalled());
    const signal = sendChatMock.mock.calls[0][2]?.signal;
    expect(signal?.aborted).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(signal?.aborted).toBe(true);
  });
});
