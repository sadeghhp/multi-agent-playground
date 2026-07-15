# UI/UX Polish Review — Multi-Agent Playground

_Independent, **code-grounded** review of the current `main` (post-`f1c622e`). No
browser driver was available (no chromium/playwright in the environment), so every
finding is verified against source, not against pixels — spacing/contrast calls carry
some uncertainty and should be eyeballed in `npm run dev` (light **and** dark) before
acting. Fresh pass, five surfaces reviewed in parallel; only **remaining** gaps are
listed — the design-system foundation and shared primitives from
`UI_UX_IMPROVEMENT_PLAN.md` (tokens, button variants, `ConfirmDialog`, agent-identity
primitive, shared `.markdown`, focus-trap, near-bottom scroll guard + jump pill, WAI
tabs, reduced-motion guard) are **confirmed implemented** and not re-reported._

> **Test baseline note:** the suite is **17 tests red on clean `main`**
> (`orchestrator.test.ts` — the `../../persistence/db` mock is missing a
> `saveUsageEntry` export). This is a broken test mock, unrelated to UI, but it means
> "tests pass" is not currently a usable safety net. Worth fixing before/alongside any
> UI work so regressions are catchable.

Legend: **effort** S ≈ <30 min · M ≈ ½–1 day · L ≈ multi-day.

---

## Tier 1 — Correctness / behavioral (fix first; these are bugs, not taste)

| # | Severity | Location | Problem | Fix | Effort |
|---|----------|----------|---------|-----|--------|
| C1 | **High** | `Toolbar.tsx:135` | **"Clear chat" wipes the whole transcript with no confirmation** and is styled `className="secondary"`, visually identical to benign nav buttons (`Providers`/`Runs`). The app already has `requestConfirm` (UsagePanel uses it for far less destructive clears). | Route through `requestConfirm({ danger: true, … })`; restyle to `danger`. | S |
| C2 | **High** | `ConnectionInspector.tsx:93-99` | The **Instruction-override textarea stays editable during a run** — every sibling control (checkbox, type, label, priority, delete) has `disabled={isRunning}`, this one doesn't. Same class as the plan's B1 (which was fixed for Label/Priority; this instance was missed). | Add `disabled={isRunning}`, or wrap the body in `<fieldset disabled={isRunning}>` like `AgentInspector`. | S |
| C3 | **Med** | `AgentNode.module.css:97-100` | **The "generating" run-state overwrites the agent's identity left-bar.** `.state_generating { border-color: var(--accent) }` recolors all four sides incl. `border-left`, clobbering the `border-left: 4px solid var(--agent-color)` on line 5 — contradicting the invariant the adjacent comment claims ("the left bar stays"). `completed`/`failed` correctly use the `--node-border` token and preserve it; only `generating` breaks it. | Use `--node-border: var(--accent)` like the other states instead of the `border-color` shorthand. | S |
| C4 | **Med** | `Modal.tsx:74` | **Mount-focus defeats every child's `autoFocus`.** `(focusable()[0] ?? ref.current).focus()` runs after React applies `autoFocus`, and the header ✕ is always `focusable()[0]` — so `ConfirmDialog`'s confirm button (`autoFocus`) and the AI modal's first field never get focus; destructive/primary intent is silently lost to the close button. | Prefer `ref.current.querySelector('[autofocus]')` before falling back to `focusable()[0]`. | S |
| C5 | **Med** | `UsagePanel.module.css:66` | **Broken token → hardcoded `#666`.** `color: var(--muted, #666)` references an undefined token (`--text-muted`/`--text-subtle` exist), so usage-table headers always fall back to literal `#666` and never adapt to dark mode. (A second live instance of the plan's B2, missed because of the `, #666` fallback.) | Change to `var(--text-muted)`. | S |
| C6 | **Med** | `AgentInspector.tsx:642` | **Top-p is unbounded** — `min/max` are hints only and the handler stores whatever is typed, so `1.5` / `-5` are accepted, unlike RunDialog's temperature which clamps `0..2`. | Only patch when `n >= 0 && n <= 1`. | S |

---

## Tier 2 — High-impact UX gaps

| # | Severity | Location | Problem | Fix | Effort |
|---|----------|----------|---------|-----|--------|
| U1 | **Med** | `Message.tsx:113`, `BottomPanel.tsx:239` | **No retry on failed / retry-eligible messages.** A `failed` turn renders as text only; `retryEligible` is computed and shown as a chip but there's no button, though `continueRun` already exists. | Render a "Retry" action on failed/retry-eligible items. | M |
| U2 | **Med** | `BottomPanel.tsx:163-168`, `LiveMessage.tsx:57`, `runtimeStore` | **No live elapsed / token indicator while a request is in flight.** Header stats sum only finalized messages; the live bubble shows only a `thinking…/streaming…` badge — the first response shows no progress signal. | Stamp a run/turn `startedAt`; show ticking elapsed (+ streamed-char estimate) in the live bubble. | M |
| U3 | **Med** | `Toolbar.tsx:94-96` | **"Save failed" is a dead end** — plain red text, no icon, no recovery, even though `flushSave` is already imported. | On `saveStatus === 'failed'`, render a "Retry" button wired to `flushSave()`. | S |
| U4 | **Med** | `Toast.tsx:9-21`, `uiStore.ts:98` | **Toasts are a single overwrite slot** — a second toast erases the first before it's read; bursts silently drop. | Model `toast` as a short queue; render stacked, advance one at a time. | M |
| U5 | **Med** | `CreateAgentWithAiModal.tsx:127-130, 241-279` | **AI draft is discard-and-restart only** — every field is read-only; the only way to tweak a near-miss is Discard → re-Generate. | Add "Regenerate" and/or make name/role/system-instruction editable before Apply. | M |
| U6 | **Med** | `SkillLibraryManager.tsx:93-123` | **Long skill list clips Export/Import.** Skills render directly in `.list` (`overflow: hidden`) with no `.listItems` scroll wrapper (contrast ProviderManager), so the trailing Export/Import row becomes unreachable. | Wrap the list in a `.listItems` (overflow-y auto); keep Add + Export/Import pinned outside it. | S |

---

## Tier 3 — Accessibility

| # | Severity | Location | Problem | Fix | Effort |
|---|----------|----------|---------|-----|--------|
| A1 | **Med** | `App.tsx:70-95` | **No skip-link.** A keyboard user must tab through ~11 toolbar buttons + the palette to reach the canvas. | Add a visually-hidden-until-focused `<a href="#main">Skip to canvas</a>`; `id="main"` on `<main>`. | S |
| A2 | **Med** | `AgentInspector.tsx:527,543,548` | **Skill name/description/instruction inputs are placeholder-only** — screen readers announce them unnamed. | Add `aria-label` to each. | S |
| A3 | **Med** | `AgentNode.tsx:38-39` | **Canvas nodes aren't focusable** — no `tabIndex`/`role`/`aria-label`; status is visual-only. | Add `tabIndex={0}`, `role="button"`, `aria-label` summarizing name + status. | S |
| A4 | **Med** | `CreateAgentWithAiModal.tsx:204-237` | **AI generation stream/error not announced** — no `role`/`aria-live` on the preview or error block. | `role="status"` polite for state transitions (not the raw token stream); `role="alert"` on the error block. | S |
| A5 | **Med** | `AgentInspector.tsx:352-360`, `RunDialog.tsx:396-408` | **Issue banners don't navigate to the offending field** and aren't `aria-live`; RunDialog's blocking summary is buried at the bottom of a long scroll while the disabled Start button sits in a fixed footer. | Make each issue a button that scrolls/focuses its field; wrap in `aria-live`; co-locate RunDialog's summary with the Start button. | M |
| A6 | **Low** | `Toast.tsx:5` | **`warn` and `error` share the `⚠` glyph** — severity conveyed by color alone. | Give `error` a distinct glyph (`✕`/`⛔`). | S |
| A7 | **Low** | `AgentInspector.tsx:417-429` | Color swatches are `aria-pressed` buttons, not a `role="radiogroup"` with arrow-key nav (single tab stop). | Wrap in `role="radiogroup"`, `role="radio"`/`aria-checked` per swatch, arrow-key handling. | M |
| A8 | **Low** | `ProviderManager.tsx:470-497` | Default-model radios lack a `<fieldset>/<legend>` — announced as loose radios. | Wrap in `fieldset` with a visually-hidden `legend`. | S |
| A9 | **Low** | `App.tsx` / panels | **No `<h1>`; heading levels skip** — brand is `<strong>`, panels jump to `<h3>`. | Promote brand to a styled `<h1>`; panel titles `<h2>`. | S |
| A10 | **Low** | `AgentLibraryPanel.tsx:76` | Dispose `aria-label` uses raw `s.name` → "Dispose " for untitled agents (row already falls back to "Untitled agent"). | Reuse the `s.name || 'Untitled agent'` fallback. | S |

---

## Tier 4 — Consistency & responsive polish

| # | Severity | Location | Problem | Fix | Effort |
|---|----------|----------|---------|-----|--------|
| P1 | **Med** | `graphAdapter.ts:93` | **`handoff` and `conversation` edges are visually identical** — only `review` gets a dash (`'6 4'`); the two solid types read apart only by a tiny label. | Give `handoff` its own dash/weight channel. | S |
| P2 | **Med** | `graphAdapter.ts:96` | **Muted edges keep a full-strength arrowhead** — line is `--edge-muted` but `markerEnd` stays `--edge`, so disabled edges show a faded line with a solid tip. | Derive marker color the same way as the stroke. | S |
| P3 | **Med** | `graphAdapter.ts:90-95` | **Selected edges show no on-canvas feedback** — inline `stroke` beats React Flow's `.selected` rule; selection only shows in the inspector. | Reflect the selected connection in the derived edge style. | S |
| P4 | **Med** | `Toolbar.module.css:18,25,29` | **Toolbar doesn't degrade well narrow** — relies on `flex-wrap` only; `.nameInput` is a rigid `width:200px` (no `min-width`/`flex`) and `.brand` is `nowrap`, so below ~600px the header grows tall and the name input overflows; `.sep` dividers orphan when rows wrap. | `.nameInput { min-width:0; flex:1 1 120px }`; collapse secondary groups into a "⋯ More" popover below a breakpoint; hide `.sep` when wrapped. | M |
| P5 | **Med** | `TimelinePage.tsx:255` vs `Message.tsx:59-60` vs `RunTranscriptView.tsx:71` | **Duration rendered three ways** — raw `5234ms` in the timeline, formatted `s`/`ms` in the transcript, omitted in run-review. | Extract one `formatDuration(ms)` helper; use everywhere. | S |
| P6 | **Low** | `GraphCanvas.tsx:179,214-221` | **Three overlapping fit/view affordances** — React Flow `<Controls>` fit button + custom "Fit graph" + "Reset view" (which differ only by `maxZoom`). | Drop one set; relabel so each action is distinct. | S |
| P7 | **Low** | `GraphCanvas.tsx:153` | **"No playground loaded" is bare muted text**, while the zero-agent state gets a titled actionable card — the two empty states are lopsided. | Give no-playground comparable framing + a create/load action. | S |
| P8 | **Low** | `Inspector.tsx:41`, `Section.tsx:13` | **Section open/closed resets on every reselect** — `Section` holds `open` locally and the inspector remounts via `key={agent.id}` (load-bearing — don't drop it). | Lift open/closed into a UI store keyed by section title. | M |
| P9 | **Low** | `AgentInspector.tsx:673,687` vs `ConnectionInspector.tsx:65-67` | **Connection-type terminology drifts** — `talk`/`review`/`handoff` vs raw `conversation` chip vs `Conversation flow`/`Review flow`/`Handoff flow`. | Centralize one `ConnectionType` label map; use in both selects and the chip. | S |
| P10 | **Low** | `RunDialog.tsx:354,366`, `AgentInspector.tsx:638` | **No upper bound on turn/token limits** — `min={1}` but no `max`, so `999999999` drives real budgets. | Add a documented `max` and clamp. | S |
| P11 | **Low** | `BottomPanel.tsx:235-242` | **Error items omit their timestamp** though `RunError.at` exists and log/event views show times. | Render `err.at` per item. | S |
| P12 | **Low** | `TimelinePage.tsx:262-265` | **Timeline reasoning is a bare `<pre>`** — can overflow the card horizontally, unlike the `.reqPre` (`pre-wrap`/scroll) used elsewhere. | Apply the same wrapped/scrollable treatment. | S |
| P13 | **Low** | `Toast.tsx:15-19` | **Pause-on-hover restarts the full duration** rather than the remaining time. | Track elapsed; schedule only the remainder on resume. | S |
| P14 | **Low** | glyphs: `Toolbar.tsx:157`, `Palette.tsx:48` | **Platform-fragile Unicode glyphs as icons** (`☀`/`☾`, `✨`) — inconsistent rendering; `✨` isn't `aria-hidden` and gets announced literally. | Adopt an inline-SVG icon set with `aria-hidden`; wrap decorative glyphs. | M |
| P15 | **Low** | `GraphCanvas.tsx:215`, `AgentNode.module.css`, `Toolbar.module.css`, `ErrorBoundary.module.css` | **Hardcoded px/font that predate the scale tokens** — canvas view buttons re-declare sizing instead of using `.secondary`; shell CSS uses raw `16px`/`8px 14px`. | Swap literals for `--space-*`/`--fs-*`/`--radius-*`; use button variants. | M (opportunistic) |
| P16 | **Low** | `Palette.module.css:1-2` | Fixed `width:200px; flex-shrink:0` palette never collapses on narrow screens. | Add a breakpoint that collapses it to a drawer below ~800px. | M |

---

## Recommended sequencing

1. **Fix the 17 red tests** (the `saveUsageEntry` mock) so the suite can catch regressions.
2. **Tier 1 (C1–C6)** — all Small, all genuine bugs; a single ~half-day PR. Highest value/effort ratio.
3. **Tier 2 UX + Tier 3 a11y small items** — retry actions (U1), skip-link (A1), aria-labels (A2/A4), save-retry (U3) — batch the Smalls.
4. **Tier 4 canvas edge legibility (P1–P3)** — three Smalls that meaningfully improve graph readability.
5. Larger items (U5 editable draft, P4 toolbar overflow, P8 section persistence, P14 icon set) as follow-ups.

Everything above is independently mergeable. Recommend validating each tier in
`npm run dev` (light + dark) since the contrast/spacing calls weren't visually checked.
