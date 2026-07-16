import { z } from 'zod';
import { truncateResult, type ToolDefinition } from './types';

/**
 * Crossref scholarly-article search. Keyless, CORS-enabled
 * (`access-control-allow-origin: *`, verified 2026-07).
 */

const Input = z.object({ query: z.string().min(1) });

interface CrossrefWork {
  title?: string[];
  author?: { family?: string; given?: string }[];
  issued?: { 'date-parts'?: number[][] };
  'container-title'?: string[];
  DOI?: string;
  URL?: string;
}

export const crossrefSearchTool: ToolDefinition<z.infer<typeof Input>> = {
  id: 'crossref_search',
  name: 'Article search',
  description: 'Search published scholarly articles (Crossref) by keyword; returns titles, authors, years, and DOIs.',
  inputHint: '{"query": string}',
  inputSchema: Input,
  async execute({ query }, signal) {
    const url =
      `https://api.crossref.org/works?query=${encodeURIComponent(query)}` +
      `&rows=5&select=title,author,issued,container-title,DOI,URL`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Crossref search failed (HTTP ${res.status})`);
    const data = (await res.json()) as { message?: { items?: CrossrefWork[] } };
    const items = data.message?.items ?? [];
    if (items.length === 0) return `No scholarly articles found for "${query}".`;
    const lines = items.map((w, i) => {
      const title = w.title?.[0] ?? 'Untitled';
      const first = w.author?.[0];
      const authors = first?.family
        ? `${first.family}${(w.author?.length ?? 0) > 1 ? ' et al.' : ''}`
        : 'Unknown authors';
      const year = w.issued?.['date-parts']?.[0]?.[0] ?? 'n.d.';
      const journal = w['container-title']?.[0] ? `, ${w['container-title']![0]}` : '';
      const doi = w.DOI ? ` DOI: ${w.DOI} https://doi.org/${w.DOI}` : '';
      return `${i + 1}. ${title} — ${authors} (${year})${journal}.${doi}`;
    });
    return truncateResult(lines.join('\n'));
  },
};
