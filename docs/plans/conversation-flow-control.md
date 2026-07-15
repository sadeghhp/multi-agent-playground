# Conversation Flow Control — Failure Recovery & User Steering

## Goal

When a run hits trouble — an agent's request fails, fails repeatedly, or the user
wants to intervene — give the user real control over the flow instead of today's
binary "stop the whole run" vs. "silently skip." Headline case: **an agent that
keeps failing can be removed from the circuit** without killing the run.

## Scope note (read first)

Runtime state is memory-only and never resumed across a page reload (spec §16).
"Handle interruptions" here means **within a session**: stop / skip / retry /
remove-from-circuit while the app stays open. It is **not** resume-after-refresh —
we are not promising that.

---

## Current behavior (baseline)

- [`startRun`](../../src/orchestrator/orchestrator.ts) is one async `while` loop
  over a local `queue`. One run at a time; a single `AbortController` cancels the
  in-flight request and the loop.
- On failure, [`recordFailure`](../../src/orchestrator/orchestrator.ts) marks the
  agent `failed`, pushes a `RunError`, appends a failed transcript message, then:
  `stopOnError ? finish('error') : continue` — no retry, no user choice.
- One pause-for-decision flow already exists: `requestFallbackSuggestion`
  ([uiStore](../../src/store/uiStore.ts)) blocks the loop on a promise a modal
  resolves. **This is the pattern we generalize.**
- "Circuit membership" is `agent.runtime.enabled`, consulted by `outgoing()` and
  the dequeue check — but the graph is locked during a run, so mid-run removal
  needs a run-scoped mechanism.
- The Errors tab ([BottomPanel](../../src/ui/BottomPanel.tsx)) shows a
  `retry-eligible` chip but wires **no** retry action.

## Core design constraint

The loop can only accept user control **at points it actually reaches** — mid-run
that is the failure site (and an optional between-turns check). So:

- **In-run steering = "what to do at a failure" + a run-scoped disabled set.**
  Decisions are made inline at the failure site (retry / skip / disable / switch /
  stop). The queue stays **local** — no hoisting for phase 1.
- **Anything that must react while the loop is mid-generation goes through the
  abort signal**, not a new channel.

---

## Phase 1 — Failure policy + auto-retry + consecutive-failure escalation

The engine work. No blocking modal on every failure (that would hang tests and
walked-away users); prompting is a *policy*, and the headline "remove on repeated
failure" is an *automatic escalation*.

### 1a. Schema (additive — keep `stopOnError`)

`domain/schema.ts` + `factories.ts`: add an optional `failurePolicy` to
`ConversationSettings`, all fields defaulted so existing playgrounds parse
unchanged (same additive pattern the schema already documents):

```ts
failurePolicy: {
  onFailure: 'stop' | 'skip' | 'prompt'   // default derived from stopOnError (see below)
  maxAutoRetries: number                   // default 2; retry-eligible kinds only
  backoffMs: number                        // default 800, exponential
  autoDisableAfterFailures: number         // default 3; 0 = never
}
```

- **Back-compat / migration:** default `onFailure` from the existing boolean —
  `stopOnError === true → 'stop'`, `false → 'skip'`. Keep `stopOnError` as the
  source of truth for that field's default so no `persistence/migrate.ts` step is
  needed and old runs behave identically until the user opts into `'prompt'`.
- Auto-retry and auto-disable apply under **all** modes (they precede the
  onFailure decision), so even a `'stop'` run now survives a transient blip.

### 1b. Run-scoped disabled set (runtimeStore)

Add to [`runtimeStore`](../../src/store/runtimeStore.ts):

- `runDisabledAgents: Set<string>` (or `Record<string, true>`) — agents removed
  from the circuit for **this run only**; domain model untouched (graph stays
  locked, spec §10.3).
- `consecutiveFailures: Record<string, number>` — per-agent streak.
- Actions: `disableAgentForRun(id)`, `recordAgentFailure(id)`,
  `resetAgentFailures(id)`, plus selectors. Reset in `startRun`'s `initial`.

Consult `runDisabledAgents` in **both** places membership is checked:
`outgoing()` (don't enqueue a removed target) and the dequeue guard (skip if it
got removed after being queued).

### 1c. Auto-retry with abortable backoff

Wrap generation in a retry helper around the existing
`callWithBudgetAndOptionalFallback`:

- Retry only `retryEligible(kind)` kinds (rate-limit / timeout / server-error /
  network) up to `maxAutoRetries`, exponential `backoffMs`.
- **Backoff sleep must be abortable** — `await` a promise that also rejects on
  `controller.signal` `abort`; on abort, break the loop like any other abort.
  (Audit: the existing fallback flow has the same latent gap — a stop while its
  modal or retry is pending. Fix there too.)
- Emit `log('request-retrying', …)` per attempt so the event log shows it.

### 1d. Consecutive-failure counting + escalation

- On any **success**: `resetAgentFailures(agentId)` (defines "consecutive").
- On a failure that survives auto-retry: `recordAgentFailure`. If the streak
  reaches `autoDisableAfterFailures`:
  - `'prompt'` mode → surface the decision modal with **"Remove from circuit"**
    preselected (the headline case).
  - `'stop'` / `'skip'` mode → auto-disable, `log('agent-auto-disabled', …)`,
    toast, and continue. This is the automatic realization of the user's example.
- **Queue-drain outcome (state it):** if removing the agent leaves the queue
  empty, the run simply ends (`completed`). Documented, not a surprise.

### 1e. The failure-decision layer (only in `'prompt'` mode)

Generalize `requestFallbackSuggestion` into `requestFailureDecision` on
[uiStore](../../src/store/uiStore.ts), returning one of:

- `retry` — re-attempt the same turn now.
- `skip` — `continue` (drop this turn, keep the run).
- `disable` — `disableAgentForRun` then continue (**remove from circuit**).
- `switchProvider` — **reuse** the existing `listFallbackCandidates` / budget /
  `setProviderOverride` logic (do not fork a copy) then retry.
- `stop` — `finish('error')`.

Abort safety: **while the modal is pending, an abort resolves it to `stop`** (the
loop must never hang on a decision after the user hit Stop).

---

## Phase 2 — UI surface  ✅ (decision modal, RunDialog controls, graph greying)

Done: `FailureDecisionModal` (mounted in App), RunDialog `failurePolicy` controls
(On failure / Auto-retries / Remove-after-N, `stopOnError` kept synced), and
auto-disabled agents grey out via the `disabled` runtime state. The Errors-tab
retry button is folded into Phase 3 (it needs `retryAgentTurn`).

### Original Phase 2 notes

- **Failure-decision modal** — new component modeled on
  `FallbackSuggestModal`, driven by `uiStore.failureDecision`, mounted next to the
  existing fallback modal in [`App.tsx`](../../src/App.tsx). Buttons map to the
  Phase-1 decisions; shows the diagnostics from `FailureDiagnostics` inline so the
  user decides with the error in view. Mobile: reuse `Modal` (already responsive).
- **Errors tab retry action** ([BottomPanel](../../src/ui/BottomPanel.tsx)) — wire
  the dormant `retry-eligible` chip to a "Retry" button (enabled once the run has
  stopped) → Phase-3 `retryAgentTurn`. Until Phase 3 lands, the button can offer
  "re-run from start" via existing `startRun`.
- **Run settings** ([RunDialog](../../src/ui/RunDialog.tsx)) — replace the lone
  `stopOnError` checkbox with the `failurePolicy` controls (On failure:
  stop/skip/prompt; auto-retries; auto-disable threshold). Keep the default
  visually equal to today.
- **Toolbar / graph** — a removed agent renders visibly (dimmed + "removed this
  run" badge, reusing the disabled styling); optional per-agent "Remove from run"
  action on the active/failed node.

---

## Phase 3 — Proactive pause/resume + post-run manual retry  ✅

Delivered. The structural change was small: `startRun(opts?: { seed?: QueueItem[] })`
now accepts an initial queue (default = the starting agent), which enables retry.

- **Pause/Resume:** new `'paused'` status + `pauseRequested` flag. The loop checks
  it at the top of each iteration and awaits an abortable `waitForResume`; the
  in-flight turn always finishes first. `pauseRun`/`resumeRun` in the orchestrator,
  **Pause**/**Resume** buttons in the Toolbar. Stop works from paused too (abort
  resolves the wait). Pause is desktop-only (mobile has no trigger, so no paused
  state arises there).
- **Post-run `retryAgentTurn(agentId)`:** seeds a fresh run at the failed agent,
  reconstructing source/incoming-connection from its most recent failed transcript
  entry, then continues the graph. Wired to a **Retry** button on each Errors-tab
  row (shown only when no run is active).

Tests added: pause-then-resume-to-completion, stop-while-paused (no hang),
retry re-runs a failed agent, retry is a no-op while active.

---

## Testing

- **Orchestrator** ([existing suite](../../src/orchestrator/__tests__/orchestrator.test.ts)
  drives `startRun` with a mocked `sendChat` — extend it): auto-retry then success;
  retries exhausted → onFailure branch per mode; consecutive-failure auto-disable
  removes the agent from `outgoing()`; disable drains queue → `completed`; abort
  during backoff and during a pending decision both stop cleanly.
- **runtimeStore**: disabled-set + streak actions and resets.
- **UI**: failure-decision modal resolves each action; Errors-tab retry enabled
  only when stopped.
- **Guard the no-user path:** assert a `'stop'`/`'skip'` run never awaits a modal
  (no hang) — the property that keeps CI and walked-away users safe.

## Risks

- Reusing the abort signal for backoff + decision + (later) pause: centralize
  "abortable await" in one helper so all three share audited logic.
- `'prompt'` mode is opt-in precisely so automated/unattended runs can't hang.
- Phase-3 seed-queue refactor is the only change touching the loop's core shape —
  isolated behind a defaulted parameter to keep phases 1–2 low-risk.
