# `ui/` — content-script UI

## 1. Purpose

User-facing elements injected into the tracked problem pages. Split out from
`core/` because they are presentation only — no persistence, no network, no
tracking logic. Both are instantiated at load and exposed on `window` because
the submission pipeline and the adapters look them up by name.

**Read the UI-freeze invariant in the root `index.md` before editing anything
here.** These files are ports: appearance, copy, sizes, colours and animation
timings must not change.

## 2. Modules

| File | Exposes | Responsibility |
|---|---|---|
| `toast.js` | `window.LeetFeedbackToast`, `T.LeetFeedbackToast` | Small stacked messages, plus `SubmissionTracker` — the square JUDGING → SYNCING → synced/failed card |
| `hint-prompt.js` | `window.LeetFeedbackHintPrompt`, `T.LeetFeedbackHintPrompt` | The post-accept "Did you use any Hint?" dialog with its countdown |

The timer overlay is *not* here — it lives in `core/problem-timer.js` because it
also owns active-time persistence.

## 3. Data flow

**In:** method calls only. Nothing listens to storage, the network, or messages.

| Caller | Call |
|---|---|
| `core/submission-pipeline.js` | `LeetFeedbackHintPrompt.ask()` → `'none' \| 'hint' \| 'solution'` |
| `core/submission-pipeline.js` | `submissionTracker.setAISkipped()`, `.setBackendStarted()`, `.succeed(msg)`, `.fail(msg)` |
| `core/platform-adapter.js` | `LeetFeedbackToast.createSubmission()`; `.fail(status)` on a rejected submit |
| anything | `LeetFeedbackToast.success/error/info(msg)` |

**Out:** DOM nodes appended to `document.body`, and a `<style>` block per
component (guarded by a fixed element id so it is injected once).

## 4. Invariants & gotchas

- The `window.*` global names are load-bearing. `core/submission-pipeline.js`
  and `core/platform-adapter.js` reference them literally. Renaming one means
  updating those call sites in the same commit.
- `SubmissionTracker` never shows an "analysing" phase — AI analysis moved
  server-side, so `setAIStarted()` and `setAIComplete()` both delegate to
  `setAISkipped()`. That is intentional; the card goes straight to "Syncing...".
- `_transitionTo` enforces a minimum dwell time per state (`minDurations`) so a
  fast backend response cannot flicker the animation. Don't bypass it.
- `fail()` returns early when the state is already `launching` — a late error
  must never overwrite a successful sync.
- `HintPrompt.ask()` **never rejects and never hangs**: it resolves with the
  configured default when the prompt is disabled, on Escape, on backdrop click,
  and when the countdown expires. The pipeline awaits it before pushing, so a
  hang here would block the push entirely.
- A second `ask()` while a prompt is open settles the previous one with the
  default first (`_settle` is idempotent).
- `ToastNotification.init()` appends to `document.body` in its constructor, so
  these files must load at `document_end`, not `document_start`.

## 5. Where to make common changes

| Change | File |
|---|---|
| Toast wording or duration | the call site, not `toast.js` |
| Submission card states/animations | `toast.js` → `SubmissionTracker` (UI freeze applies) |
| Hint prompt copy, options, keyboard shortcuts | `hint-prompt.js` |
| Hint prompt timing / default option | sidepanel settings; keys are in `core/config.js` |
| A new piece of injected UI | a new file here, plus an entry in the content-script list in `manifest.json` |
