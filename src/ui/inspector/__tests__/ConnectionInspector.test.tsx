import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../persistence/db', () => ({
  savePlayground: vi.fn().mockResolvedValue(undefined),
  loadPlayground: vi.fn().mockResolvedValue(undefined),
  loadAllPlaygrounds: vi.fn().mockResolvedValue([]),
  deletePlayground: vi.fn().mockResolvedValue(undefined),
}));

import { createAgent, createPlayground } from '../../../domain/factories';
import { useDomainStore } from '../../../store/domainStore';
import { ConnectionInspector } from '../ConnectionInspector';

afterEach(() => cleanup());

function setUpPlayground() {
  const a = createAgent({ name: 'A' });
  const b = createAgent({ name: 'B' });
  const connection = { id: 'c1', source: a.id, target: b.id, enabled: true, type: 'conversation' as const, priority: 5 };
  const pg = { ...createPlayground('P'), agents: [a, b], connections: [connection] };
  useDomainStore.setState({ playground: pg, index: [], saveStatus: 'saved' });
  return connection;
}

beforeEach(() => {
  useDomainStore.setState({ playground: null, index: [], saveStatus: 'saved' });
});

describe('ConnectionInspector priority field (L-16 regression)', () => {
  it('does not silently coerce a cleared field to 0', () => {
    const connection = setUpPlayground();
    render(<ConnectionInspector connection={connection} />);

    const input = screen.getByLabelText(/priority/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });

    // Clearing the field must not have persisted priority: 0 — the store's
    // connection should be untouched.
    const stored = useDomainStore.getState().playground!.connections[0];
    expect(stored.priority).toBe(5);
  });

  it('still accepts a valid negative or positive integer', () => {
    const connection = setUpPlayground();
    render(<ConnectionInspector connection={connection} />);

    const input = screen.getByLabelText(/priority/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-3' } });
    expect(useDomainStore.getState().playground!.connections[0].priority).toBe(-3);
  });
});
