import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// Stores pulled in transitively (domain/provider/library/run-preset) all reach
// persistence/db; stub it so mounting the dialog never touches IndexedDB.
vi.mock('../../persistence/db', () => ({
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
  saveRunPreset: vi.fn().mockResolvedValue(undefined),
  loadAllRunPresets: vi.fn().mockResolvedValue([]),
  deleteRunPreset: vi.fn().mockResolvedValue(undefined),
}));

import { createAgent, createPlayground } from '../../domain/factories';
import { useDomainStore } from '../../store/domainStore';
import { useProviderStore } from '../../store/providerStore';
import { RunDialog } from '../RunDialog';

afterEach(() => cleanup());

function setUpPlayground() {
  const a = createAgent({ name: 'A' });
  const b = createAgent({ name: 'B' });
  const pg = { ...createPlayground('P'), agents: [a, b], connections: [] };
  useDomainStore.setState({ playground: pg, index: [], saveStatus: 'saved' });
}

beforeEach(() => {
  useDomainStore.setState({ playground: null, index: [], saveStatus: 'saved' });
  useProviderStore.setState({ providers: [] });
});

describe('RunDialog', () => {
  it('renders the environment picker and quick-start chips', () => {
    setUpPlayground();
    render(<RunDialog />);

    expect(screen.getByLabelText('Conversation environment')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Brainstorm' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Blameless postmortem' })).toBeTruthy();
  });

  it('applying a quick start sets the environment style but never the turn limits', () => {
    setUpPlayground();
    // User deliberately raised the turn cap before picking an environment.
    useDomainStore.getState().updateConversation({ maxTotalTurns: 40, stopOnError: false });

    render(<RunDialog />);
    fireEvent.click(screen.getByRole('button', { name: 'Brainstorm' }));

    const conv = useDomainStore.getState().playground!.conversation;
    expect(conv.conversationMode).toBe('brainstorm');
    // The style/environment fields the preset owns are applied…
    expect(conv.temperatureOverride).toBe(0.9);
    // …but the budget the user set is left completely untouched.
    expect(conv.maxTotalTurns).toBe(40);
    expect(conv.stopOnError).toBe(false);
  });

  it('changing the environment dropdown updates conversationMode', () => {
    setUpPlayground();
    render(<RunDialog />);

    fireEvent.change(screen.getByLabelText('Conversation environment'), { target: { value: 'debate' } });
    expect(useDomainStore.getState().playground!.conversation.conversationMode).toBe('debate');
  });
});
