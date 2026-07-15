# UI/UX Improvement & Polish Plan — Multi-Agent Playground

_Grounded in a full read of the UI codebase (toolbar, canvas, inspector, dialogs,
transcript, timeline, design tokens). **Code-grounded, not visually verified** — no
browser driver was available, so spacing/contrast judgments carry some uncertainty.
Run `npm run dev` to validate specific pixel-level calls before/while implementing._

## The core diagnosis

The app already has a real foundation: a tokenized light/dark theme, global
`:focus-visible`, a shared `Modal`, and thoughtful touches (reduced-motion on the
streaming caret, staged "blocked reason" messaging in the AI modal, abort-on-close).
The gap to "polished" is **consistency**, not a rewrite. Five independent surveys
converged on the same roots:

1. **The design system is half-built.** Tokens exist for color but not for
   spacing, radius, or type — so every component hardcodes `px` and they drift.
   Only `primary`/`danger` button variants exist, so 11 toolbar buttons render at
   equal weight with no hierarchy.
2. **Agent identity is inconsistent.** The category color shows on canvas nodes and
   the timeline, but not in the transcript, live message, or minimap — the same
   concept has two visual languages (`agentColor` vs `--accent`).
3. **Accessibility is 70% done.** Focus ring is global and good, but focus traps are
   partial, there are no `aria-live` regions for async results/streaming, tab panels
   are half-wired, and four destructive flows use unstyled native `window.confirm`.
4. **Empty/streaming/edge states are underdeveloped** — bare one-line text where an
   onboarding moment belongs, and auto-scroll that fights the reader.

The plan sequences these by **leverage and dependency**: build the foundation once,
then the shared primitives that consume it, then per-surface polish. Nearly every
finding rolls up into Phase 1 or 2.

---

## Bugs found during review (fix first — these are correctness, not aesthetics)

These were verified directly against the source, not just reported by a survey.

| # | Bug | Location | Fix |
|---|-----|----------|-----|
| B1 | Connection **Label** and **Priority** inputs stay editable during a run; every sibling control has `disabled={isRunning}`, these two don't. | `src/ui/inspector/ConnectionInspector.tsx:58,63` | Add `disabled={isRunning}`, or wrap the body in `<fieldset disabled={isRunning}>` like `AgentInspector`. |
| B2 | `.hint` references `var(--muted)`, an **undefined token** (only `--text-muted`/`--text-subtle` exist). Hint text silently falls back to inherited color. | `src/ui/ProviderManager.module.css:45` | Change to `var(--text-muted)`. |
| B3 | Auto-scroll unconditionally jams the transcript to the bottom on every token/message, yanking the view away from a user reading history. | `src/ui/BottomPanel.tsx:55-59` | Only auto-scroll when the user is already near the bottom (see P3-1). Behavioral bug, biggest single viewing annoyance. |

Also worth noting (not in scope, pre-existing): **2 `agentLibraryStore` ordering
tests fail** on `main` (`src/store/__tests__/agentLibraryStore.test.ts`) — unrelated
to UI, flagged so it's on record.

---

## Phase 1 — Design-system foundation (highest leverage, low risk)

_Do this first. It's mostly additive to `global.css` + mechanical find/replace, and
every later phase is more consistent because it exists._

**1.1 Add scale tokens** to `:root` in `src/ui/styles/global.css`:
- Spacing: `--space-1: 4px … --space-6: 24px`.
- Radius: `--radius-sm: 4px`, `--radius-md: 6px`, `--radius-lg: 10px`, `--radius-pill: 999px`.
- Type: `--fs-xs: 11px … --fs-lg: 16px`, plus `--fw-medium/--fw-semibold`.
- Success/overlay tokens the code already wants: `--ok-bg`, `--ok-border`, and
  `--overlay: rgba(0,0,0,0.45)` (currently hardcoded in `Timeline.module.css:5`).

**1.2 Add button variants** to the global `button` rules: `.secondary` (subtle
border, low emphasis), `.ghost` (borderless, for toolbars), `.icon` (square, sized
hit-area for glyph/icon-only buttons). This is the prerequisite for toolbar hierarchy
(P3-4) and softening the doubled-up row buttons in the library/playgrounds panels.

**1.3 Single source of truth for the agent palette.** Today `AGENT_COLORS`
(`src/graph/colors.ts:9-17`) and `.color_*` (`AgentNode.module.css:64-69`) are
hand-synced hex, with a comment admitting they "MUST stay in sync." Emit the palette
as CSS custom properties (`--agent-slate`, …) so both the node stylesheet and any JS
consumer read one source. Removes a whole class of drift bugs.

**1.4 Tokenize hardcoded status/success hex.** Replace literal pastels with tokens +
dark-mode variants:
- `AgentNode.module.css:87-92` (`.state_*`, `.badge_completed/failed`) → `--ok`/`--danger`/`--warn-*`.
- `ProviderManager.module.css:48-50` (`.testOk`) → new `--ok-bg`/`--ok-border`.
- These pastels currently sit unchanged on the dark canvas and look wrong in dark mode.

**1.5 Mechanical sweep** of the worst inline-style and magic-number offenders once
the tokens exist (`style={{ fontSize: 12 }}` scattered across inspector, provider,
library panels). Do opportunistically, not as a blocking gate.

**Acceptance:** `git grep` shows no `var(--muted)`, no raw pastel hex in status
styles, palette defined once; toolbar buttons can be visually tiered.

---

## Phase 2 — Shared primitives, identity & a11y infrastructure

_Build the reusable pieces so per-surface polish in Phase 3 is assembly, not
reinvention. Each item here kills duplication found in ≥2 places._

**2.1 In-app confirm dialog** (`useConfirm()` or `<ConfirmDialog>`). Replaces four
`window.confirm` sites (`ProviderManager.tsx:48`, `PlaygroundsPanel.tsx:66`,
`AgentLibraryPanel.tsx:70`, `SkillLibraryManager.tsx:48`) plus the inspector's agent
delete — all currently unstyled/off-brand. Also add confirmation where it's missing
entirely (connection delete; agent delete when it silently skips confirm).

**2.2 Robust focus-trap + scroll-lock util**, adopted by `Modal` and `TimelinePage`.
Current traps are "trapped-ish" (`Modal.tsx:12,35-48`) and TimelinePage has none —
Tab escapes the dialog. Also: `Modal` should use `aria-labelledby` → the visible
`<h2>` id instead of a decoupled `aria-label`; add body scroll-lock; only close on
backdrop click when `mousedown` **and** `mouseup` both land on the backdrop.

**2.3 `aria-live` regions** for every async result that currently updates silently:
provider test/fetch-models (`ProviderManager.tsx:304,329`), AI generation stream +
error (`CreateAgentWithAiModal.tsx:199-222`), transcript streaming, and run-status on
the canvas. Error toasts should use `role="alert"` (assertive), not `role="status"`
(`Toast.tsx:17`).

**2.4 Shared agent-identity primitive** — a small colored dot/avatar + left accent
border driven by `agentColor(colorCategory)`, applied **everywhere the same agent
appears**: canvas node header, transcript bubble, live message, timeline node,
**and** the minimap (`nodeColor={n => agentColor(...)}`). Unifies the two identity
languages and makes long transcripts scannable.

**2.5 Shared Markdown/card renderer.** The transcript and timeline duplicate an
under-styled Markdown block (`Transcript.module.css:56-65` ≈ `Timeline.module.css:114-141`):
only `p/pre/code` are themed, so headings render huge, lists/blockquotes/tables/links
get raw defaults. Build one `<MessageBody>` that styles the full Markdown set at body
scale, adds code-block language labels + per-block copy, and use it in both places.

**Acceptance:** no `window.confirm` in the tree; Tab cannot escape any open dialog;
screen reader announces test/generation/streaming results; an agent's color is
identical across all five surfaces.

---

## Phase 3 — Per-surface polish

_With the foundation and primitives in place, these become focused, mostly-CSS work.
Ordered by user impact._

**3.1 Transcript reading experience (highest impact).**
- Fix auto-scroll (B3): near-bottom guard + smooth scroll + a floating
  "↓ new messages" pill when the user has scrolled up.
- "Thinking…" placeholder before the first streamed token (the gap where nothing
  renders while a request is in flight); live elapsed/token indicator.
- Apply the shared identity (2.4) and Markdown renderer (2.5); add a retry action on
  `failed` messages; normalize `durationMs` vs seconds unit inconsistency.

**3.2 Canvas refinement.**
- Node **hover** state (lift to `--shadow-md`, `cursor: grab`) — nodes give zero
  hover feedback today and don't feel interactive.
- Separate **identity from status channels**: keep category color as a persistent
  left bar/header dot; use ring/shadow/badge (not `border-color`) for selection and
  run state, so identity survives a run (today a completed/failed run overwrites the
  agent's color).
- Bigger handles that grow on node-hover; give `handoff` its own dash pattern (only
  `review` is distinct today); fade arrow markers on muted/disabled edges
  (`graphAdapter.ts:96`); hover-highlight edges.
- **Real empty states**: distinguish "no playground" from "playground with zero
  agents" — the latter deserves a centered card + "Add your first agent" CTA.
- Consolidate the duplicate fit/reset affordances (native `Controls` bottom-left vs
  custom buttons top-right).

**3.3 Inspector ergonomics.**
- Show the agent's **name + color in the panel header** (currently just "Agent").
- **Inline validation**: number fields silently snap back on invalid input
  (`parseBoundedInt` returns null, no message) — surface a field-level error; wire the
  issues banner to scroll to the offending field. Bound Top-p like the others.
- Real `<label>`/`aria-label` on skill name/description inputs (placeholder-only
  today); wrap color swatches in a `role="radiogroup"` with arrow-key nav.
- **Persist section open/closed state** (resets on every reselect today); group
  advanced sections under an "Advanced" disclosure to cut density.
- Unify connection-type terminology across the two inspectors ("talk/review/handoff"
  vs "Conversation flow/…"); expand system-instruction textarea; render the AI
  "enhance" result as a diff.

**3.4 Toolbar & navigation hierarchy.**
- Use the new button variants: `Run…` primary, destructive as `danger`, everything
  else `secondary`/`ghost`; group with segmented containers instead of thin `.sep`.
- **Responsive**: the flat row of ~11 buttons has no wrap/overflow — collapse
  secondary actions into an overflow "⋯" menu on narrow widths.
- Save-status gets an icon + a retry affordance on "Save failed"; `Clear chat` (and
  other destructive toolbar actions) route through the confirm primitive (2.1).

**3.5 Dialogs & panels consistency.**
- Give master-detail lists their own scroll (ProviderManager / SkillLibrary lists are
  unbounded and desync from the capped editor pane); pin Export/Import.
- RunDialog: put a compact error summary next to the disabled **Start** button (issues
  are buried at the bottom today) + `title` on the disabled button + `aria-required`
  on Subject; add sane max bounds on turn limits.
- Convert scheme/credential-storage radio groups to `<fieldset>/<legend>`.
- Soften the doubled full-weight row buttons (Add + Dispose / Load + Delete) using the
  `secondary` variant; enrich list rows with model/skill-count/agent-count metadata.
- Let the AI-generated draft be lightly editable (or add a "Regenerate") instead of
  discard-and-restart-only.

**3.6 Chrome & micro-interactions.**
- Toast: queue/stack instead of single-slot overwrite; pause auto-dismiss on
  hover/focus; per-kind icon (not color-only); offset above the BottomPanel; slide/fade
  entrance (reduced-motion aware).
- Modal/dialog entrance animations (reduced-motion aware).
- BottomPanel: complete `role="tabpanel"` + `aria-controls` + arrow-key tab nav; make
  the 260px panel drag-resizable; timestamps + stable keys on error items.
- Global `@media (prefers-reduced-motion: reduce)` guard; replace platform-fragile
  glyphs (`☀`/`☾`, `▲`/`▼`, `⧉`) with a consistent inline-SVG icon set + `aria-hidden`.

---

## Cross-cutting user journey (the "perfect" onboarding thread)

The fragmented empty-state findings are really **one story**. Design the first-run
path as a sequence, not per-panel afterthoughts:

1. **First run / empty canvas** → a welcoming zero-agent state with a clear primary
   action ("Add an agent" / "Load example") and a one-line hint about wiring.
2. **Configure** → inspector header shows identity; validation guides rather than
   silently rejects; provider setup surfaces success/failure audibly and visibly.
3. **Wire** → handles are discoverable and connection types visually distinct.
4. **Run** → run readiness is explained at the button; live streaming has identity,
   a thinking state, and a scroll that respects the reader.
5. **Review** → transcript and timeline share one identity + Markdown language; failed
   turns are recoverable.

Each step already has a home in Phases 1–3; this section is the lens to make sure they
compose into a coherent flow rather than N isolated fixes.

---

## Suggested sequencing & effort

| Phase | Scope | Rough effort | Risk |
|-------|-------|-------------|------|
| Bugs B1–B3 | 3 targeted fixes | ~½ day | very low |
| Phase 1 | tokens + button variants + palette SoT + tokenize hex | ~1–2 days | low (additive) |
| Phase 2 | confirm + focus-trap + aria-live + identity + Markdown primitives | ~3–4 days | medium |
| Phase 3 | per-surface polish (3.1 → 3.6, by impact) | ~5–8 days, incremental | low–medium |
| Journey | validation pass over the composed flow | ~1 day | low |

Ship in that order; each phase is independently mergeable and leaves the app in a
better, consistent state. Recommend validating Phase 1 visually in `npm run dev`
(light **and** dark) before starting Phase 2, since everything downstream inherits it.
