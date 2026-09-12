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
| `geeksforgeeks.js` | DOM (fallback) | none yet |
| `codechef.js` | DOM (fallback) | none yet |
| `naukri.js` | DOM (fallback) | none yet |
| `website-sync.js` | n/a | Receives the Traverse website's session and writes it into extension storage |

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
- **Do not add DOM verdict scraping to LeetCode or TakeUforward.** Their network
  capture is verified; a selector fallback there is a regression, not a safety
  net.
- For the three DOM-based platforms, keep `netFilters: []` until the endpoints
  are actually verified. A speculative filter that matches something unexpected
  floods the content script with noise.
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
3. **Capture** — record a HAR of Run and Submit (accepted *and* rejected), then
   add the URLs to `netFilters` and handle them in `onNetEvent`. Until then, use
   the DOM path (`watchButton` + `awaitSubmitVerdict`) and set
   `netFilters: []`.

   **You usually don't have to do this by hand.** The recon recorder
   (`core/recon-controller.js`) automates exactly this step: it arms on the new
   platform's problem pages, captures all four judge flows, infers the verdict
   field by diffing a pass against a fail, scrapes the button/editor selectors,
   and emails a digest with a draft of the `netFilters` + `onNetEvent` code
   below. Add the platform to `config.js` → `recon.platforms` and to the recon
   `matches` arrays in `manifest.json` first, then work from the digest.
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
| Move GFG / CodeChef / Naukri onto the network path | the procedure in `platforms/geeksforgeeks.js`'s header |
| The website's auth handshake | `platforms/website-sync.js` **and** the background worker's external handler |
| Behaviour shared by all platforms | `core/platform-adapter.js`, not a per-platform copy |
