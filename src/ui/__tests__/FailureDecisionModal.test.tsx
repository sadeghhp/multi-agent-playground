import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { FailureDecision } from '../../store/uiStore';
import { useUiStore } from '../../store/uiStore';
import { FailureDecisionModal } from '../FailureDecisionModal';

afterEach(() => {
  cleanup();
  useUiStore.setState({ failureDecision: null });
});

describe('FailureDecisionModal', () => {
  it('renders nothing when there is no pending decision', () => {
    const { container } = render(<FailureDecisionModal />);
    expect(container.firstChild).toBeNull();
  });

  it('resolves the pending decision when a control is clicked', async () => {
    render(<FailureDecisionModal />);

    // Assign inside act (not via the callback's return value, which would flip
    // act into async mode and defer the render flush) so the modal is mounted
    // synchronously before we query it.
    let pending!: Promise<FailureDecision>;
    act(() => {
      pending = useUiStore.getState().requestFailureDecision({
        agentName: 'Researcher',
        errorSummary: 'boom',
        consecutiveFailures: 3,
        suggestDisable: true,
      });
    });

    expect(screen.getByRole('button', { name: 'Remove from circuit' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove from circuit' }));
    await expect(pending).resolves.toBe('disable');
    expect(useUiStore.getState().failureDecision).toBeNull();
  });

  it('closing via "Stop run" resolves to the safe default', async () => {
    render(<FailureDecisionModal />);

    let pending!: Promise<FailureDecision>;
    act(() => {
      pending = useUiStore.getState().requestFailureDecision({
        agentName: 'Writer',
        errorSummary: 'nope',
        consecutiveFailures: 1,
        suggestDisable: false,
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Stop run' }));
    await expect(pending).resolves.toBe('stop');
  });
});
