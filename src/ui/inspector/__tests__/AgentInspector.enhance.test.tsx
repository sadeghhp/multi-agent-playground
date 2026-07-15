import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Stub persistence so seeding the store doesn't try to hit IndexedDB.
vi.mock('../../../persistence/db', () => import('../../../test/persistenceDbMock'));

vi.mock('../../../providers/openaiAdapter', () => ({
  sendChat: vi.fn(),
}));
import { sendChat } from '../../../providers/openaiAdapter';
const sendChatMock = vi.mocked(sendChat);

import { createAgent, createPlayground, createProvider } from '../../../domain/factories';
import { useDomainStore } from '../../../store/domainStore';
import { useProviderStore } from '../../../store/providerStore';
import { AgentInspector } from '../AgentInspector';

/** Re-reads the agent from the store so applied patches re-render the textarea. */
function ConnectedInspector({ agentId }: { agentId: string }) {
  const agent = useDomainStore((s) => s.playground!.agents.find((a) => a.id === agentId))!;
  return <AgentInspector agent={agent} />;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useProviderStore.setState({ providers: [], hydrated: false });
});

describe('AgentInspector — enhance system prompt', () => {
  function seed() {
    const provider = createProvider({ displayName: 'P', baseUrl: 'https://x.test', apiKey: 'k', enabled: true });
    const agent = createAgent({
      name: 'Critic',
      systemInstruction: 'be critical',
      llm: { providerId: provider.id, model: 'm1', temperature: 0.7, maxOutputTokens: 1024 },
    });
    const pg = createPlayground();
    pg.agents = [agent];
    useProviderStore.setState({ providers: [provider], hydrated: true });
    useDomainStore.setState({ playground: pg, saveStatus: 'saved' });
    return agent;
  }

  it('proposes an enhanced prompt and applies the cleaned text to the field', async () => {
    sendChatMock.mockResolvedValue({
      text: '```\nCritically evaluate every claim and cite evidence.\n```',
      model: 'm1',
      finishReason: 'stop',
      raw: {},
      durationMs: 5,
      status: 200,
    });
    const agent = seed();
    render(<ConnectedInspector agentId={agent.id} />);

    const textarea = screen.getByLabelText('System instruction') as HTMLTextAreaElement;
    expect(textarea.value).toBe('be critical');

    fireEvent.click(screen.getByRole('button', { name: /enhance with ai/i }));

    // The proposal preview appears with the fence stripped.
    await waitFor(() =>
      expect(screen.getByText(/critically evaluate every claim/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText('```')).not.toBeInTheDocument();

    // Apply writes the cleaned text into the textarea and dismisses the preview.
    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));
    await waitFor(() =>
      expect(textarea.value).toBe('Critically evaluate every claim and cite evidence.'),
    );
    expect(screen.queryByRole('button', { name: /^apply$/i })).not.toBeInTheDocument();
  });

  it('disables the button and explains why when no model is set', () => {
    const provider = createProvider({ displayName: 'P', baseUrl: 'https://x.test', enabled: true });
    const agent = createAgent({
      llm: { providerId: provider.id, model: '', temperature: 0.7, maxOutputTokens: 1024 },
    });
    const pg = createPlayground();
    pg.agents = [agent];
    useProviderStore.setState({ providers: [provider], hydrated: true });
    useDomainStore.setState({ playground: pg, saveStatus: 'saved' });

    render(<ConnectedInspector agentId={agent.id} />);
    const btn = screen.getByRole('button', { name: /enhance with ai/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/select a model to enable ai enhancement/i)).toBeInTheDocument();
  });
});

describe('AgentInspector — enrich with AI recovery', () => {
  function seed() {
    const provider = createProvider({ displayName: 'P', baseUrl: 'https://x.test', apiKey: 'k', enabled: true });
    const agent = createAgent({
      name: 'Critic',
      systemInstruction: 'be critical',
      llm: { providerId: provider.id, model: 'm1', temperature: 0.7, maxOutputTokens: 1024 },
    });
    const pg = createPlayground();
    pg.agents = [agent];
    useProviderStore.setState({ providers: [provider], hydrated: true });
    useDomainStore.setState({ playground: pg, saveStatus: 'saved' });
    return agent;
  }

  it('shows raw response and Recover draft on enrich shape errors', async () => {
    sendChatMock.mockResolvedValue({
      text: JSON.stringify({ foo: 'bar' }),
      model: 'm1',
      finishReason: 'stop',
      raw: {},
      durationMs: 5,
      status: 200,
    });
    const agent = seed();
    render(<ConnectedInspector agentId={agent.id} />);

    fireEvent.click(screen.getByRole('button', { name: /enrich with ai/i }));
    fireEvent.change(screen.getByPlaceholderText(/double-check any numeric claims/i), {
      target: { value: 'Also fact-check figures.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /🌱 enrich with ai/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /recover draft/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /show raw response/i }));
    expect(screen.getByText(/"foo":"bar"/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /recover draft/i }));
    await waitFor(() => expect(screen.getByText(/recovery failed/i)).toBeInTheDocument());
  });
});
