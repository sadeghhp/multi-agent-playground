import { afterEach, describe, expect, it, vi } from 'vitest';
import { crossrefSearchTool } from '../crossref';
import { executeToolCall } from '../registry';
import { MAX_TOOL_RESULT_CHARS } from '../types';
import { wikipediaPageTool, wikipediaSearchTool } from '../wikipedia';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const signal = () => new AbortController().signal;

describe('wikipedia_search', () => {
  it('formats numbered, source-attributed lines and strips HTML', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({
        pages: [
          { title: 'Graphene', key: 'Graphene', excerpt: '<span class="searchmatch">Graphene</span> is a carbon allotrope' },
        ],
      }),
    ));
    const out = await wikipediaSearchTool.execute({ query: 'graphene' }, signal());
    expect(out).toContain('1. Graphene — Graphene is a carbon allotrope');
    expect(out).toContain('https://en.wikipedia.org/wiki/Graphene');
    expect(out).not.toContain('<span');
  });

  it('reports empty results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ pages: [] })));
    const out = await wikipediaSearchTool.execute({ query: 'xyzzy' }, signal());
    expect(out).toContain('No Wikipedia results');
  });
});

describe('wikipedia_page', () => {
  it('returns extract with a source URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({
        title: 'Graphene',
        extract: 'Graphene is an allotrope of carbon.',
        content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Graphene' } },
      }),
    ));
    const out = await wikipediaPageTool.execute({ title: 'Graphene' }, signal());
    expect(out).toContain('Graphene is an allotrope of carbon.');
    expect(out).toContain('Source: https://en.wikipedia.org/wiki/Graphene');
  });

  it('suggests search on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 404)));
    const out = await wikipediaPageTool.execute({ title: 'Nope' }, signal());
    expect(out).toContain('Try wikipedia_search first');
  });
});

describe('crossref_search', () => {
  it('formats title, author, year, and DOI', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({
        message: {
          items: [
            {
              title: ['Electric Field Effect in Atomically Thin Carbon Films'],
              author: [{ family: 'Novoselov' }, { family: 'Geim' }],
              issued: { 'date-parts': [[2004]] },
              'container-title': ['Science'],
              DOI: '10.1126/science.1102896',
            },
          ],
        },
      }),
    ));
    const out = await crossrefSearchTool.execute({ query: 'graphene' }, signal());
    expect(out).toContain('Electric Field Effect');
    expect(out).toContain('Novoselov et al. (2004), Science');
    expect(out).toContain('https://doi.org/10.1126/science.1102896');
  });
});

describe('executeToolCall', () => {
  it('turns HTTP errors into ERROR text instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)));
    const res = await executeToolCall(wikipediaSearchTool, { query: 'q' }, signal());
    expect(res.ok).toBe(false);
    expect(res.text).toMatch(/^ERROR: /);
    expect(res.text).toContain('HTTP 500');
  });

  it('turns network failures into ERROR text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const res = await executeToolCall(wikipediaSearchTool, { query: 'q' }, signal());
    expect(res.ok).toBe(false);
    expect(res.text).toContain('Failed to fetch');
  });

  it('rethrows on run abort', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }),
    ));
    const pending = executeToolCall(wikipediaSearchTool, { query: 'q' }, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
  });

  it('truncates oversized results', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({
        pages: [{ title: 'T', key: 'T', excerpt: 'x'.repeat(5000) }],
      }),
    ));
    const res = await executeToolCall(wikipediaSearchTool, { query: 'q' }, signal());
    expect(res.text.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS + 20);
    expect(res.text).toContain('…(truncated)');
  });
});
