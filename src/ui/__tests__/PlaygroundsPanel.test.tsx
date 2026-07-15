import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../../persistence/db', () => import('../../test/persistenceDbMock'));

import { PLAYGROUND_SAMPLES } from '../../domain/samples';
import { useDomainStore } from '../../store/domainStore';
import { useUiStore } from '../../store/uiStore';
import { PlaygroundsPanel } from '../PlaygroundsPanel';

afterEach(() => cleanup());

beforeEach(() => {
  useDomainStore.setState({ playground: null, index: [], saveStatus: 'saved' });
  useUiStore.setState({ openPanel: 'playgrounds' });
});

describe('PlaygroundsPanel', () => {
  it('lists every sample in the catalog', () => {
    render(<PlaygroundsPanel />);

    expect(screen.getByRole('heading', { name: 'Playgrounds' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sample playgrounds' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Your playgrounds' })).toBeTruthy();

    for (const sample of PLAYGROUND_SAMPLES) {
      expect(screen.getByRole('button', { name: new RegExp(sample.name) })).toBeTruthy();
    }
  });
});
