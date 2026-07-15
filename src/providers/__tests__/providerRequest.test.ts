import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProvider } from '../../domain/factories';
import { providerRequest } from '../providerRequest';

describe('providerRequest reachability guard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws private-network before fetch when the app origin is public', async () => {
    vi.stubGlobal('location', { origin: 'https://sadeghhp.github.io' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider({
      baseUrl: 'http://localhost:11434',
      authMethod: 'none',
      models: ['m'],
    });

    await expect(providerRequest(provider, '/v1/models')).rejects.toMatchObject({
      kind: 'private-network',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws insecure-remote before fetch for remote http', async () => {
    vi.stubGlobal('location', { origin: 'http://localhost:5173' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const provider = createProvider({
      baseUrl: 'http://api.example.com',
      authMethod: 'none',
      models: ['m'],
    });

    await expect(providerRequest(provider, '/v1/models')).rejects.toMatchObject({
      kind: 'insecure-remote',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
