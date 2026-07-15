import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationRun } from '../../../domain/schema';
import { createPlayground } from '../../../domain/factories';
import { useDomainStore } from '../../../store/domainStore';
import { useRunHistoryStore } from '../../../store/runHistoryStore';
import { useUiStore } from '../../../store/uiStore';
import { ConversationRunsPanel } from '../ConversationRunsPanel';
import { ConfirmDialog } from '../../ConfirmDialog';

vi.mock('../../../persistence/db', () => import('../../../test/persistenceDbMock'));

function sampleRun(version: number): ConversationRun {
  const pg = createPlayground('Test');
  return {
    id: `run_${version}`,
    playgroundId: pg.id,
    version,
    parentRunId: version > 1 ? `run_${version - 1}` : null,
    startedAt: Date.now(),
    endedAt: Date.now() + 500,
    status: 'completed',
    conversation: { ...pg.conversation, subject: `Subject ${version}` },
    transcript: [
      {
        id: `msg_${version}`,
        turn: 1,
        agentId: 'a1',
        agentName: 'Agent',
        agentDeleted: false,
        role: 'assistant',
        language: 'en',
        model: 'test',
        providerId: null,
        content: `Reply ${version}`,
        status: 'completed',
        sourceAgentId: null,
        connectionType: null,
        timestamp: Date.now(),
      },
    ],
    events: [{ id: 'e1', at: Date.now(), kind: 'run-started', message: 'Started' }],
    messageCountAtStart: 0,
  };
}

beforeEach(() => {
  const pg = createPlayground('Panel Test');
  useDomainStore.setState({ playground: pg });
  useUiStore.setState({ openPanel: 'runHistory', confirm: null, toast: null });
  useRunHistoryStore.setState({ playgroundId: pg.id, runs: [sampleRun(1), sampleRun(2)] });
});

describe('ConversationRunsPanel', () => {
  it('lists runs and opens review', async () => {
    render(
      <>
        <ConversationRunsPanel />
        <ConfirmDialog />
      </>,
    );

    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]!);
    expect(screen.getByText('Reply 2')).toBeInTheDocument();
    expect(screen.getByText(/Execution path/)).toBeInTheDocument();
  });

  it('deletes a run after confirmation', async () => {
    const removeRun = vi.fn().mockResolvedValue(undefined);
    useRunHistoryStore.setState({ removeRun });

    render(
      <>
        <ConversationRunsPanel />
        <ConfirmDialog />
      </>,
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete run v2' })[0]!);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(removeRun).toHaveBeenCalledWith('run_2');
    });
  });
});
