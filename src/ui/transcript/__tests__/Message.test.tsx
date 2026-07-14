import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TranscriptMessage } from '../../../domain/schema';
import { useUiStore } from '../../../store/uiStore';
import { Message } from '../Message';

function msg(over: Partial<TranscriptMessage> = {}): TranscriptMessage {
  return {
    id: 'm', turn: 1, agentId: null, agentName: 'Agent', agentDeleted: false,
    role: '', model: '', providerId: null, content: 'hello world', status: 'completed',
    sourceAgentId: null, connectionType: null, timestamp: 1_700_000_000_000,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

beforeEach(() => {
  useUiStore.setState({ toast: null });
});

describe('Message copy button (L-15 regression)', () => {
  it('shows a success toast only after the clipboard write actually resolves', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<Message msg={msg()} />);
    fireEvent.click(screen.getByLabelText('Copy response'));

    expect(writeText).toHaveBeenCalledWith('hello world');
    // Wait for the promise microtask to resolve.
    await Promise.resolve();
    await Promise.resolve();
    expect(useUiStore.getState().toast).toMatchObject({ kind: 'info' });
  });

  it('shows an error toast when the clipboard write rejects, not a false success', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<Message msg={msg()} />);
    fireEvent.click(screen.getByLabelText('Copy response'));

    await Promise.resolve();
    await Promise.resolve();
    expect(useUiStore.getState().toast).toMatchObject({ kind: 'error' });
  });

  it('shows an error toast immediately when the Clipboard API is unavailable', () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    render(<Message msg={msg()} />);
    fireEvent.click(screen.getByLabelText('Copy response'));

    expect(useUiStore.getState().toast).toMatchObject({ kind: 'error' });
  });
});
