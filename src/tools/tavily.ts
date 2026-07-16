import { z } from 'zod';
import { loadCredential, saveCredential, clearCredential } from '../persistence/credentialStore';
import { truncateResult, type ToolDefinition } from './types';

/**
 * Optional general web search via Tavily. Requires a user-supplied API key —
 * stored through the existing credentialStore (never in IndexedDB or exports)
 * under a reserved id that can never collide with provider ids.
 */

export const TAVILY_CREDENTIAL_ID = 'tool:tavily';

export function tavilyKey(): string | undefined {
  return loadCredential(TAVILY_CREDENTIAL_ID);
}

export function setTavilyKey(key: string): void {
  if (key.trim()) saveCredential(TAVILY_CREDENTIAL_ID, key.trim(), 'session');
  else clearCredential(TAVILY_CREDENTIAL_ID);
}

const Input = z.object({ query: z.string().min(1) });

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

export const webSearchTool: ToolDefinition<z.infer<typeof Input>> = {
  id: 'web_search',
  name: 'Web search',
  description: 'Search the web (Tavily); returns page titles, snippets, and URLs. Requires an API key.',
  inputHint: '{"query": string}',
  inputSchema: Input,
  async execute({ query }, signal) {
    const key = tavilyKey();
    if (!key) return 'ERROR: web_search is not configured (no API key). Use another tool.';
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, max_results: 5 }),
      signal,
    });
    if (!res.ok) throw new Error(`Web search failed (HTTP ${res.status})`);
    const data = (await res.json()) as { results?: TavilyResult[]; answer?: string };
    const results = data.results ?? [];
    if (results.length === 0) return `No web results for "${query}".`;
    const lines = results.map((r, i) => {
      const snippet = (r.content ?? '').trim().slice(0, 200);
      return `${i + 1}. ${r.title ?? 'Untitled'} — ${snippet} (${r.url ?? ''})`;
    });
    return truncateResult(lines.join('\n'));
  },
};
