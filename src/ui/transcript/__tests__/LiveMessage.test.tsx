import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { LiveMessage } from '../LiveMessage';

afterEach(() => cleanup());

describe('LiveMessage direction', () => {
  it('streams a Persian response right-to-left', () => {
    const { container } = render(
      <LiveMessage agentName="تحلیل‌گر" role={null} text="در حال نوشتن" language="fa" />,
    );
    expect(container.querySelector('div[dir]')?.getAttribute('dir')).toBe('rtl');
  });

  it('streams English/French responses left-to-right', () => {
    const en = render(<LiveMessage agentName="Analyst" role={null} text="writing" language="en" />);
    expect(en.container.querySelector('div[dir]')?.getAttribute('dir')).toBe('ltr');

    const fr = render(<LiveMessage agentName="Analyste" role={null} text="en train" language="fr" />);
    expect(fr.container.querySelector('div[dir]')?.getAttribute('dir')).toBe('ltr');
  });

  it('stays right-to-left from the very first streamed characters', () => {
    // The bug this guards against: dir="auto" on the body has no strong
    // directional character to key off yet when streaming has barely
    // started, so it silently falls back to LTR until enough RTL script
    // accumulates — even though the agent's language is known up front.
    const { container } = render(<LiveMessage agentName="تحلیل‌گر" role={null} text="" language="fa" />);
    const dirEls = Array.from(container.querySelectorAll('[dir]'));
    expect(dirEls.map((el) => el.getAttribute('dir'))).toEqual(['rtl']);
  });

  it('hides inline thinking from the live body until answer tokens arrive', () => {
    const { container, rerender } = render(
      <LiveMessage
        agentName="Analyst"
        role={null}
        text="Thinking Process:\n1. Analyze</think>"
        language="en"
      />,
    );
    expect(container.textContent).toContain('thinking…');
    expect(container.textContent).toContain('thinking');
    expect(container.textContent).not.toContain('Thinking Process');
    expect(container.textContent).not.toContain('Analyze');

    rerender(
      <LiveMessage
        agentName="Analyst"
        role={null}
        text="Thinking Process:\n1. Analyze</think>\nfinal answer"
        language="en"
      />,
    );
    expect(container.textContent).toContain('streaming…');
    expect(container.textContent).toContain('final answer');
    expect(container.textContent).not.toContain('Thinking Process');
  });

  it('shows a collapsed thinking chip for API reasoning while answer streams separately', () => {
    const { container, getByRole } = render(
      <LiveMessage
        agentName="Analyst"
        role={null}
        text="final answer"
        reasoning="chain of thought"
        language="en"
      />,
    );
    expect(container.textContent).toContain('streaming…');
    expect(container.textContent).toContain('final answer');
    expect(container.textContent).not.toContain('chain of thought');

    fireEvent.click(getByRole('button', { name: /thinking/i }));
    expect(container.textContent).toContain('chain of thought');
  });

  it('keeps thinking… badge when only reasoning tokens have arrived', () => {
    const { container } = render(
      <LiveMessage
        agentName="Analyst"
        role={null}
        text=""
        reasoning="still thinking"
        language="en"
      />,
    );
    expect(container.textContent).toContain('thinking…');
    expect(container.textContent).not.toContain('still thinking');
  });
});
