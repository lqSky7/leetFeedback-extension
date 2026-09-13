# Traverse Extension — Refactoring Plan

**Goal:** Rebuild the extension on a modular architecture where every tracked platform uses declarative network interception (no DOM-scraped verdicts), shared logic lives in one place, and adding a new platform is a ~150-line config instead of a ~1,000-line copy-paste.

**Status:** Draft — pending review
**Scope:** All content scripts, background, shared utils, sidepanel, build tooling

---

## 0. Guiding Rules for the Rewrite (non-negotiable)

These rules apply to every phase. They are constraints, not suggestions.

### 0.1 Behavior parity — no functional changes

This is a **rewrite, not a redesign**. With exactly two exceptions (network interception replacing DOM verdicts, and deletion of garbage code per §0.3), the observable behavior of the extension must be identical before and after:

- **UI freeze:** the sidepanel, toasts, timer overlay, hint prompt, icons, and all user-facing text stay pixel- and behavior-identical. No "improvements" while porting.
- **Data freeze:** storage keys, backend payload shapes, GitHub commit message format, directory layout of pushed solutions, and metric definitions stay as-is (metric *definitions* are unified only where the audit showed platforms already disagree — and those unifications are listed explicitly in the plan, nothing implicit).
- **No new features, no removed features.** Anything that looks like a feature gap gets noted in the plan's Open Questions, not silently "fixed" in code.

### 0.2 Agent documentation — `index.md` at every directory level

The codebase will be worked on by AI agents in the future. Every directory in the new tree ships with an `index.md` written **for agents**, and it is treated as code: updated in the same commit as the files it describes, never allowed to drift.

- **Level:** root, `src/`, `src/core/`, `src/platforms/`, each `src/platforms/<name>/`, `background/`, `sidepanel/`, `tests/` — every directory that contains source files gets one.
- **Content contract (short and factual, no marketing):**
  1. **Purpose** — one paragraph: what lives here and why.
  2. **Modules** — table of files → one-line responsibility.
  3. **Data flow** — what enters this directory, what leaves it, via what interface.
  4. **Invariants & gotchas** — non-obvious rules an agent must not break (e.g. "background must `return true` for async sendResponse", "storage keys are owned by `session-store.ts` — never read/write them elsewhere").
  5. **Where to make common changes** — e.g. "adding a platform: read `src/platforms/index.md`".
- Root `index.md` doubles as the map: architecture overview, directory index, and pointer to `REFACTOR_PLAN.md` for history. Existing `copilot-instructions.md` is folded into this system and deleted at Phase 5 to avoid two sources of truth.
- **Rule of thumb:** if an agent reading only the `index.md` chain can't figure out where to make a change, the docs are wrong.

### 0.3 Code hygiene — delete, don't port

Ported code is rewritten, not copied. While porting, the following is **removed on sight**, and removals are listed in the phase's PR description (not silently dropped):

- **Garbage fallback code:** fallbacks that can never realistically succeed or that mask failures with wrong data. Concrete targets found in the audit:
  - `getStoredCode()` (leetcode.js) — scans `localStorage` for *any key containing the substring "code"* and returns it as solution code. Pure garbage; delete.
  - The 5-method `extractGfGSolution` cascade injected from `background.js` (ACE → CodeMirror → Monaco → textarea-heuristics → DOM line scraping) — superseded entirely by the GFG network interceptor; delete in Phase 4.
  - DOM `.view-lines` text-scraping fallbacks for editor code on platforms where the network capture already contains the exact submitted code.
  - Verdict-by-English-word-matching over broad containers (`'Success'`, `'Failed'`, `'correct'` anywhere in `[class*="result"]`) — replaced by network verdicts everywhere.
- **Dead code:** unused fields (`isInitialized` that nothing reads, `currentSolution`, unused `SELECTORS` constants, `sessionStartTime`/`lastActivityTime` activity tracking that ProblemTimer already superseded), unreachable branches, feature-flag remnants.
- **Outdated / misleading comments:** "Fixed background script", "UPDATED VERSION — pushing…", stale TODOs, comments that describe code that no longer exists. Comments in the new tree explain *why*, not *what*.
- **Over-complex code with a simpler equivalent:** e.g. `DSAUtils.getDebugMode()` (async wrapper around a synchronous cached value), per-platform debug storage keys, the 6 logging implementations → one. Simplification is allowed **only** when it provably preserves behavior; when in doubt, keep behavior and note it.
- **Deletion criteria (apply before removing anything not on the target list):** (a) no call sites, or (b) its failure mode produces wrong data rather than an honest error, or (c) superseded by the network interceptor. If none apply, it stays.

### 0.4 Definition of "modular and maintainable" (success criteria)

- Adding a platform touches only a new `src/platforms/<name>/` directory plus one registry line.
- No file over ~400 lines; no module reaches into another module's storage keys, selectors, or message types.
- Every piece of shared behavior exists exactly once.

---

## 1. Current State Audit

### 1.1 Scale

| Area | Lines | Notes |
|---|---|---|
| 5 platform content scripts | 4,861 | ~80% duplicated across platforms |
| utils/ (9 files) | 3,705 | problem-timer 818, toast 602, auth 595, backend-api 452… |
| background.js | 441 | incl. 130-line injected GFG extractor |
| sidepanel/sidepanel.js | 1,458 | single file, UI + logic mixed |
| **Total** | **~10,600** | No build system, no modules, no types, no lint |

Scripts are loaded via `<script>` tag order in `manifest.json` (7 files per platform) and communicate through globals (`window.DSAUtils`, `window.ProblemTimer`, `window.LeetFeedbackToast`…). There is no way to share code except copy-paste — which is exactly what happened.

### 1.2 Duplication inventory

The same logic exists in 5 near-identical copies (leetcode.js, geeksforgeeks.js, codechef.js, takeuforward.js, naukri.js), with subtle per-platform divergence that has already caused drift:

| Duplicated block | ~Lines × 5 | Drift observed |
|---|---|---|
| `loadPersistedState` / `savePersistedState` / `storeProblemData` | 100 × 5 | TUF keys storage by full URL, others by slug; GFG reads `topicTags`, others don't; TUF merges module globals (`TRIES`, `PUBLIC_CODE`) |
| `handleSuccessfulSubmission` (hint prompt → backend push → GitHub push → reset) | 150 × 5 | TUF calls `storeProblemData` twice; try-counting logic differs per platform |
| Attempt tracking (`handleRunAttempt`, `handleThreeIncorrectRuns`, `resetCounters`) | 80 × 5 | Threshold inconsistency: `>= 2` in most places, `>= 3` in others (GFG timeout path, TUF submit path) |
| `normalizeDifficulty` | 10 × 5 | Different defaults (LC→0, TUF→1) and mappings (GFG adds school/basic, Naukri adds moderate/ninja) — then backend-api.js immediately maps the number back to a string |
| SPA URL-change watching | 30 × 5 | MutationObserver on LC/GFG/CodeChef vs `setInterval(4000)` polling on TUF |
| Debug logging | 10 × 5+ | **Six** separate implementations: `bgLog/bgError/bgWarn` (background), `debugLog/debugError/debugWarn` + `DSAUtils.logDebug/logError` (common.js), `spLog/spError` (sidepanel), per-class `_log/_error/_warn` wrappers (backend-api, problem-timer), and the interceptor's own `log/error` reading *different* storage keys (`tuf_debug_mode`, `leetcode_debug_mode`) |

Estimated removable duplication: **~3,000–3,500 lines**.

### 1.3 Capture-strategy inconsistency (the core problem)

| Platform | Verdict capture | Fragility |
|---|---|---|
| LeetCode | Network (fetch/XHR patch → postMessage) | Good — port to new spec |
| TakeUforward | Network (XHR patch) | Good — port to new spec |
| GeeksforGeeks | **DOM scraping**: submit-button listener with hashed selector `.problems_submit_button__6QoNQ`, then polls result text for words like "Success"/"Correct" | Breaks on any redesign; word-matching over broad selectors risks false positives; 10s timeout *assumes failure* |
| CodeChef | **DOM scraping** — and `observeRunButton()` uses `button.problems_compile_button__Lfluz`, which is a **GeeksforGeeks hashed class copied into codechef.js**. Run tracking on CodeChef is almost certainly dead. | Same |
| Naukri Code360 | **DOM scraping** | Same |

All five platforms make submit/run/check API calls over the network. Verdicts, code, language, and stats are all present in those requests/responses — DOM scraping is strictly worse.

### 1.4 Bugs found during this audit (evidence of maintenance cost)

1. **leetcode.js defines `checkPageType()` twice** (lines ~431 and ~608). The second silently shadows the first.
2. **codechef.js line ~283 uses GFG's run-button selector** — copy-paste bug; CodeChef run attempts are never recorded.
3. **takeuforward.js `handleSuccessfulSubmission` calls `storeProblemData(problemInfo, true)` twice** (~lines 607 and 616).
4. **Failure thresholds are inconsistent** (`>= 2` vs `>= 3` for triggering the "flag for analysis" path), across *and within* files.
5. **backend-api.js hardcodes `baseURL = 'https://neatness-enlarged-curled.ngrok-free.dev'`** while `.github/copilot-instructions.md` documents `https://traverse-backend-api.azurewebsites.net`. Manifest host_permissions list ngrok + duckdns + vercel + traverses.tech. No single source of truth for backend URL.
6. `DSAUtils.getDebugMode()` is declared `async` but returns a cached synchronous value — pointless promise wrapping.
7. `web_accessible_resources` exposes `interceptor.js`/`monaco-bridge.js` to `<all_urls>` — broader than the 5 tracked hosts.
8. GFG `monitorSubmissionResult()` matches generic words ("Success", "Failed") anywhere inside broad result containers — false positives/negatives likely.
9. Interceptor reads per-platform debug keys from storage asynchronously — first events before load are never logged.
10. Metrics definitions differ per platform (TUF `TRIES` counts only submits; LC uses submit count with runCounter fallback) — backend receives non-comparable data.

### 1.5 Structural constraints

- **No build system** → no ES modules, no TypeScript, no shared code, no dead-code elimination, no bundling of the sidepanel.
- **State lives in content scripts** → SPA navigation, page reloads, and extension updates all require bespoke singleton + persistence hacks per platform.
- **Tests**: `tests/` contains ad-hoc scripts (`auth.test.js`, `diff-test.mjs`, `g4f-api-test.mjs`), no test runner, no CI. Content-script logic (the majority of the code) is untestable in its current shape.

---

## 2. Target Architecture

### 2.1 High level

```
┌─────────────────────────── page world ───────────────────────────┐
│  net-interceptor.ts (one generic fetch/XHR patch)                │
│  loaded with a declarative InterceptRule[] for the current host  │
└──────────────┬───────────────────────────────────────────────────┘
               │ typed window.postMessage envelope
┌──────────────▼────────────── content script (per tab, thin) ─────┐
│  platform adapter (per-site: ~150 lines of config + parsers)     │
│  • metadata extraction (title/difficulty/topics — selectors OK)  │
│  • ProblemTimer overlay (existing util, ported)                  │
└──────────────┬───────────────────────────────────────────────────┘
               │ chrome.runtime.sendMessage (typed events)
┌──────────────▼────────────── background service worker ──────────┐
│  SubmissionEngine (owns the state machine)                       │
│  • AttemptTracker      — attempts, counters, thresholds          │
│  • SessionStore        — single problem_data schema + merge      │
│  • SubmissionPipeline  — accepted → hint prompt → backend →      │
│                          optional GitHub push → reset            │
│  • ApiClient (backend) / GitHubClient — config-driven URLs       │
│  • Logger (tag-based, one debug flag, all contexts)              │
└───────────────────────────────────────────────────────────────────┘
```

Key decision: **state and the submission pipeline move into the background service worker.** Content scripts become thin: they inject the interceptor, translate page events, extract DOM metadata, and run the timer overlay. This eliminates the per-platform singleton/persistence hacks (the background survives SPA navigation; storage becomes a cache, not the source of truth).

### 2.2 Core modules (`src/core/`)

| Module | Responsibility | Replaces |
|---|---|---|
| `logger.ts` | Tag-based logger (`log('leetcode:net', …)`), single `debug_mode` storage key, context-aware (background/content/page-world) | 6 logging implementations |
| `events.ts` | Typed event envelope + validators for page-world↔content↔background messaging | ad-hoc `postMessage` shapes |
| `net-interceptor.ts` | Generic fetch + XHR patch, rule-driven (see §3) | `utils/interceptor.js` |
| `attempt-tracker.ts` | One implementation of attempts/runCounter/incorrectRunCounter/analysis flags, one threshold constant | 5 copies |
| `session-store.ts` | Single `problem_data` schema, one merge policy, one key derivation (`platform:slug`) | 5 copies of persistence code |
| `submission-pipeline.ts` | Accepted → assistance prompt → backend push → GitHub push (optional) → reset. Retry-safe: on backend failure nothing is reset | 5 copies of `handleSuccessfulSubmission` |
| `platform-adapter.ts` | Abstract base class: id, host matchers, `getProblemKey(url)`, `isProblemPage(url)`, `extractMetadata()`, `interceptRules`, hooks | 5 ad-hoc Extractor classes |
| `api-client.ts` / `github-client.ts` | Config-driven backend URL (env: dev/prod), auth header handling, typed payloads | backend-api.js, github-api.js |
| `problem-timer.ts` | Port of existing util (works, keep behavior) | problem-timer.js |

### 2.3 Platform modules (`src/platforms/<name>/`)

Each platform ships:
- `adapter.ts` — subclass/config of `PlatformAdapter` (~100–150 lines)
- `intercept-rules.ts` — declarative network rules (see §3)
- `metadata.ts` — selectors/GraphQL-derived metadata (scraping is allowed here; it's fallback-only and low-churn data)

**Adding a new platform = 2 small files + one registry entry.** Manifest content-script entries and host permissions are generated from the platform registry at build time.

### 2.4 Directory layout & documentation convention

The new tree (each `index.md` per §0.2 — created with the directory, updated in the same PR as any change to it):

```
/index.md                  ← architecture map + directory index (replaces copilot-instructions.md)
/src/index.md
/src/core/index.md         ← logger, events, net-interceptor, attempt-tracker,
│                            session-store, submission-pipeline, platform-adapter, api-clients
/src/platforms/index.md    ← "how to add a platform" guide + registry
/src/platforms/leetcode/index.md
/src/platforms/leetcode/adapter.ts, intercept-rules.ts, metadata.ts
/src/platforms/geeksforgeeks/…
/background/index.md       ← service worker: SubmissionEngine + message router + auth sync
/sidepanel/index.md
/tests/index.md            ← fixtures, runners, the manual smoke-test matrix
```

### 2.5 Build tooling

- **Vite + `@crxjs/vite-plugin`** (or **WXT** — see Open Questions) for MV3 builds, HMR during dev, manifest generation from the platform registry.
- **TypeScript** with `strict` mode; migrate incrementally (types can start loose, `noImplicitAny` enforced from day one).
- **ESLint + Prettier** (flat config) — catches shadowed methods like the duplicate `checkPageType`.
- **Vitest** for unit tests (§6).
- Output stays a plain `dist/` folder loadable unpacked — no runtime dependencies added.
- **Docs are part of the build:** each phase's PR includes the `index.md` updates for every directory it touches; a PR that changes code without its `index.md` is incomplete (CI checklist item).

---

## 3. Network Interception Design (all platforms)

### 3.1 Declarative rule spec

Replace the hardcoded if/else in `interceptor.js` with per-platform rule modules the generic patcher consumes:

```ts
interface InterceptRule {
  id: string;                                  // 'leetcode.submit'
  match: {
    url: string | RegExp;                      // URL pattern
    method?: string;                           // default any
    direction: 'request' | 'response' | 'both';
  };
  parse?: (body: unknown) => Partial<Attempt> | null;   // request body → code/lang/id
  result?: (body: unknown) => Verdict | null;           // response body → accepted/rejected + stats
  emits: 'code-submit' | 'code-run' | 'verdict' | 'verdict-poll';
}
```

The patcher (single implementation) hooks `fetch` and `XMLHttpRequest` once, runs every rule whose `match` hits, and posts typed events through `events.ts`. Rules are pure functions → unit-testable against recorded fixtures without a browser.

### 3.2 Per-platform plan

| Platform | Status | Work |
|---|---|---|
| LeetCode | Already network-based | Port existing patterns (`/submit/`, `/interpret_solution/`, `/detail/{id}/check/`, `status_code === 10`) into rules. Keep monaco-bridge for passive code capture. |
| TakeUforward | Already network-based | Port `judge/submit`, `judge/run`, `check-submit`, `check-run` rules. |
| GeeksforGeeks | **Discovery → new rules** | Record HAR of submit + result-poll flow on practice.geeksforgeeks.org. Implement submit rule (captures code/language/problem) + verdict-poll rule (captures status). Delete button-listener + text-matching code. |
| CodeChef | **Discovery → new rules** | Record HAR (CodeChef submits via its ide/judge API; GraphQL on some surfaces). Same treatment; also *deletes the broken GFG-selector code*. |
| Naukri Code360 | **Discovery → new rules** | Record HAR of run/submit on code360. Same treatment. |

Discovery methodology (per site, ~1–2 hrs each): load problem page → DevTools Network → perform Run and Submit (both accepted and rejected) → export HAR → identify the submit call, the result call, and their payload shapes → write rules + fixture files.

### 3.3 Safety net

Each platform keeps its old DOM-scraping path behind a feature flag for **one release** after its interceptor ships. A debug-log counter records which path produced each verdict. If the interceptor hasn't fired for a user within N submits, the fallback still works. After validation, the scraping code is deleted (target: **zero DOM verdicts**).

---

## 4. Migration Plan (strangler, 6 phases)

The extension remains shippable at the end of every phase. New code lives in `src/`; the legacy root scripts stay untouched until Phase 5.

### Phase 0 — Foundation (no behavior change)
- Branch `refactor/modular-v2`. Add Vite + CRXJS (or WXT), TypeScript, ESLint, Prettier, Vitest; CI runs typecheck + lint + tests **and enforces the "code change ⇒ matching index.md change" checklist**.
- Create `src/` skeleton (core modules as stubs) with its full `index.md` chain already in place, manifest generated from platform registry but initially importing legacy scripts unchanged.
- **Capture HARs** for GFG, CodeChef, Naukri (run/submit/verdict, accepted + rejected). Commit anonymized fixtures to `tests/fixtures/`.
- *Exit:* `npm run build` produces a working extension identical to today's; `index.md` chain exists for the new tree.

### Phase 1 — Core framework + LeetCode (reference port)
- Implement `logger`, `events`, `net-interceptor`, `attempt-tracker`, `session-store`, `submission-pipeline`, `adapter` base in `src/core/` with unit tests.
- Port LeetCode as the first adapter + rules; move its state machine into the background `SubmissionEngine`.
- Porting = rewriting under §0.3 rules: fix the duplicate `checkPageType`, drop `getStoredCode()` and the `.view-lines`/localStorage code fallbacks (network capture supplies the exact submitted code), remove dead fields, pull thresholds into one constant. All deletions itemized in the PR.
- *Exit:* LeetCode tracking fully works from the new pipeline (verified: submit accepted/rejected, run tracking, timer, backend push, GitHub push); legacy `leetcode.js` disabled; `src/core/index.md` + `src/platforms/leetcode/index.md` complete.

### Phase 2 — TakeUforward + GeeksforGeeks
- Port TUF (rules exist; straightforward) — its module-global state (`TRIES`, `PUBLIC_CODE`, …) folds into `session-store`.
- Implement GFG intercept rules from fixtures; port adapter (metadata from DOM stays for title/difficulty/topics); run behind fallback flag.
- Delete on sight while porting: the double `storeProblemData` call, the divergent failure thresholds (one constant in `attempt-tracker`).
- *Exit:* both platforms working via network capture on the new pipeline; GFG DOM-verdict code reduced to flagged fallback; `index.md` written for both platform dirs.

### Phase 3 — CodeChef + Naukri Code360
- Same pattern; the broken GFG-selector code in codechef.js is *not* ported at all (it never worked — §1.3).
- *Exit:* all 5 platforms on network capture; scraping fallbacks still flagged-on; `index.md` complete for all platform dirs.

### Phase 4 — Peripheral consolidation
- Background: remove `getUserSolution` GFG DOM extraction and the 5-method `extractGfGSolution` cascade (superseded by the interceptor), keep message router slim; consolidate auth sync (externally_connectable + website-sync.js into one module).
- Sidepanel: split `sidepanel.js` into modules consuming shared `api-client`; **UI identical** — only the code behind it changes, no visual or behavioral edits.
- Config: single `config.ts` (backend URL per env, debug key, storage key names) — kills the ngrok/Azure/duckdns hardcode split.
- Trim `web_accessible_resources` to the 5 tracked hosts.
- *Exit:* no references to legacy files anywhere; `background/index.md` + `sidepanel/index.md` written.

### Phase 5 — Cleanup + release
- Delete legacy root scripts and utils; fold `copilot-instructions.md` into the root `index.md` and delete it; update README; bump version.
- Final hygiene sweep: grep for dead exports, unused selectors, stale comments, and `TODO`/`FIXME` that no longer apply — found items are deleted or fixed, not re-noted.
- Ship as a beta channel release first; after one week of clean telemetry, remove DOM-verdict fallbacks entirely.
- *Exit:* repo is ~4–5k lines of TypeScript, one capture path, one pipeline, `index.md` chain accurate at every level.

### Parallel tracks (any phase)
- Bug-fix list from §1.4: items 1–4 get fixed during their platform's port; items 5–9 in Phase 4.
- Unify metric definitions (tries, time-taken, thresholds) in `attempt-tracker.ts` and document them in one place.

---

## 5. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Sites obfuscate/encrypt judge payloads | Low–Med | High | Rules parse only URL + JSON shape; keep DOM fallback flagged for one release; telemetry on interceptor hit-rate |
| HAR discovery reveals websocket-based verdicts (e.g. CodeChef) | Med | Med | Interceptor spec gains a `WebSocket` rule type (patch is additive) |
| Background SW state loss (MV3 idle termination) | High | Med | All state is persisted to `chrome.storage.session`/`local` on every transition; engine rehydrates on wake (already the pattern — formalize it) |
| Page-world injection blocked by site CSP | Low | High | Current `script.src` injection already works on all 5 sites; keep web_accessible_resources approach |
| Behavioral regressions during port | Med | Med | Feature-flagged fallbacks + per-phase manual test matrix (submit accept/reject, run pass/fail, timer, backend push, GitHub push) per platform |
| Team unfamiliarity with bundler setup | Low | Low | CRXJS/WXT are documented MV3-first; Phase 0 proves the pipeline before any port |

---

## 6. Testing Strategy

1. **Unit (Vitest)**: pure logic — `attempt-tracker` thresholds, `session-store` merge policy, rule `parse`/`result` functions against HAR fixtures, `submission-pipeline` state machine (mock clients), difficulty normalization table.
2. **Contract**: backend push payload shape snapshot per platform (guards against silent schema drift with the backend).
3. **Smoke (manual matrix per phase)**: the 5-flow checklist above, per platform.
4. **Optional E2E**: Playwright with the built extension against live sites — high maintenance; keep to a nightly canary (submit on a test account) rather than CI gate.

---

## 7. Expected Outcome

| Metric | Today | After |
|---|---|---|
| Lines of JS/TS | ~10,600 | ~4,500–5,000 |
| Code to add a platform | ~900–1,200 lines (copy-paste) | ~150–200 lines (adapter + rules) |
| Verdict capture paths | 2 (network + DOM scraping) | 1 (network) |
| Logging systems | 6 | 1 |
| Persistence implementations | 5 | 1 |
| Test coverage of core logic | 0 | unit + contract |
| Agent onboarding docs | 1 stale `copilot-instructions.md` | `index.md` chain at every directory |

## 8. Open Questions (decide before Phase 0)

1. **WXT vs Vite+CRXJS** — WXT gives more batteries (auto manifest, entry conventions); CRXJS is lighter and more transparent. Recommendation: WXT if the team is small, CRXJS if fine control over manifest generation is wanted.
2. **TypeScript strictness at start** — recommend `strict: true` with `any` allowed only in ported legacy code, eliminated by Phase 5.
3. **Backend URL environments** — confirm prod (Azure?) and staging URLs so `config.ts` + host_permissions are generated correctly, and the ngrok URL can be deleted.
4. **GitHub push in background vs content** — recommendation: background (token never needs to reach content-script context; already proxied via messaging).
5. **Keep `dsa_stats` in `chrome.storage.sync`?** — it competes with user settings for sync quota; consider folding into backend data.
