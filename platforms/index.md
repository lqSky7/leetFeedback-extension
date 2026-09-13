# `platforms/` — one adapter per tracked site

## 1. Purpose

Each file here is the *only* site-specific code for one tracked platform. An
adapter declares which URLs it cares about, how to read the problem's metadata
from the page, and — where the site's judge API has been verified — how to
interpret the network traffic captured by `page/net-interceptor.js`.

Everything else (attempt counting, persistence, the submission pipeline, the
timer, SPA navigation) comes from `core/platform-adapter.js`. An adapter should
be a few hundred lines of selectors and URL patterns, nothing more.

## 2. Modules

| File | Capture | Network filters |
|---|---|---|
| `leetcode.js` | network | `/submit/`, `/interpret_solution/`, `/detail/{id}/check/` |
| `takeuforward.js` | network | `judge/submit`, `judge/run`, `judge/check-submit`, `judge/check-run` |
| `geeksforgeeks.js` | network | `compile-sub-id`, `submission/compile-output`, `submit/compile`, `submission/submit/result` |
| `codechef.js` | network | `/api/ide/run/`, `/api/ide/submit`, `/api/user_source_code` |
| `naukri.js` | DOM (fallback) | none yet |
| `website-sync.js` | n/a | Receives the Traverse website's session and writes it into extension storage |

The four network adapters keep their DOM code as a **fallback only**: an attempt
is still recorded from a button click when no filter matched, and
`captureFromDom` stands itself down via `netCapturedRecently` when the network
already saw the request. The verdict itself is only taken from the DOM on
`naukri.js` (and on the other three when the filter missed the attempt
entirely).

## 3. Data flow

```
net event ──► onNetEvent(event)  ──► captureSubmit / captureRun
DOM click ──► captureFromDom()   ──┘
net event ──► onNetEvent(event)  ──► submitVerdict / runVerdict ──► pipeline
DOM poll  ──► awaitSubmitVerdict / awaitRunVerdict ─────────────┘
page      ──► extractProblemInfo() ──► storeProblemData()
```

`init()` is called once per page load by `T.startPlatform(AdapterClass)`. The
instance survives SPA navigation; `core/platform-adapter.js` watches the URL and
resets state when the problem changes.

## 4. The `PlatformAdapter` contract

Subclass it, declare `static platform = '<id>'`, and pass a config object to
`super()`:

```js
super({
  platform: 'example',
  defaultDifficulty: 0,        // fallback when the page shows no difficulty
  defaultTopics: ['General'],  // fallback when no topics are found
  defaultLanguage: 'cpp',
  extractDelay: 1500,          // ms to wait after navigation before extracting
  netFilters: [{ url: '/submit/$', methods: ['POST'] }],  // RegExp sources
});
```

Then implement:

| Method | Required | Purpose |
|---|---|---|
| `isProblemPage()` | yes | Is the current URL a solvable problem? |
| `getCurrentProblemKey()` | yes | Stable storage key. **Must be stable across reloads** — a slug, or the full URL for TUF |
| `extractProblemInfo()` | yes | `{ title, difficulty, url, language, code, topics, ... }` or `null` when the page isn't ready |
| `onNetEvent(event)` | only with `netFilters` | Interpret captured traffic |
| `init()` | optional | Extra setup, then `await super.init()` |
| `extractAndStore()` | optional | Override to retry extraction (see `takeuforward.js`) |

Inherited helpers you should use instead of reimplementing:

`captureSubmit(code, language)` · `captureRun(code, language)` ·
`captureFromDom(kind, code, language)` · `submitVerdict({accepted, status, stats})` ·
`runVerdict(success)` · `awaitSubmitVerdict(check, opts)` ·
`awaitRunVerdict(check, opts)` · `netCapturedRecently(kind)` ·
`watchButton(finder, onClick, attr)` · `pollUntil(check, opts)` ·
`storeProblemData(info, solved, tries)` · `saveTrackingState(key, overrides)` ·
`startTimer` / `resetTimer` / `hideTimer` · `observeUrlChanges(cb)`

## 5. Invariants & gotchas

- **Never touch `chrome.storage` directly.** Persist through
  `storeProblemData` / `saveTrackingState`; they own the record shape. (The one
  exception is TUF's `tuf_code_data` cache, which is a page-scoped cache, not a
  problem record.)
- **`netFilters[].url` is a RegExp source string, not a glob.** It is compiled
  once in `page/net-interceptor.js`. Anchor it — `/submit/$`, not `/submit/`,
  which would also match `/submissions/`.
- A request emits two events. Branch on `phase` before reading `requestBody`
  (request phase) or `response` (response phase).
- Judge endpoints are **polled by the site**, so the same rule fires many times
  and the early payloads carry no verdict at all. Filter them out or you will
  record a verdict for an unfinished submission — and, because a pending poll
  also consumes the pending id, the real verdict that arrives next is dropped.
  Each network platform guards this differently: TakeUforward matches a status
  string (`PENDING_STATUSES` in `takeuforward.js`), LeetCode waits for the
  judge to finish (`isFinalCheck` in `leetcode.js`).
- **Do not add DOM verdict scraping to LeetCode, TakeUforward, GeeksforGeeks or
  CodeChef.** Their network capture is verified; a selector fallback there is a
  regression, not a safety net.
- For `naukri.js` — the one remaining DOM-based platform — keep `netFilters: []`
  until the endpoints are actually verified. A speculative filter that matches
  something unexpected floods the content script with noise.
- **A payload that says "still judging" is not a verdict, and must not consume
  the pending attempt.** Each adapter decides this differently and the choice is
  load-bearing: LeetCode waits for `state === 'SUCCESS'` (`isFinalCheck`),
  TakeUforward filters `PENDING_STATUSES`, GeeksforGeeks requires `view_mode`
  (the `{"status":"QUEUED"}` polls carry none), CodeChef requires `result_code`.
  Getting this wrong records every solved problem as a failure *and* drops the
  real verdict that arrives on the next poll.
- **An accepted verdict must be applied once per attempt.** `submitVerdict`
  with `accepted: true` runs the whole storage pipeline, so an endpoint the site
  polls needs a settle guard — `currentSubmissionId` on LeetCode,
  `submissionSettled` on GeeksforGeeks and CodeChef.
- **Read the verdict from the field that carries it, not from the envelope.**
  GeeksforGeeks returns `results.testSolution.status === "SUCCESS"` even for a
  compile error, and CodeChef returns `status: "OK"` for a run that crashed.
  Both are the request envelope; the verdict is `view_mode` (GFG) and
  `signal`/`stderr`/`cmpinfo` (CodeChef).
- **Record the attempt from the network request, not the button.** Hashed class
  names rot silently: GFG's run control had moved to `button.ui.mini.button`
  (the adapter still looked for `problems_compile_button__*`) and CodeChef's is
  `#compile_btn` (the adapter looked for `#run_btn`), so run attempts stopped
  being recorded on both sites while every test still passed. The click path is
  kept only as a fallback.
- If a platform polls the endpoint that starts an attempt (CodeChef's
  `/api/ide/run/`), coalesce the burst — `recordRun()` increments the run
  counter on every call, so one run would otherwise be counted several times.
- `captureFromDom` returns `false` when the network already captured the
  attempt — only start polling for a verdict when it returns `true`.
- Verdict polling timeouts are reported as failures by default. Where a site
  legitimately never renders a verdict (Code360 runs), pass
  `recordTimeout: false` so the attempt stays unresolved instead of being
  recorded as wrong.

## 6. Adding a platform

1. **`manifest.json`** — add two `content_scripts` entries: one
   `page/net-interceptor.js` at `document_start` with `"world": "MAIN"`, and one
   loading the `core/` list followed by `platforms/<name>.js` at `document_end`.
   Copy an existing pair verbatim and change the last entry.
2. **`platforms/<name>.js`** — subclass `T.PlatformAdapter`, declare
   `static platform`, implement `isProblemPage`, `getCurrentProblemKey`,
   `extractProblemInfo`, and end with `T.startPlatform(<Name>Adapter)`.
3. **Capture** — record a real Run and Submit (accepted *and* rejected), then
   add the URLs to `netFilters` and handle them in `onNetEvent`. Until then, use
   the DOM path (`watchButton` + `awaitSubmitVerdict`) and set
   `netFilters: []`.

   **Read the recorded bodies, not just the URLs.** A bundle's `url` and its
   `responseBody` are written by the same `seq`, so if the `seq` counter is ever
   reset mid-session the two get cross-attributed and the capture *looks*
   complete while pairing one call's URL with another's body. Sanity-check a
   bundle before trusting it: a `GET` should not carry a request body, and a
   payload's shape should match what the endpoint is for.

   **You usually don't have to do this by hand.** The recon recorder
   (`core/recon-controller.js`) automates exactly this step: it arms on the new
   platform's problem pages, captures all four judge flows, infers the verdict
   field by diffing a pass against a fail, scrapes the button/editor selectors,
   and emails a digest with a draft of the `netFilters` + `onNetEvent` code
   below. Add the platform to `config.js` → `recon.platforms` and to the recon
   `matches` arrays in `manifest.json` first, then work from the digest.

   The digest's inferred verdict field is a starting point, not an answer — on
   GeeksforGeeks it picked `results.expectedOutput.status`, which is `SUCCESS`
   for the *reference* solution's side and therefore reported every run as a
   pass. The recorded bodies are the source of truth.
4. **`core/config.js`** — if the platform needs a DOM-verdict fallback switch,
   add it to `domVerdictFallback`.
5. **`manifest.json`** — add the site to `host_permissions`.
6. **Docs** — add the file to the table in this file and to
   `platforms/<name>.js`'s header comment.

## 7. Where to make common changes

| Change | File |
|---|---|
| A site's selectors broke | the matching `platforms/<name>.js` |
| A new judge endpoint appeared | `netFilters` + `onNetEvent` in that adapter |
| A recorded capture has request bodies that cannot belong to their URLs | `page/net-interceptor.js` — the `seq` counter must never be reset mid-session |
| Move Naukri onto the network path | the procedure in `platforms/geeksforgeeks.js`'s header, then the recon recorder |
| The website's auth handshake | `platforms/website-sync.js` **and** the background worker's external handler |
| Behaviour shared by all platforms | `core/platform-adapter.js`, not a per-platform copy |
