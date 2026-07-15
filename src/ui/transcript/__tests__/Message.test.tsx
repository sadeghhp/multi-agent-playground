import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TranscriptMessage } from '../../../domain/schema';
import { useUiStore } from '../../../store/uiStore';
import { useRuntimeStore } from '../../../store/runtimeStore';
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
  useRuntimeStore.getState().reset();
});

beforeEach(() => {
  useUiStore.setState({ toast: null });
  useRuntimeStore.getState().reset();
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

describe('Message thinking chip', () => {
  it('hides reasoning by default and reveals it when the thinking chip is clicked', () => {
    render(
      <Message
        msg={makeMsg({
          content: 'visible answer',
          reasoning: 'hidden chain of thought',
        })}
      />,
    );

    expect(screen.getByText('visible answer')).toBeTruthy();
    expect(screen.queryByText('hidden chain of thought')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /thinking/i }));
    expect(screen.getByText('hidden chain of thought')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /thinking/i }));
    expect(screen.queryByText('hidden chain of thought')).toBeNull();
  });

  it('shows a hint when the turn has thinking but no visible answer', () => {
    render(
      <Message
        msg={makeMsg({
          content: '',
          reasoning: 'only chain of thought',
        })}
      />,
    );

    expect(screen.getByText(/No visible answer/i)).toBeTruthy();
    expect(screen.queryByText('only chain of thought')).toBeNull();
  });

  it('pulls closer-only think blocks out of content into the collapsed chip', () => {
    render(
      <Message
        msg={makeMsg({
          content: 'Thinking Process:\n1. Analyze</think>\nfinal answer',
        })}
      />,
    );

    expect(screen.getByText('final answer')).toBeTruthy();
    expect(screen.queryByText(/Thinking Process/)).toBeNull();
    expect(screen.queryByText(/Analyze/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /thinking/i }));
    expect(screen.getByText(/Thinking Process/)).toBeTruthy();
  });
});

describe('Message failure diagnostics', () => {
  it('shows upstream text, hints, and auto-opens the request inspector', () => {
    useRuntimeStore.getState().recordSnapshot('m1', {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      providerName: 'Open Router',
      model: 'google/gemini-2.5-flash-lite',
      messages: [
        { role: 'system', content: 'You are Agent: Truth Seeker.' },
        { role: 'user', content: 'Respond.' },
      ],
      params: { temperature: 0.7, maxOutputTokens: 8192 },
      status: 502,
      error: 'The provider rejected the request (check the model and parameters). (Request contains an invalid argument.)',
      errorKind: 'bad-request',
      errorType: 'unmapped',
      rawUpstream: 'Request contains an invalid argument.',
      streamedError: true,
      promptMessages: 2,
      promptChars: 40,
      partialOutputChars: 7,
    });

    render(
      <Message
        msg={makeMsg({
          id: 'm1',
          status: 'failed',
          content: '',
          error: 'The provider rejected the request (check the model and parameters). (Request contains an invalid argument.)',
        })}
      />,
    );

    expect(screen.getByText(/Request rejected/i)).toBeTruthy();
    expect(screen.getAllByText(/Request contains an invalid argument/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/What to try/i)).toBeTruthy();
    expect(screen.getByText(/Max output tokens/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copy diagnostics/i })).toBeTruthy();
    // Inspector auto-opens on failure.
    expect(screen.getByText('URL')).toBeTruthy();
    expect(screen.getByText('Upstream')).toBeTruthy();
  });

  it('copies a redacted diagnostics blob to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    useRuntimeStore.getState().recordSnapshot('m1', {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      providerName: 'Open Router',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      params: { maxOutputTokens: 2048 },
      status: 502,
      errorKind: 'server-error',
      streamedError: true,
      error: 'server error',
      promptMessages: 1,
      promptChars: 2,
    });

    render(
      <Message msg={makeMsg({ id: 'm1', status: 'failed', content: '', error: 'server error' })} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Copy diagnostics/i }));

    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalled();
    const copied = JSON.parse(writeText.mock.calls[0][0] as string);
    expect(copied.model).toBe('m');
    expect(copied.errorKind).toBe('server-error');
    expect(JSON.stringify(copied)).not.toMatch(/authorization|bearer|api[-_]?key/i);
    expect(useUiStore.getState().toast).toMatchObject({ kind: 'info' });
  });
});
