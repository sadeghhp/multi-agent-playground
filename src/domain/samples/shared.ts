import type { Provider } from '../schema';
import { createProvider } from '../factories';

/** Local Ollama provider shared by every built-in sample playground. No API key. */
export function createLocalOllamaProvider(): Provider {
  return createProvider({
    displayName: 'Local (Ollama)',
    baseUrl: 'http://localhost:11434',
    path: '/v1/chat/completions',
    authMethod: 'none',
    defaultModel: 'llama3.1',
    models: ['llama3.1'],
  });
}

/** Default model settings for sample agents; callers supply providerId + temperature. */
export const LOCAL_LLM = {
  model: 'llama3.1' as const,
  maxOutputTokens: 512,
};
