import { z } from 'zod';
import { stripHtml, truncateResult, type ToolDefinition } from './types';

/**
 * Wikipedia REST tools. Both endpoints are keyless and send
 * `access-control-allow-origin: *`, so they work from a static browser page
 * (verified 2026-07). URLs are built only from the model's query/title via
 * encodeURIComponent — never from a model-supplied URL.
 */

const SearchInput = z.object({ query: z.string().min(1) });

interface SearchPage {
  title?: string;
  key?: string;
  excerpt?: string;
}

export const wikipediaSearchTool: ToolDefinition<z.infer<typeof SearchInput>> = {
  id: 'wikipedia_search',
  name: 'Wikipedia search',
  description: 'Search Wikipedia articles by keyword; returns titles, excerpts, and URLs.',
  inputHint: '{"query": string}',
  inputSchema: SearchInput,
  async execute({ query }, signal) {
    const url = `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(query)}&limit=5`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Wikipedia search failed (HTTP ${res.status})`);
    const data = (await res.json()) as { pages?: SearchPage[] };
    const pages = data.pages ?? [];
    if (pages.length === 0) return `No Wikipedia results for "${query}".`;
    const lines = pages.map((p, i) => {
      const title = p.title ?? p.key ?? 'Untitled';
      const excerpt = stripHtml(p.excerpt ?? '').trim();
      const link = p.key ? `https://en.wikipedia.org/wiki/${p.key}` : '';
      return `${i + 1}. ${title} — ${excerpt} (${link})`;
    });
    return truncateResult(lines.join('\n'));
  },
};

const PageInput = z.object({ title: z.string().min(1) });

interface PageSummary {
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
  type?: string;
}

export const wikipediaPageTool: ToolDefinition<z.infer<typeof PageInput>> = {
  id: 'wikipedia_page',
  name: 'Wikipedia page',
  description: 'Fetch the summary of one Wikipedia article by its exact title.',
  inputHint: '{"title": string}',
  inputSchema: PageInput,
  async execute({ title }, signal) {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;
    const res = await fetch(url, { signal });
    if (res.status === 404) return `No Wikipedia article titled "${title}". Try wikipedia_search first.`;
    if (!res.ok) throw new Error(`Wikipedia page fetch failed (HTTP ${res.status})`);
    const data = (await res.json()) as PageSummary;
    const extract = (data.extract ?? '').trim();
    if (!extract) return `Wikipedia article "${title}" has no summary text.`;
    const link = data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
    return truncateResult(`${data.title ?? title}: ${extract}\nSource: ${link}`);
  },
};
