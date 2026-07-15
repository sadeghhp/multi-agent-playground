import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../persistence/db', () => import('../../test/persistenceDbMock'));

vi.mock('../../providers/openaiAdapter', () => ({
  sendChat: vi.fn(),
}));
import { sendChat } from '../../providers/openaiAdapter';
const sendChatMock = vi.mocked(sendChat);

import type { NormalizedResponse } from '../../providers/types';
import { createPlayground, createProvider } from '../../domain/factories';
import { useDomainStore } from '../../store/domainStore';
import { useProviderStore } from '../../store/providerStore';
import { useUiStore } from '../../store/uiStore';
import { CreateAgentWithAiModal } from '../CreateAgentWithAiModal';

const VALID_DRAFT = {
  name: 'Critic',
  description: 'Skeptically reviews claims.',
  role: 'Skeptical reviewer',
  systemInstruction: 'Challenge unsupported claims and identify weaknesses.',
  language: 'en',
  characteristics: {
    tone: 'direct',
    verbosity: 50,
    creativity: 40,
    assertiveness: 70,
    skepticism: 85,
    cooperation: 35,
  },
  colorCategory: 'red',
  skills: [{ name: 'critique', description: 'Critical review', instruction: 'Focus on factual weaknesses.' }],
};

function reply(text: string): NormalizedResponse {
  return { text, model: 'm1', finishReason: 'stop', raw: {}, durationMs: 5, status: 200 };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useProviderStore.setState({ providers: [], hydrated: false });
  useUiStore.setState({ selection: { kind: 'none' }, openPanel: 'none' });
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
  useProviderStore.setState({ providers: [provider], hydrated: true });
  useDomainStore.setState({ playground: pg, saveStatus: 'saved' });
  return provider;
}

describe('CreateAgentWithAiModal', () => {
  it('disables Generate until a description is entered', () => {
    seed();
    render(<CreateAgentWithAiModal />);
    const btn = screen.getByRole('button', { name: /^generate$/i });
    expect(btn).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/describe the agent/i), { target: { value: 'a critic' } });
    expect(btn).not.toBeDisabled();
  });

  it('streams partial output, then shows a structured preview on success', async () => {
    seed();
    let resolveSend: (value: NormalizedResponse) => void = () => {};
    sendChatMock.mockImplementation(
      (_provider, _params, options) =>
        new Promise<NormalizedResponse>((resolve) => {
          resolveSend = resolve;
          options?.onToken?.('{"name":"Cri');
        }),
    );

    render(<CreateAgentWithAiModal />);
    fireEvent.change(screen.getByLabelText(/describe the agent/i), { target: { value: 'a critic' } });
    fireEvent.click(screen.getByRole('button', { name: /^generate$/i }));

    await waitFor(() => expect(screen.getByText(/"name":"Cri/)).toBeInTheDocument());

    resolveSend(reply(JSON.stringify(VALID_DRAFT)));

    await waitFor(() => expect(screen.getByText('Critic')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument();
  });

  it('creates and selects the agent on Apply, then closes the panel', async () => {
    seed();
    sendChatMock.mockResolvedValue(reply(JSON.stringify(VALID_DRAFT)));
    useUiStore.setState({ openPanel: 'createAgentAi' });

    render(<CreateAgentWithAiModal />);
    fireEvent.change(screen.getByLabelText(/describe the agent/i), { target: { value: 'a critic' } });
    fireEvent.click(screen.getByRole('button', { name: /^generate$/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^apply$/i }));

    const agents = useDomainStore.getState().playground?.agents ?? [];
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('Critic');
    expect(useUiStore.getState().selection).toEqual({ kind: 'agent', id: agents[0].id });
    expect(useUiStore.getState().openPanel).toBe('none');
  });

  it('shows an error and the raw response on invalid JSON, without creating an agent', async () => {
    seed();
    sendChatMock.mockResolvedValue(reply('I cannot help with that.'));

    render(<CreateAgentWithAiModal />);
    fireEvent.change(screen.getByLabelText(/describe the agent/i), { target: { value: 'a critic' } });
    fireEvent.click(screen.getByRole('button', { name: /^generate$/i }));

    await waitFor(() => expect(screen.getByText(/invalid-json/i)).toBeInTheDocument());
    expect(useDomainStore.getState().playground?.agents ?? []).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /show raw response/i }));
    expect(screen.getByText(/i cannot help with that/i)).toBeInTheDocument();
  });

  it('auto-normalizes stanceNotes arrays and shows the draft without an error', async () => {
    seed();
    sendChatMock.mockResolvedValue(
      reply(
        JSON.stringify({
          ...VALID_DRAFT,
          name: 'Thomas Nagel',
          personaMode: 'digital-shadow',
          persona: {
            realName: 'Thomas Nagel',
            knownFor: 'Philosophy of mind',
            stanceNotes: ['Qualia are real'],
            citationStyle: 'in-character',
          },
        }),
      ),
    );

    render(<CreateAgentWithAiModal />);
    fireEvent.change(screen.getByLabelText(/describe the agent/i), { target: { value: 'nagel' } });
    fireEvent.click(screen.getByRole('button', { name: /^generate$/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /^apply$/i })).toBeInTheDocument());
    expect(screen.queryByText(/invalid-json/i)).not.toBeInTheDocument();
    expect(screen.getByText('Thomas Nagel')).toBeInTheDocument();
  });

  it('offers Recover draft for unrecoverable shape errors', async () => {
    seed();
    sendChatMock.mockResolvedValue(reply(JSON.stringify({ foo: 'bar' })));

    render(<CreateAgentWithAiModal />);
    fireEvent.change(screen.getByLabelText(/describe the agent/i), { target: { value: 'a critic' } });
    fireEvent.click(screen.getByRole('button', { name: /^generate$/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /recover draft/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /recover draft/i }));

    await waitFor(() => expect(screen.getByText(/recovery failed/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^apply$/i })).not.toBeInTheDocument();
  });

  it('aborts the in-flight request when the modal is closed mid-generation', async () => {
    seed();
    sendChatMock.mockImplementation(() => new Promise<NormalizedResponse>(() => {}));

    render(<CreateAgentWithAiModal />);
    fireEvent.change(screen.getByLabelText(/describe the agent/i), { target: { value: 'a critic' } });
    fireEvent.click(screen.getByRole('button', { name: /^generate$/i }));

    await waitFor(() => expect(sendChatMock).toHaveBeenCalled());
    const signal = sendChatMock.mock.calls[0][2]?.signal;
    expect(signal?.aborted).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(signal?.aborted).toBe(true);
  });

  it('disables the feature entirely when there are no enabled providers', () => {
    useProviderStore.setState({ providers: [], hydrated: true });
    useDomainStore.setState({ playground: createPlayground(), saveStatus: 'saved' });

    render(<CreateAgentWithAiModal />);
    const btn = screen.getByRole('button', { name: /^generate$/i });
    expect(btn).toBeDisabled();
    expect(screen.getByText(/no enabled providers/i)).toBeInTheDocument();
  });
});
