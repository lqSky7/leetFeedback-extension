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
| `net-protocol.js` | The page↔content message constants for both channels: `TRV_NET_CONFIG/ACK/EVENT` (platform) and `TRV_RECON_CONFIG/ACK/EVENT` (recon), plus the phase names |
| `net-bridge.js` | Isolated-world half of the interceptor: sends filters, forwards captured events to the adapter |
| `recon-controller.js` | Platform reconnaissance. Arms a capture-all recorder on problem pages of platforms with no verified adapter, labels the four judge flows, infers verdicts, scrapes button/editor selectors, stages the bundle for upload |
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
- **`recon-controller` is not part of the tracking stack.** It never touches
  `problem_data`, never counts runs, and never runs the pipeline — it is a
  *discovery* tool. Don't wire it into `platform-adapter.js`.
- **Recon's storage listener must filter on `enabled`.** It fires for
  every `chrome.storage.local` write, including the controller's own
  `recon_status`. Re-evaluating arming unconditionally is an infinite loop
  (`evaluateArming` → `publishStatus` → `set` → listener → …). This bug has been
  written once already; `tests/recon.test.js` guards it.
- **`pushConfig()` must be idempotent, and `evaluateArming()` runs on every SPA
  navigation.** The controller pushes its config whenever it re-evaluates arming
  while already armed, so an unconditional re-push is constant traffic. It is
  also how the worst bug in this feature happened: the interceptor used to reset
  its `seq` counter on every push while the controller kept its event map, so a
  mid-session re-push cross-attributed the whole capture. `pushConfig()` now
  skips an unchanged config, and the interceptor's `seq` is monotonic regardless.
  Do not "simplify" either guard away.
- Recon only arms when **all three** hold: the platform is mapped, the host is
  not excluded (LeetCode / TakeUforward / our own surfaces), the URL looks like a
  problem page, **and** an ingest token exists. A token is always available —
  `config.js` → `recon.defaultToken` is baked in — so in practice the third
  condition is satisfied out of the box. The requirement is deliberate: without
  any token the extension would accumulate captures it can never deliver, so a
  build shipped with an empty `defaultToken` and no stored override stays idle.
- **Recording must never require user setup.** The baked-in token exists so that
  someone who installs the extension and just opens a problem page contributes
  captures without ever opening the sidepanel. `tests/recon.test.js` pins this
  ("arms with the built-in token and no user setup") — a change that reintroduces
  a mandatory setup step breaks that scenario, and with it the whole point of the
  feature.
- **The built-in token is the only source; storage is not consulted.** A stored
  override used to take precedence, back when the sidepanel had a token field.
  Removing the field without removing the override is what broke uploads: a value
  left in `recon_ingest_token` by an older build kept winning, so every upload was
  rejected 401 with no UI left to clear it. `tests/recon.test.js` pins the
  ignore ("a stale stored token is ignored").
- **Delivery must not wait for a complete session.** The four flows describe what
  a *complete* picture looks like, not a precondition. Auto-upload fires once the
  page goes quiet (`scheduleAutoUpload`), with a longer quiet period when there is
  no pass/fail pair yet — that pair is what lets the backend diff two responses
  and name the verdict field, so it is worth a little patience but never a
  blocker. The bug this replaced required all four flows, which meant captures sat
  in `chrome.storage` forever on any platform that does not expose every path.
  `tests/recon.test.js` pins this ("auto-uploads a partial capture with no
  failure"). Re-uploads are keyed on the set of observed flows, so a later, fuller
  capture is delivered without looping on an identical one.
- **The ingest token is a client credential, not a per-user secret.** It ships in
  the extension bundle; its only job is to stop someone who guesses the endpoint
  URL from mailing the operator or filling the server's disk. It must match
  `RECON_INGEST_TOKEN` on the backend, and the two are rotated together. Rotating
  the server value without updating `defaultToken` silently stops all captures.
- The bundle is staged in `chrome.storage.local` and read by the *background
  worker*; it is never sent through `runtime.sendMessage`, which serialises the
  whole payload across a process boundary and is size-limited. This is why
  `unlimitedStorage` is in `manifest.json`.
- `recon-controller.destroy()` exists for teardown (and for tests). Its scan
  interval and persist timers otherwise outlive a page and write status into
  whatever storage context exists later.

## 5. Where to make common changes

| Change | File |
|---|---|
| New config value / key name | `config.js` |
| Different log tags or log format | `logger.js` |
| New backend field | `backend-api.js` → `formatProblemDataForBackend` |
| New step in the post-accept flow | `submission-pipeline.js` → `execute` |
| New lifecycle hook for all platforms | `platform-adapter.js` |
| New helper for platform adapters | `platform-adapter.js` (or `util.js` if pure) |
| Which platforms recon runs on, and its capture caps | `config.js` → `recon` |
| How a captured verdict is recognised | `recon-controller.js` → `inferVerdict` / the token lists |
| How button/editor selectors are generated | `recon-controller.js` → `stableSelector`, `describe*` |
| A new message between page and content script | `net-protocol.js` **and** `page/net-interceptor.js` |
