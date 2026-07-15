import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// Stub persistence so seeding the store doesn't try to hit IndexedDB.
vi.mock('../../../persistence/db', () => import('../../../test/persistenceDbMock'));

import { createAgent, createPlayground, createProvider } from '../../../domain/factories';
import { useDomainStore } from '../../../store/domainStore';
import { useProviderStore } from '../../../store/providerStore';
import { AgentInspector } from '../AgentInspector';

/** Re-reads the agent from the store so applied patches re-render. */
function ConnectedInspector({ agentId }: { agentId: string }) {
  const agent = useDomainStore((s) => s.playground!.agents.find((a) => a.id === agentId))!;
  return <AgentInspector agent={agent} />;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useProviderStore.setState({ providers: [], hydrated: false });
});

describe('AgentInspector — agent Type (kind)', () => {
  function seed() {
    const provider = createProvider({ displayName: 'P', baseUrl: 'https://x.test', apiKey: 'k', enabled: true });
    const agent = createAgent({
      name: 'A',
      systemInstruction: 'do',
      llm: { providerId: provider.id, model: 'm1', temperature: 0.7, maxOutputTokens: 1024 },
    });
    const pg = createPlayground();
    pg.agents = [agent];
    useProviderStore.setState({ providers: [provider], hydrated: true });
    useDomainStore.setState({ playground: pg, saveStatus: 'saved' });
    return agent;
  }

  it('defaults to participant and shows no wrap-up hint', () => {
    const agent = seed();
    render(<ConnectedInspector agentId={agent.id} />);
    const select = screen.getByLabelText('Type') as HTMLSelectElement;
    expect(select.value).toBe('participant');
    expect(screen.queryByText(/runs automatically in the wrap-up phase/i)).not.toBeInTheDocument();
  });

  it('switching to finalizer persists the kind and shows the wrap-up hint', async () => {
    const agent = seed();
    render(<ConnectedInspector agentId={agent.id} />);
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'finalizer' } });

    await waitFor(() =>
      expect(useDomainStore.getState().playground!.agents[0].kind).toBe('finalizer'),
    );
    expect(screen.getByText(/runs automatically in the wrap-up phase/i)).toBeInTheDocument();
    expect(screen.getByText(/produce the final word/i)).toBeInTheDocument();
  });

  it('shows the facilitation hint for a moderator', async () => {
    const agent = seed();
    render(<ConnectedInspector agentId={agent.id} />);
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'moderator' } });

    await waitFor(() =>
      expect(useDomainStore.getState().playground!.agents[0].kind).toBe('moderator'),
    );
    expect(screen.getByText(/facilitation contract/i)).toBeInTheDocument();
  });
});
