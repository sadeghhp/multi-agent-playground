import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
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
});
