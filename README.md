# 🧩 Visual Multi-Agent Playground

**Design AI agents as a graph. Wire them to any OpenAI-compatible model. Watch them talk to each other — all in your browser, no server required.**

[![Deploy](https://github.com/sadeghhp/multi-agent-playground/actions/workflows/deploy.yml/badge.svg)](https://github.com/sadeghhp/multi-agent-playground/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)

**[▶ Try the live demo](https://sadeghhp.github.io/multi-agent-playground/)** — no install, no account, no API key required to explore the UI.

---

## ⚡ At a glance

| | |
| --- | --- |
| 🖥️ **100% client-side** | Nothing runs on a server — your API keys and conversations never leave the browser except to call the model provider you configured. |
| 🕸️ **Visual graph editor** | Drag out agents, connect them with edges, and define the order they speak in. |
| 🔌 **Bring your own model** | Point at OpenAI, a local Ollama server, or any OpenAI-compatible endpoint. |
| ▶️ **Watch it run** | Step through a live multi-agent conversation with the active node/edge highlighted in real time. |
| 💾 **Local-first** | Playgrounds and providers persist to IndexedDB automatically — reload the page and pick up where you left off. |
| 📤 **Portable** | Export a playground to a self-contained JSON file (API keys stripped) and share or reload it anywhere. |

## Table of contents

- [Features](#-features)
- [Tech stack](#-tech-stack)
- [Quick start](#-quick-start)
- [Try it with Ollama](#-try-it-with-ollama-5-minutes)
- [Architecture](#-architecture)
- [Security notes](#-security-notes-spec-21)
- [Deploy / GitHub Pages](#-deploy--github-pages)
- [Known browser-only constraint](#-known-browser-only-constraint)
- [License](#-license)

## ✨ Features

- **Visual agent graph** — arrange agents as nodes and wire them into a directed
  conversation flow with [React Flow](https://reactflow.dev/).
- **Bring your own provider** — connect any OpenAI-compatible chat-completions
  endpoint (local or remote), with per-provider credentials and connection testing.
- **Controlled sequential runs** — step through a multi-agent conversation with
  live node/edge highlighting and cycle limits.
- **Local-first persistence** — playgrounds and providers are saved to IndexedDB;
  nothing leaves the browser except the provider API calls themselves.
- **Portable import/export** — export a playground as self-contained JSON (with
  providers re-embedded, API keys stripped) and reload it anywhere.
- **Sanitized rendering** — agent output is rendered as sanitized Markdown, never
  raw HTML.

## 🧱 Tech stack

React · TypeScript · Vite · [React Flow](https://reactflow.dev/) (`@xyflow/react`) · Zustand · Zod · IndexedDB (via `idb`) · Vitest

Built to the spec in [`multi-agent-playground-mpv.md`](./multi-agent-playground-mpv.md).

## 🚀 Quick start

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # run the unit + smoke test suite
npm run build    # type-check + production build
```

## 🦙 Try it with Ollama (5 minutes)

The fastest path to a running multi-agent conversation, entirely local:

```bash
ollama serve                 # exposes http://localhost:11434
ollama pull llama3.1
# Ollama allows browser origins by default; if not, set:
#   OLLAMA_ORIGINS=* ollama serve
```

Then in the app:

1. **Open** (or **Browse sample playgrounds** on an empty canvas) and pick a
   sample — for example **Open-source decision** (Strategist → Critic → Moderator)
   or **Ship a mobile feature**. All samples wire to a local Ollama provider.
2. Open **Providers**, confirm the base URL (`http://localhost:11434`) and model
   (`llama3.1`), and click **Test connection**.
3. Press **Run…**, keep the sample's starting agent, and **Start**.
4. Watch the active node/edge highlight; each agent responds in sequence in the
   transcript.
5. **Export** — the downloaded JSON excludes API keys. Reload the page; the
   playground is restored from IndexedDB.

**Sample playgrounds** (domain catalog under Open):

| Sample | Domain | What you learn |
| --- | --- | --- |
| Ship a mobile feature | Product | Role handoffs for a product decision |
| Open-source decision | Product | Basic three-agent critique loop |
| Evidence pipeline | Engineering | Propose vs. verify roles |
| Climate claim check | Science & Nature | Evidence vs. uncertainty |
| Treatment options brief | Health | Multi-stakeholder brief *(not medical advice)* |
| Contract risk review | Law | Structured risk analysis *(not legal advice)* |

*(Open-source decision is the acceptance scenario from spec §24.)*

## 🏗️ Architecture

Two layers joined by node id keep the graph library swappable (spec §5):

| Layer | Location | Responsibility |
| --- | --- | --- |
| Domain | `src/domain/`, `src/store/domainStore.ts` | Agents, connections, transcript per playground (zod-validated, versioned) |
| Provider registry | `src/store/providerStore.ts` | Application-global providers (schema v2) reused by every playground; agents reference them by id |
| Graph | `src/graph/` | React Flow projection via `graphAdapter.ts` — never sees an `Agent` |
| Providers | `src/providers/` | OpenAI-compatible adapter, normalized response, CORS-aware error taxonomy |
| Orchestrator | `src/orchestrator/` | Directed sequential traversal, cycle limits, cancellation |
| Persistence | `src/persistence/` | IndexedDB (`playgrounds` + `providers` stores), autosave, import/export, credential store |
| UI | `src/ui/` | Toolbar, palette, inspector, provider manager, run dialog, transcript |

Providers are **application-scoped**, not embedded in a playground (schema v2): a
provider created once in the Provider manager is available to every playground,
including ones created afterwards. Exports re-embed the providers an agent
references so a shared file stays self-contained and portable.

State is split into Zustand stores (spec §16): persistent domain (the active
playground), the global provider registry, transient UI, and **memory-only**
runtime (an active run is never persisted across reload).

## 🔒 Security notes (spec §21)

- API keys live in `sessionStorage` (default) or `localStorage` (opt-in, warned),
  **never** in the IndexedDB playground blob, exports, or logs.
- Model output is rendered as **sanitized Markdown** (`rehype-sanitize`) — no raw HTML.
- Remote endpoints must be HTTPS; HTTP is allowed only for localhost.
- Custom provider headers cannot override browser-controlled headers.
- Browser storage is **not** a secure secret vault — do not use production keys.

## 📦 Deploy / GitHub Pages

Pushes and PRs to `main` run lint, typecheck, tests, and a production build via
[`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml). Successful pushes to
`main` also publish `dist/` to GitHub Pages.

**Live URL:** https://sadeghhp.github.io/multi-agent-playground/

One-time repo setup: **Settings → Pages → Source = GitHub Actions**.

To verify the Pages base path locally:

```bash
GITHUB_PAGES=true npm run build
# dist/index.html asset hrefs should start with /multi-agent-playground/
```

## ⚠️ Known browser-only constraint

This app is a **static browser SPA** (including on GitHub Pages). There is no
server-side proxy in production. A provider works only when the **browser itself**
can call it from the current page origin (spec §28).

| App origin | Provider | Result |
| --- | --- | --- |
| `http://localhost:5173` (`npm run dev`) | `http://localhost:11434` (Ollama / LM Studio) | Works |
| GitHub Pages (`https://…github.io/…`) | Public HTTPS API with CORS (OpenAI, OpenRouter, Groq, …) | Works |
| GitHub Pages | `localhost` / `127.0.0.1` / LAN IP | **Blocked** (Private Network Access) |
| Any | Remote `http://…` (non-localhost) | **Blocked** (HTTPS required — spec §21) |
| Any | HTTPS API without CORS headers | **Fails** (classic CORS — use a different provider or local `npm run dev`) |

**Static deployment cannot call localhost on the user’s machine.** The live GitHub
Pages site cannot reach Ollama running on your laptop. Use:

```bash
ollama serve
npm run dev   # http://localhost:5173 — not the github.io URL
```

Advanced workaround: expose a local model via a **public HTTPS tunnel** you control
that sends CORS headers, and set that URL as a custom provider base URL (not
`localhost`). You own tunnel security and CORS.

The app detects impossible combinations (e.g. github.io + localhost) and **blocks
Run** with actionable guidance before the request is sent.

### Dev proxy (and when to turn it off)

To make CORS-less internal gateways usable during local development, `npm run dev`
routes remote provider calls through a **dev-server proxy** (`vite/providerDevProxyPlugin.ts`)
instead of calling them from the browser. This means the Vite/Node process — not the
browser — makes the request in dev. If a provider is reachable **only** from the browser
(e.g. behind a VPN or browser-authenticated corporate proxy the dev server can't use),
proxying it hangs and surfaces as `Failed (timeout): The request timed out.`

For that case, each provider has a **"Send requests directly from the browser (bypass
dev proxy)"** toggle in the Provider editor (shown in Advanced, **dev only**). Enable it
to send that provider's requests straight from the browser even under `vite dev`. The
provider must then allow browser-origin (CORS) requests. Production builds are always
browser-direct regardless of this setting — the proxy exists only under `vite dev`.

## 📄 License

[MIT](./LICENSE)
