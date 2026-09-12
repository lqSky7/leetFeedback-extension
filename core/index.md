# `core/` — framework modules

## 1. Purpose

Everything that is not site-specific and not pure UI. These files own the data
model (`problem_data`), attempt counting, the post-accept pipeline, the network
bridge to the page world, configuration, logging, and the adapter base class
that every platform extends.

They are loaded by `<script>` order in `manifest.json` (content scripts), by
`importScripts` (background) and by `<script>` tags (sidepanel). Each attaches to
`globalThis.Traverse` (`T`).

## 2. Modules

Load order matters — the list below is in dependency order.

| File | Responsibility |
|---|---|
| `config.js` | **Single source of truth.** Backend/website/GitHub URLs, allowed external origins, every `chrome.storage` key name, the failure threshold, the DOM-fallback switches. Dependency-free; loads in any context |
| `logger.js` | Tag-based logger reading one `debug_mode` key. Exposes `T.logger` and `T.createLogger(tag)`. Also sets legacy `window.debugLog/debugError/debugWarn` |
| `util.js` | Pure helpers: `sleep`, difficulty normalization, filename/commit/directory formatting, GitHub config reading, `sanitizeCode` |
| `net-protocol.js` | The page↔content message constants (`TRV_NET_CONFIG/ACK/EVENT`) and the request/response phase names |
| `net-bridge.js` | Isolated-world half of the interceptor: sends filters, forwards captured events to the adapter |
| `ai-config.js` | Reads the user's AI provider/key from storage so the backend can analyse on their behalf |
| `session-store.js` | The only module that touches `problem_data_<key>` storage: key derivation, read, merge-write, remove |
| `attempt-tracker.js` | Attempts, run/submit counters, the failure threshold, the AI-analysis flag, the `tries` metric |
| `backend-api.js` | Builds and POSTs the `/api/submissions` payload via the background worker |
| `github-api.js` | Optional `solution.md` mirroring to the user's repo |
| `submission-pipeline.js` | Post-accept orchestration: hint prompt → backend push → GitHub push → reset |
| `problem-timer.js` | Active-time tracking + the draggable overlay. Singleton on `window.ProblemTimer` |
| `platform-adapter.js` | `PlatformAdapter` base class + `T.startPlatform()` bootstrap |

`auth.js` (sidepanel authentication) also lives here but is **not** loaded by
content scripts — only by `sidepanel/sidepanel.html`.

## 3. Data flow

**In:** network events from `net-bridge`; DOM clicks and metadata from the
platform adapters; `chrome.storage` reads/writes.

**Out:** the `problem_data_<key>` record in `chrome.storage.local`; the backend
payload; `chrome.runtime.sendMessage` to the background worker; UI side effects
via `window.LeetFeedbackToast` / `window.LeetFeedbackHintPrompt` /
`window.ProblemTimer`.

## 4. Invariants & gotchas

- **`config.js` owns every URL and key string.** Never hardcode one elsewhere.
- **`session-store.js` owns the `problem_data_` prefix.** Don't build that key
  by hand — `T.sessionStore.getStorageKey()` exists for that.
- `attempt-tracker.reset()` sets `shouldAnalyzeWithGemini = true`, and
  `restore()` only honours an explicit persisted `false`. AI analysis is on by
  default for every problem — this is intentional; do not "optimise" it back.
- `AttemptTracker.recordRunResult` / `recordSubmissionResult` are **idempotent**:
  the sites poll their judge endpoints, so the same verdict arrives repeatedly.
  Don't remove the `successful === null` guards.
- `PlatformAdapter.handleProblemChange()` deliberately does **not** delete the
  previous problem's stored record — a solve that has not reached the backend
  yet must survive so the next accepted solve can still push it.
- `normalizeDifficulty` is idempotent: an already-normalized 0/1/2 passes
  through. Adapters pass raw labels, `storeProblemData` normalizes once.
- `captureFromDom` waits 300 ms before checking `netCapturedRecently`, because
  our click listener runs in the capture phase — before the site has sent its
  request. Without the delay the network capture can never win the race.
- The pipeline **preserves all state when the backend push fails** so the next
  accepted solve retries it. Don't move `tracker.reset()` earlier.
- `submission-pipeline` must stay free of `chrome.storage` writes other than the
  GitHub-push-enabled read; persistence belongs to the adapter.
- `problem-timer` writes through `T.sessionStore`, not raw `chrome.storage`.

## 5. Where to make common changes

| Change | File |
|---|---|
| New config value / key name | `config.js` |
| Different log tags or log format | `logger.js` |
| New backend field | `backend-api.js` → `formatProblemDataForBackend` |
| New step in the post-accept flow | `submission-pipeline.js` → `execute` |
| New lifecycle hook for all platforms | `platform-adapter.js` |
| New helper for platform adapters | `platform-adapter.js` (or `util.js` if pure) |
