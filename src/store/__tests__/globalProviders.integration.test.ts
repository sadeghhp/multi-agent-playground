import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no IndexedDB; stub persistence so store mutations are no-ops.
vi.mock('../../persistence/db', () => import('../../test/persistenceDbMock'));

import { createAgent, createProvider } from '../../domain/factories';
import { hasBlockingErrors, validateForRun } from '../../orchestrator/validate';
import { useDomainStore } from '../domainStore';
import { useProviderStore } from '../providerStore';

beforeEach(() => {
  useProviderStore.setState({ providers: [], hydrated: false });
  useDomainStore.setState({ playground: null, index: [], saveStatus: 'saved' });
});

/**
 * The feature this refactor exists for: a provider created once at application
 * scope is usable by ANY playground, including ones created afterwards.
 */
describe('providers are application-global', () => {
  it('a new playground can use a provider created earlier', () => {
    // 1. Create a provider once (as the Provider Manager would).
    const provider = createProvider({
      displayName: 'Local (Ollama)',
      baseUrl: 'http://localhost:11434',
      authMethod: 'none',
      models: ['llama3.1'],
    });
    useProviderStore.getState().addProvider(provider);

    // 2. A brand-new playground, created after the provider, can reference it and
    //    validates cleanly — the provider was NOT embedded in the playground.
    useDomainStore.getState().newPlayground('Fresh playground');
    const base = createAgent();
    useDomainStore.getState().addAgent(
      createAgent({
        name: 'A',
        role: 'r',
        systemInstruction: 'do',
        llm: { ...base.llm, providerId: provider.id, model: 'llama3.1' },
      }),
    );
    const pg = useDomainStore.getState().playground!;
    useDomainStore.getState().updateConversation({ subject: 'S', startingAgentId: pg.agents[0].id });

    const providers = useProviderStore.getState().providers;
    const issues = validateForRun(useDomainStore.getState().playground!, providers);
    expect(hasBlockingErrors(issues)).toBe(false);
  });

  it('deleting a global provider degrades other playgrounds to a validation error, not a crash', () => {
    const provider = createProvider({ displayName: 'P', baseUrl: 'http://localhost:11434', authMethod: 'none', models: ['m'] });
    useProviderStore.getState().addProvider(provider);

    useDomainStore.getState().newPlayground('P1');
    const base = createAgent();
    useDomainStore.getState().addAgent(
      createAgent({ name: 'A', role: 'r', systemInstruction: 'do', llm: { ...base.llm, providerId: provider.id, model: 'm' } }),
    );
    useDomainStore.getState().updateConversation({ subject: 'S', startingAgentId: useDomainStore.getState().playground!.agents[0].id });

    // Removing the provider clears the reference in the active playground…
    useProviderStore.getState().removeProvider(provider.id);
    expect(useDomainStore.getState().playground!.agents[0].llm.providerId).toBeNull();

    // …and a run is blocked (no provider assigned) rather than throwing.
    const issues = validateForRun(useDomainStore.getState().playground!, useProviderStore.getState().providers);
    expect(issues.some((i) => i.level === 'error' && /provider/i.test(i.message))).toBe(true);
  });
});
