# Visual Multi-Agent Playground (MVP)

A **browser-only** environment for building AI agents, arranging them as a directed
graph, wiring custom OpenAI-compatible LLM providers, and running controlled
sequential multi-agent conversations. There is **no server** — the browser calls
provider APIs directly.

Built to the spec in [`multi-agent-playground-mpv.md`](./multi-agent-playground-mpv.md).

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # run the unit + smoke test suite
npm run build    # type-check + production build
```

## Running a conversation (acceptance scenario, spec §24)

The app talks to any **OpenAI-compatible** chat-completions endpoint that allows
**browser-origin (CORS)** requests. The guaranteed-to-work target is a local model
server on `localhost` (HTTP is permitted for localhost only).

### With Ollama

```bash
ollama serve                 # exposes http://localhost:11434
ollama pull llama3.1
# Ollama allows browser origins by default; if not, set:
#   OLLAMA_ORIGINS=* ollama serve
```

Then in the app:

1. **Open → Load example** — seeds Strategist → Critic → Moderator wired to a local
   Ollama provider.
2. Open **Providers**, confirm the base URL (`http://localhost:11434`) and model
   (`llama3.1`), and click **Test connection**.
3. Press **Run…**, keep Strategist as the starting agent, and **Start**.
4. Watch the active node/edge highlight; each agent responds in sequence in the
   transcript.
5. **Export** — the downloaded JSON excludes API keys. Reload the page; the
   playground is restored from IndexedDB.

## Architecture

Two layers joined by node id keep the graph library swappable (spec §5):

| Layer | Location | Responsibility |
| --- | --- | --- |
| Domain | `src/domain/`, `src/store/domainStore.ts` | Agents, connections, providers, transcript (zod-validated, versioned) |
| Graph | `src/graph/` | React Flow projection via `graphAdapter.ts` — never sees an `Agent` |
| Providers | `src/providers/` | OpenAI-compatible adapter, normalized response, CORS-aware error taxonomy |
| Orchestrator | `src/orchestrator/` | Directed sequential traversal, cycle limits, cancellation |
| Persistence | `src/persistence/` | IndexedDB, autosave, import/export, credential store |
| UI | `src/ui/` | Toolbar, palette, inspector, provider manager, run dialog, transcript |

State is split into three Zustand stores (spec §16): persistent domain, transient
UI, and **memory-only** runtime (an active run is never persisted across reload).

## Security notes (spec §21)

- API keys live in `sessionStorage` (default) or `localStorage` (opt-in, warned),
  **never** in the IndexedDB playground blob, exports, or logs.
- Model output is rendered as **sanitized Markdown** (`rehype-sanitize`) — no raw HTML.
- Remote endpoints must be HTTPS; HTTP is allowed only for localhost.
- Custom provider headers cannot override browser-controlled headers.
- Browser storage is **not** a secure secret vault — do not use production keys.

## Known browser-only constraint

Not every "OpenAI-compatible" endpoint is reachable from a browser: providers that
don't send permissive CORS headers, or that forbid client-side credentials, will
fail with a **CORS** error (distinguished from auth/network errors in diagnostics).
This is a provider compatibility limitation, not an app defect (spec §28). The
long-term fix is a server-side proxy, which is out of MVP scope.
