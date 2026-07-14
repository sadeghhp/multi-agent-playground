import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TranscriptMessage } from '../../../domain/schema';
import { useUiStore } from '../../../store/uiStore';
import { Message } from '../Message';

function makeMsg(over: Partial<TranscriptMessage> = {}): TranscriptMessage {
  return {
    id: 'm1',
    turn: 1,
    agentId: 'a1',
    agentName: 'Analyst',
    agentDeleted: false,
    role: '',
    language: 'en',
    model: 'm',
    providerId: null,
    content: 'Hello',
    status: 'completed',
    sourceAgentId: null,
    connectionType: null,
    timestamp: 0,
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

describe('Message direction', () => {
  it('renders a Persian message right-to-left', () => {
    const { container } = render(<Message msg={makeMsg({ language: 'fa', content: 'سلام' })} />);
    expect(container.querySelector('div[dir]')?.getAttribute('dir')).toBe('rtl');
  });

  it('renders English and French messages left-to-right', () => {
    const en = render(<Message msg={makeMsg({ language: 'en' })} />);
    expect(en.container.querySelector('div[dir]')?.getAttribute('dir')).toBe('ltr');

    const fr = render(<Message msg={makeMsg({ language: 'fr', content: 'Bonjour' })} />);
    expect(fr.container.querySelector('div[dir]')?.getAttribute('dir')).toBe('ltr');
  });

  it("does not let the body's direction diverge from the forced container direction", () => {
    // Regression guard: an inner dir="auto" would override the parent's
    // forced dir and guess LTR from short/neutral content, which is exactly
    // the bug this test protects against. Only the outer container (and the
    // always-LTR request-inspector panel, when open) may declare a dir.
    const { container } = render(<Message msg={makeMsg({ language: 'fa', content: 'سلام' })} />);
    const dirEls = Array.from(container.querySelectorAll('[dir]'));
    expect(dirEls.map((el) => el.getAttribute('dir'))).toEqual(['rtl']);
  });
});

describe('Message copy button (L-15 regression)', () => {
  it('shows a success toast only after the clipboard write actually resolves', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(<Message msg={makeMsg({ content: 'hello world' })} />);
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

    render(<Message msg={makeMsg()} />);
    fireEvent.click(screen.getByLabelText('Copy response'));

    await Promise.resolve();
    await Promise.resolve();
    expect(useUiStore.getState().toast).toMatchObject({ kind: 'error' });
  });

  it('shows an error toast immediately when the Clipboard API is unavailable', () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    render(<Message msg={makeMsg()} />);
    fireEvent.click(screen.getByLabelText('Copy response'));

    expect(useUiStore.getState().toast).toMatchObject({ kind: 'error' });
  });
});
