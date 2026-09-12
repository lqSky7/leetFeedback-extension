# Traverse Chrome Extension — Architecture Map

MV3 extension that tracks DSA practice on LeetCode, GeeksforGeeks, TakeUforward,
CodeChef and Naukri Code360, and syncs each solved problem to the Traverse
backend (optionally mirroring it to GitHub).

It also carries a **platform recon** mode: on 18 DSA platforms that have no
verified adapter yet, it records a real session and reports the judge API back,
so a new adapter is written from evidence instead of guesswork. See §2a.

**Start here.** This file is the map. Every directory below has its own
`index.md` written for agents; if you can't work out where a change belongs from
this chain, the docs are wrong — fix them in the same commit.

Historical context, the audit that motivated the current layout, and the
remaining migration phases live in [REFACTOR_PLAN.md](REFACTOR_PLAN.md).

---

## 1. Directory index

| Path | Purpose | Docs |
|---|---|---|
| `core/` | Framework: config, logging, storage, attempt tracking, the submission pipeline, the adapter base class, API clients, the timer | [`core/index.md`](core/index.md) |
| `page/` | MAIN-world scripts injected into the tracked sites (network interceptor, Monaco bridge) | [`page/index.md`](page/index.md) |
| `platforms/` | One thin adapter per tracked site + the website auth bridge | [`platforms/index.md`](platforms/index.md) |
| `ui/` | Content-script UI: toasts, submission card, hint prompt | [`ui/index.md`](ui/index.md) |
| `background/` | Service worker: backend request proxy + auth storage owner | [`background/index.md`](background/index.md) |
| `sidepanel/` | The extension's own UI (HTML/CSS/JS), unchanged visually | [`sidepanel/index.md`](sidepanel/index.md) |
| `tests/` | Node scripts, no test runner: `smoke.test.js` (platform-adapter stack), `recon.test.js` (recon controller), `auth.test.js`, `g4f-api-test.mjs`. Run them directly with `node` | — |
| `icons/`, `fonts/` | Static assets | — |

---

## 2. How a solve flows

```
page world (MAIN)                       isolated world (content script)                 extension
─────────────────                       ───────────────────────────────                 ─────────
page/net-interceptor.js
  patches fetch + XHR
        │ TRV_NET_CONFIG (filters)
        │◄────────────────────────────  core/net-bridge.js
        │
        │ TRV_NET_EVENT {phase,url,method,requestBody,response}
        ├──────────────────────────────► NetBridge.onEvent
        │                                       │
        │                                platforms/<site>.js
        │                                  onNetEvent() → captureSubmit/captureRun
        │                                  verdict        → submitVerdict/runVerdict
        │                                       │
        │                                core/platform-adapter.js
        │                                  tracker + SessionStore (chrome.storage.local)
        │                                       │
        │                                core/submission-pipeline.js
        │                                  hint prompt → backend push → GitHub push → reset
        │                                       │                          │
        │                                       │ chrome.runtime.sendMessage
        │                                       └─────────────────────────►│
        │                                                          background/background.js
        │                                                            BACKEND_API_FETCH proxy
        │                                                                     │
        │                                                            Traverse backend / GitHub
```

Two more entry points exist:
- **DOM fallback** — GFG, CodeChef and Naukri still read verdicts from the page
  (see `platforms/index.md`). They funnel into the same `capture*`/`*Verdict`
  methods, so the pipeline is identical either way.
- **Website auth sync** — `platforms/website-sync.js` and the background
  worker's `externally_connectable` handler both write the same auth keys.

---

## 2a. How a *new* platform gets discovered

LeetCode and TakeUforward have verified judge APIs. Every other DSA platform is
discovered rather than hand-written, by a separate capture path that never
touches the tracking stack above:

```
page world (MAIN)                        isolated world                extension        backend
─────────────────                        ──────────────                ─────────        ───────
net-interceptor.js  ── TRV_RECON_EVENT ──► core/recon-controller.js
  capture-all mode                          arms on problem pages
  (headers, bodies,                         labels run/submit flows
   timing, initiator)                       infers pass/fail verdicts
                                            scrapes button + editor selectors
                                                  │
                                            chrome.storage.local
                                              (recon_bundle, staged)
                                                  │ RECON_UPLOAD
                                                  └─────────────► background worker
                                                                    POST /api/recon/ingest
                                                                          │
                                                              recon-dumps/<platform>/*.json
                                                                      + digest email
```

The point is to automate the "record a HAR and work out the endpoints" step in
`platforms/index.md` §6. It runs on **18 mapped platforms** and is explicitly
off for LeetCode, TakeUforward, and Traverse's own surfaces. See
`core/index.md` for the invariants.

---

## 3. Invariants — do not break these

1. **`core/config.js` is the only place URLs and storage key names are defined.**
   No module may hardcode a backend URL, an origin, or a `chrome.storage` key
   string. (`core/auth.js` and `platforms/website-sync.js` carry literals only as
   a non-extension fallback, and they must match `config.keys`.)
2. **No build step.** Plain ES5-compatible JS loaded by `<script>` order in
   `manifest.json` and by `importScripts`. No modules, no bundler, no
   TypeScript. `globalThis.Traverse` (`T`) is the namespace; files attach to it.
3. **Script order in `manifest.json` is a dependency graph.** A file may only
   use `T.*` entries loaded before it. `core/platform-adapter.js` must come
   before any `platforms/*.js`.
4. **No DOM verdict scraping on LeetCode or TakeUforward.** Their verdicts come
   from the network only. Adding a selector-based fallback there is a regression.
5. **`page/*` files run in the page world** and cannot use `chrome.*` or load
   any other file here. They must stay dependency-free and duplicate the message
   type strings from `core/net-protocol.js`.
6. **Storage keys are a data contract with the backend and with existing user
   data.** Renaming one silently orphans every user's history.
7. **Recon never runs on LeetCode or TakeUforward.** Their network capture is
   verified; a capture-all recorder on top of it is noise, and a selector
   fallback there is a regression. The exclusion lives in
   `config.js` → `recon.excludedHosts`.
8. **Recon redacts credentials before they leave the page.** Anything added to
   `SENSITIVE_HEADERS` in `page/net-interceptor.js` is a privacy decision;
   captures are emailed and written to disk.
9. **UI freeze.** The sidepanel, timer overlay, toasts and hint prompt must stay
   pixel- and behaviour-identical. Refactors change the code behind them, never
   their appearance or copy. (The recon settings card is the single sanctioned
   addition; it extends the existing Settings tab rather than restyling it.)
10. **Background handlers must `return true`** when responding asynchronously.
11. **The service worker holds no problem state.** MV3 terminates it when idle;
    everything must be rehydrated from `chrome.storage`.
12. **Recon must work with zero user setup.** The ingest token is baked into
    `config.js` (`recon.defaultToken`) and nothing user-facing gates recording —
    the whole point is that someone who installs the extension, opens a problem
    page and submits contributes a capture without touching a setting.
    `tests/recon.test.js` pins this; a change that reintroduces a mandatory
    setup step breaks the feature, not just a test.
13. **Recon delivers partial captures.** Auto-upload fires once the page goes
    quiet, whatever was captured — it must never block on all four flows, because
    most platforms do not expose every path and a capture that never uploads is
    indistinguishable from one that was never taken. The pass/fail pair earns a
    longer wait (it is what lets the backend name the verdict field) but is never
    a precondition.

---

## 4. Backend contract

Base URL: `T.config.backendBaseURL` (currently the ngrok dev tunnel).

| Endpoint | Method | Notes |
|---|---|---|
| `/api/auth/login` | POST | `{ username, password }` → `{ token, user }` (token shape is loose; see `ExtensionAuth.pickToken`) |
| `/api/auth/verify` | GET | `Authorization: Bearer <token>` |
| `/api/submissions` | POST | The push target — see the payload below |
| `/api/recon/ingest` | POST | Raw capture sink. Headers `X-Recon-Token`, `X-Platform`, `X-Capture-Id`. **No body-size limit**; the backend streams it to disk and emails a digest. Responds `202` |
| `/api/recon/ping` | GET | Token check for the sidepanel's *Verify* button. `200` = token accepted |

Payload for `/api/submissions`, built by `core/backend-api.js`:

```
{
  problemSlug, platform, problemTitle, difficulty: 'easy'|'medium'|'hard',
  language, outcome: 'accepted'|'failed', idempotencyKey, happenedAt,
  deviceId, shouldAnalyzeWithAI, geminiApiKey, geminiModel,
  numberOfTries, timeTaken, category, topic, subtopic, assistanceLevel,
  attempts: [{ code, language, timestamp, type, successful, ... }]
}
```

- `idempotencyKey` is `<slug>-<solved.date>`; the backend deduplicates on it, so
  a retried push of the same solve is safe.
- `attempts[0]` carries full code; later attempts carry a compact line diff
  (`BackendAPI.diffSummary`) instead of the whole file.
- `category` is a 0–14 id from `CATEGORY_MAP` (first recognized topic wins).
- `assistanceLevel` is `'none' | 'hint' | 'solution' | null`, self-reported by
  the hint prompt. The revision scheduler discounts assisted solves.

## 5. Storage keys

| Key | Area | Written by | Notes |
|---|---|---|---|
| `problem_data_<problemKey>` | local | `core/session-store.js` | One record per problem: metadata, `solved`, tracking counters, timer fields |
| `auth_token`, `auth_user`, `auth_timestamp` | local | background, `core/auth.js` | Direct session. Token stored raw, `Bearer ` added on use |
| `auth_accounts`, `auth_active_account_id` | local | background, `core/auth.js` | Multi-account list + active id (`backend:<id\|username>`) |
| `github_token`, `github_owner`, `github_repo`, `github_branch` | sync | sidepanel | GitHub mirroring config |
| `github_push_enabled` | sync | sidepanel | Opt-in switch for GitHub mirroring |
| `gemini_api_key`, `ai_provider`, `gemini_model` | sync | sidepanel | Forwarded to the backend; analysis itself is server-side |
| `debug_mode` | sync | sidepanel | Single debug flag for every logger |
| `timer_overlay_enabled`, `timer_overlay_position` | sync / local | sidepanel, timer | Overlay visibility and last drag position |
| `hint_prompt_enabled`, `hint_prompt_default_option`, `hint_prompt_duration` | sync | sidepanel | Hint prompt behaviour |
| `browser_session_restarted`, `session_start_time` | local | background | Set on startup so stale timers are discarded |
| `tuf_code_data` | local | `platforms/takeuforward.js` | Cross-page cache of the last submitted TUF code |
| `recon_enabled` | sync | sidepanel | Recon on/off switch. Defaults to on |
| `recon_status` | local | `core/recon-controller.js` | Live arm state, captured flows, selector scrape — the sidepanel renders this |
| `recon_bundle` | local | `core/recon-controller.js` | The staged capture, read by the background worker on `RECON_UPLOAD` |
| `recon_flow_labels` | local | `core/recon-controller.js` | Which of the four flows (run/submit × pass/fail) have been seen |
| `recon_ingest_token` | local | *(nothing)* | Legacy override, no longer written — the token comes from `config.recon.defaultToken` |

## 6. Where to make common changes

| I want to… | Go to |
|---|---|
| Add support for a new site | `platforms/index.md` → "Adding a platform" |
| Change the backend URL or any storage key | `core/config.js` |
| Change what gets sent to the backend | `core/backend-api.js` (`formatProblemDataForBackend`) |
| Change the post-accept flow (prompt, push order) | `core/submission-pipeline.js` |
| Change attempt counting / the analysis flag | `core/attempt-tracker.js` |
| Change the `problem_data` record shape | `core/platform-adapter.js` (`storeProblemData`) |
| Add a network rule for a site | `platforms/<site>.js` (`netFilters` + `onNetEvent`) |
| Add a background message handler | `background/background.js` (`RUNTIME_HANDLERS`) |
| Change a toast / the timer / the hint prompt's look | `ui/`, `core/problem-timer.js` — but read invariant 9 first |
| Add a platform to recon coverage | `core/config.js` → `recon.platforms` **and** the recon `content_scripts` `matches` in `manifest.json` |
| Change what recon records, or how it judges a verdict | `core/recon-controller.js` — but read invariants 7 and 8 first |
| Change the emailed digest's shape | backend `src/lib/reconDigest.ts` |
