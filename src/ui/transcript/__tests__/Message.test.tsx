import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { TranscriptMessage } from '../../../domain/schema';
import { Message } from '../Message';

afterEach(() => cleanup());

function makeMsg(overrides: Partial<TranscriptMessage> = {}): TranscriptMessage {
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
    ...overrides,
  };
}

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
