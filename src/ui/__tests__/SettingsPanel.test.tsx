import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// Stores reach persistence/db transitively; stub it so mounting never touches IndexedDB.
vi.mock('../../persistence/db', () => import('../../test/persistenceDbMock'));

import { createProvider } from '../../domain/factories';
import { DEFAULT_LLM_SETTINGS } from '../../domain/llmSettings';
import { useLlmSettingsStore } from '../../store/llmSettingsStore';
import { useProviderStore } from '../../store/providerStore';
import { SettingsPanel } from '../SettingsPanel';

afterEach(() => cleanup());

beforeEach(() => {
  useLlmSettingsStore.setState({ settings: { ...DEFAULT_LLM_SETTINGS } });
  useProviderStore.setState({
    providers: [
      createProvider({ id: 'p1', displayName: 'Local LM', enabled: true, models: ['m-a', 'm-b'] }),
    ],
  });
});

describe('SettingsPanel — timeline insights', () => {
  it('defaults the insight provider to Auto and hides the model field', () => {
    render(<SettingsPanel />);
    const provider = screen.getByLabelText('Provider') as HTMLSelectElement;
    expect(provider.value).toBe('');
    // No provider chosen → no model field yet.
    expect(screen.queryByLabelText('Model')).toBeNull();
  });

  it('selecting a provider then a model persists both to the settings store', () => {
    render(<SettingsPanel />);
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'p1' } });
    expect(useLlmSettingsStore.getState().settings.insightProviderId).toBe('p1');

    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'm-b' } });
    expect(useLlmSettingsStore.getState().settings.insightModel).toBe('m-b');
  });

  it('resetting the provider to Auto clears the stored model', () => {
    useLlmSettingsStore.setState({
      settings: { ...DEFAULT_LLM_SETTINGS, insightProviderId: 'p1', insightModel: 'm-a' },
    });
    render(<SettingsPanel />);
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: '' } });
    const s = useLlmSettingsStore.getState().settings;
    expect(s.insightProviderId).toBe('');
    expect(s.insightModel).toBe('');
  });
});
