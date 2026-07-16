# Multilingual (English + Persian) & RTL — Implementation Plan

Status: **planned, not started**. Scope: add English (`en`, LTR) and Persian (`fa`, RTL)
UI localization to the Multi-Agent Playground, with a correct RTL layout.

This plan is written to be executed **strictly in order** and **incrementally**: after every
phase, `npm run typecheck` and `npm test` must be green before moving on. No big-bang extraction.

---

## 0. Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Library | **`i18next` + `react-i18next`** | Standard, bundles fine under the strict CSP, Persian CLDR plurals are trivial (`one`/`other`). Extraction is ~80% of the work regardless of library, so the library choice is deliberately low-drama. |
| Locales | Exactly **`en`** and **`fa`** | YAGNI: no speculative N-language infra, no locale-routing/URL-locale machinery, no lazy per-namespace HTTP loading. Two static bundled catalogs. |
| Persian calendar | **Jalali** (`Intl.DateTimeFormat('fa-IR')` default) | Native expectation for Persian users. English stays Gregorian. Reversible. |
| Persian digits | **Persian `۰۱۲۳`** (`Intl.NumberFormat('fa-IR')` default) | Native default. Latin content (model IDs, URLs, code) stays Latin — see §2. |
| Font | **Vazirmatn, self-hosted** (woff2 in repo) | CSP is `font-src 'self' data:` — no CDN fonts allowed. |
| Persistence | `localStorage` via `prefs.ts`, mirroring `theme` | Same proven pattern already in the app. |

---

## 1. The load-bearing principle: **Chrome vs Content**

The single most important boundary. This app is mostly **content**, not **chrome**.

- **Chrome** (gets a translation catalog): buttons, labels, panel/section titles, menu items,
  toasts, confirm/dialog copy, settings, tooltips, empty-states, the mobile tab bar, validation
  messages. *This is the only text we translate.*
- **Content** (NEVER translated, but must render with correct **bidi**): agent names & roles,
  system prompts, model IDs, provider base URLs, transcript message bodies, tool names/inputs/outputs,
  code blocks, exported markdown. These stay verbatim in whatever language/script the user or model
  produced, and must be **bidi-isolated** (`dir="auto"`) so a Latin model ID or URL doesn't visually
  scramble when embedded in an RTL sentence.

> The `grep >[A-Z]…<` count of ~144 is a **ceiling**, not the extraction target. The real target is
> chrome-only. Drawing this line is what keeps "audit 57 files" from ballooning and prevents
> translating strings that must stay exact.

---

## 2. Bidi hygiene for content (do this alongside RTL CSS)

Wherever user/model content is rendered inside the UI, wrap it so it isolates from surrounding
direction:
- Free-text content containers: add `dir="auto"` (browser picks direction from first strong char).
- Inline Latin tokens inside RTL sentences (model IDs, URLs, token counts with units): wrap in a
  span with `dir="ltr"` and `unicode-bidi: isolate`, or use the U+2066/U+2069 isolates in composed
  strings.
- Code blocks / `MessageMarkdown` / transcript bodies: force `dir="auto"` at the block level; never
  inherit `rtl` blindly.

Touch points: [Message.tsx](../src/ui/transcript/Message.tsx),
[MessageMarkdown.tsx](../src/ui/transcript/MessageMarkdown.tsx),
[LiveMessage.tsx](../src/ui/transcript/LiveMessage.tsx),
[RunTranscriptView.tsx](../src/ui/runs/RunTranscriptView.tsx),
[AgentInspector.tsx](../src/ui/inspector/AgentInspector.tsx), graph node labels.

---

## 3. Phased execution

### Phase 1 — Infrastructure (no visible string changes yet)

Goal: language can be selected, persisted, and flips `dir`/`lang` correctly, before any string is
extracted. After this phase the app still shows English everywhere.

1. **Add deps**: `i18next`, `react-i18next`. (Both bundled by Vite; CSP-safe.)
2. **Catalog files**: create `src/i18n/locales/en.json` and `src/i18n/locales/fa.json`
   (start with a handful of shared keys; grows per area in Phases 4+). Namespaced by area
   (`common`, `toolbar`, `settings`, `timeline`, `mobile`, …) — one flat file per locale with
   nested namespaces is fine at 2 locales.
3. **i18n init**: `src/i18n/index.ts` — `i18next.use(initReactI18next).init({...})` with `en`/`fa`
   resources statically imported, `fallbackLng: 'en'`, `interpolation.escapeValue: false` (React
   already escapes). No HTTP backend, no language-detector plugin (we read our own pref).
4. **Prefs** — extend [prefs.ts](../src/store/prefs.ts): add `Language = 'en' | 'fa'`,
   `getLanguage()`/`setLanguage()` against `map.lang`, mirroring `getTheme`/`setTheme` exactly
   (same try/catch localStorage discipline).
5. **Store** — extend [uiStore.ts](../src/store/uiStore.ts): add `language` + `setLanguage(lang)`
   that persists via `setLanguage` and calls `i18next.changeLanguage(lang)`.
6. **App wiring** — in [App.tsx](../src/App.tsx), mirror the existing theme `useEffect`:
   ```
   useEffect(() => {
     const dir = language === 'fa' ? 'rtl' : 'ltr';
     document.documentElement.setAttribute('lang', language);
     document.documentElement.setAttribute('dir', dir);
   }, [language]);
   ```
   Also wrap the tree so `react-i18next` is initialized (import `./i18n` in `main.tsx`).
   Do the same in [MobileApp.tsx](../src/ui/mobile/MobileApp.tsx) path — it shares the same root
   element, so the single `useEffect` in `App` covers both, but verify mobile mounts under the same
   `documentElement`.
7. **No-flash init** — [index.html](../index.html): change the static `<html lang="en">` and add a
   tiny inline pre-mount script that reads `localStorage['map.lang']` and sets `lang`/`dir` on
   `document.documentElement` before the bundle mounts, preventing a wrong-direction flash on load.
   (Note: CSP is `script-src 'self'` — an *inline* script needs a nonce/hash or moving to a
   `/src` module. Preferred: a tiny `public/` or inline-hash approach; if hashing is friction, set
   `dir` in `main.tsx` before `createRoot` render as an acceptable fallback with a minor flash.)

**Gate:** typecheck + tests green. Manually toggle language → whole document flips `dir` but text is
still English (fine).

### Phase 2 — Font & RTL CSS foundation

1. **Vazirmatn** self-hosted: add `Vazirmatn[wght].woff2` under `src/ui/styles/fonts/` (variable
   font, subset if size matters), `@font-face` in [global.css](../src/ui/styles/global.css). Apply
   as the font-family when `:root[dir="rtl"]` (keep the existing Latin stack for `ltr`).
2. **Logical properties sweep** — convert the *modest* directional CSS to logical props so RTL is
   mostly automatic. Grep-confirmed inventory is small:
   - `margin-left/right` → `margin-inline-start/end`
   - `padding-left/right` → `padding-inline-start/end`
   - `border-left/right` → `border-inline-start/end`
   - `text-align: left/right` → `text-align: start/end`
   - absolute `left:/right:` on chrome → `inset-inline-start/end`
   Files with hits (from audit): [Timeline.module.css](../src/ui/timeline/Timeline.module.css),
   [Transcript.module.css](../src/ui/transcript/Transcript.module.css),
   [RunTranscriptView.module.css](../src/ui/runs/RunTranscriptView.module.css),
   [global.css](../src/ui/styles/global.css), and the handful of others surfaced by:
   `grep -rEn "(margin|padding|border)-(left|right)|text-align:\s*(left|right)|\b(left|right):" src --include=*.css`
3. **Directional icons**: chevrons/arrows/back-buttons/"→" glyphs must mirror in RTL. Add a
   `:root[dir="rtl"] .someIcon { transform: scaleX(-1); }` utility, or gate per-icon. Inventory the
   arrow glyphs in [Message.tsx](../src/ui/transcript/Message.tsx) (`→ ${t.tool}`) and
   [icons.tsx](../src/ui/mobile/icons.tsx).

**Gate:** typecheck + tests green; in `fa` mode the layout mirrors correctly with English text.

### Phase 3 — Canvas exclusion (explicit)

The `@xyflow/react` graph canvas coordinate system is **data**, not layout. Do **NOT** flip
pan/zoom/node coordinates for RTL — node positions are persisted domain data.
- Keep the canvas viewport LTR.
- Only the **node-internal chrome** (labels, buttons inside a node, inspector) gets RTL + translation.
- Verify [GraphCanvas](../src/graph/) and node components don't inherit a layout-breaking `dir`.
  If needed, pin `dir="ltr"` on the flow viewport wrapper and re-assert `dir` on node label content
  via `dir="auto"`.

**Gate:** in `fa` mode, dragging/connecting nodes behaves identically to `en`; only labels flip.

### Phase 4 — Formatting helpers (locale-aware numbers/dates)

Centralize so extraction later is mechanical. Persian gets Jalali + Persian digits by default.

1. Create `src/i18n/format.ts`:
   - `formatNumber(n, lang)` → `new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-US').format(n)`
   - `formatDateTime(ts, lang)` / `formatTime(ts, lang)` → `Intl.DateTimeFormat` with `fa-IR`
     (Jalali by default) vs `en-US`.
   - `formatTokens(n, lang)` for the `.toLocaleString()` token counts.
2. Refactor [formatDuration.ts](../src/ui/formatDuration.ts) to accept `lang` and use
   `formatNumber` for the numeric part (`ms`/`s` unit labels themselves become catalog strings).
3. Replace the raw calls found in the audit — each of these currently hard-codes host-locale
   formatting and must route through the helpers:
   [AgentLibraryPanel.tsx:54](../src/ui/AgentLibraryPanel.tsx#L54),
   [FallbackSuggestModal.tsx:106-108](../src/ui/FallbackSuggestModal.tsx#L106),
   [BottomPanel.tsx:177,234,249](../src/ui/BottomPanel.tsx#L177),
   [PlaygroundsPanel.tsx:137](../src/ui/PlaygroundsPanel.tsx#L137),
   [RunTranscriptView.tsx:57](../src/ui/runs/RunTranscriptView.tsx#L57),
   [ConversationRunsPanel.tsx](../src/ui/runs/ConversationRunsPanel.tsx),
   [UsagePanel.tsx](../src/ui/UsagePanel.tsx),
   [TimelinePage.tsx](../src/ui/timeline/TimelinePage.tsx),
   [Message.tsx](../src/ui/transcript/Message.tsx),
   [FailureDiagnostics.tsx](../src/ui/transcript/FailureDiagnostics.tsx).
4. **Deliberately excluded from localization** (stay Latin, machine-facing):
   - [exportConversation.ts](../src/ui/timeline/exportConversation.ts) — exported artifacts should
     stay stable/portable (`toISOString`, ASCII). Confirm with product; default = keep as-is.
   - [budget.ts](../src/usage/budget.ts) / [pricing.ts](../src/usage/pricing.ts) `$`/`toFixed`
     currency — USD formatting stays Latin unless product wants otherwise.

**Gate:** in `fa`, dates render Jalali with Persian digits; in `en`, unchanged.

### Phase 5 — Chrome string extraction, **area by area**

Extract one area per commit; typecheck + tests green after each. Suggested order (leaf-first,
low-risk → high-traffic):

1. `common` shared: buttons (Save/Cancel/Delete/Close), confirm dialog defaults
   ([ConfirmDialog.tsx](../src/ui/ConfirmDialog.tsx), confirm copy).
2. [Toolbar.tsx](../src/ui/Toolbar.tsx) / [AppFooter.tsx](../src/ui/AppFooter.tsx) /
   [Palette.tsx](../src/ui/Palette.tsx).
3. [SettingsPanel.tsx](../src/ui/SettingsPanel.tsx) — **add the language switcher here** (dropdown
   next to the theme toggle), the user-facing entry point.
4. Panels: [ProviderManager.tsx](../src/ui/ProviderManager.tsx),
   [SkillLibraryManager.tsx](../src/ui/SkillLibraryManager.tsx),
   [PlaygroundsPanel.tsx](../src/ui/PlaygroundsPanel.tsx),
   [AgentLibraryPanel.tsx](../src/ui/AgentLibraryPanel.tsx),
   [UsagePanel.tsx](../src/ui/UsagePanel.tsx), [RunDialog.tsx](../src/ui/RunDialog.tsx).
5. Modals: [CreateAgentWithAiModal.tsx](../src/ui/CreateAgentWithAiModal.tsx),
   [SmartArrangeModal.tsx](../src/ui/SmartArrangeModal.tsx),
   [FallbackSuggestModal.tsx](../src/ui/FallbackSuggestModal.tsx),
   [FailureDecisionModal.tsx](../src/ui/FailureDecisionModal.tsx).
6. Inspector: [AgentInspector.tsx](../src/ui/inspector/AgentInspector.tsx),
   [ConnectionInspector.tsx](../src/ui/inspector/ConnectionInspector.tsx),
   [Section.tsx](../src/ui/inspector/Section.tsx).
7. Timeline/runs: [TimelinePage.tsx](../src/ui/timeline/TimelinePage.tsx),
   [ConversationRunsPanel.tsx](../src/ui/runs/ConversationRunsPanel.tsx),
   [BottomPanel.tsx](../src/ui/BottomPanel.tsx).
8. Transcript chrome (labels only, NOT bodies):
   [Message.tsx](../src/ui/transcript/Message.tsx),
   [FailureDiagnostics.tsx](../src/ui/transcript/FailureDiagnostics.tsx).
9. **Mobile** (in scope): [MobileTabBar.tsx](../src/ui/mobile/MobileTabBar.tsx),
   [MobileChat.tsx](../src/ui/mobile/MobileChat.tsx), [MobileAgents.tsx](../src/ui/mobile/MobileAgents.tsx),
   [MobileMenu.tsx](../src/ui/mobile/MobileMenu.tsx).
10. Toasts & non-component strings surfaced to the user: audit `useUiStore().toast(...)` /
    `showToast` call sites and validation messages in
    [orchestrator/validate.ts](../src/orchestrator/validate.ts) that reach the UI.

Extraction mechanics per string:
- `const { t } = useTranslation()` (or `useTranslation('area')`).
- Replace literal with `t('area.key')`; add key to **both** `en.json` and `fa.json`.
- Plurals: `t('key', { count })` with `_one`/`_other` variants (fa has `one`/`other` in CLDR).
- Interpolated values: `t('key', { name, count })` — never string-concatenate translated fragments
  (word order differs in Persian).

### Phase 6 — Persian translations & RTL QA

1. Fill `fa.json` values (were placeholder/English during Phase 5). Persian copy review.
2. Full RTL visual QA pass: every panel, modal, mobile view, inspector, timeline. Check:
   mirrored padding/alignment, icon direction, Latin content islands (IDs/URLs/code) still LTR and
   legible, no clipped/overflowing text, scrollbars/resize handles on the correct side.
3. Toggle-during-run smoke test: switch language mid-session, confirm no crash and live transcript
   content stays bidi-correct.

---

## 4. Testing strategy (critical — do in Phase 1)

Existing tests assert on **English text** (e.g. [Message.test.tsx](../src/ui/transcript/__tests__/Message.test.tsx),
BottomPanel, RunDialog, PlaygroundsPanel, TimelinePage). To keep them green through extraction:

- In [src/test/](../src/test/) setup, **initialize i18next with the real English resources** (not
  `cimode`). `cimode` returns raw keys and would break every text assertion. With real `en`
  resources, `t('save.button')` → `"Save"` and existing assertions pass unchanged.
- Ensure the test i18n instance defaults `lng: 'en'`.
- Add **new** focused tests:
  - `prefs` language get/set round-trip.
  - `App` sets `dir="rtl"`/`lang="fa"` on `documentElement` when language is `fa`.
  - `format.ts`: `formatNumber(1234,'fa')` yields Persian digits; `formatDateTime` yields Jalali
    for `fa` (assert against a fixed timestamp — note `Intl` output can vary by ICU version, so
    assert on digit-script/separators rather than exact string where brittle).
  - One RTL render smoke test (a panel rendered under `dir="rtl"`).

Check `vite.config.ts` / test setup for how `global.css` and providers are loaded so the i18n init
is registered once for all tests.

---

## 5. Files created / touched (summary)

**New:**
- `src/i18n/index.ts` (init)
- `src/i18n/format.ts` (locale number/date helpers)
- `src/i18n/locales/en.json`, `src/i18n/locales/fa.json`
- `src/ui/styles/fonts/Vazirmatn*.woff2` + `@font-face`
- tests: prefs lang, App dir/lang, format helpers

**Modified (infra):** [prefs.ts](../src/store/prefs.ts), [uiStore.ts](../src/store/uiStore.ts),
[App.tsx](../src/App.tsx), [main.tsx](../src/main.tsx), [index.html](../index.html),
[global.css](../src/ui/styles/global.css), [SettingsPanel.tsx](../src/ui/SettingsPanel.tsx)
(language switcher).

**Modified (extraction + CSS logical props):** the UI files enumerated in Phase 5, their
`.module.css` siblings for logical-property conversion, and the formatting call sites in Phase 4.

---

## 6. Explicit non-goals (YAGNI guardrails)

- No third+ language, no locale-routing, no URL/subdomain locale, no server-side detection.
- No lazy/HTTP-loaded translation namespaces — static bundled JSON only.
- No translation of **content** (agent data, prompts, model IDs, transcript bodies, exports).
- No localization of machine-facing artifacts (`exportConversation` ISO timestamps, USD pricing)
  unless product explicitly requests it.
- No auto-translation of user text; no RTL flip of the graph canvas coordinate space.

---

## 7. Open items to confirm before/while building

- Inline no-flash script vs CSP `script-src 'self'` (Phase 1.7): choose nonce/hash vs `main.tsx`
  pre-render `dir` set. Recommend the latter for simplicity.
- Whether USD pricing and exported markdown should localize digits (default: **no**, keep Latin).
- Persian copy owner/reviewer for `fa.json` (Phase 6).
