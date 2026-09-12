# `page/` — MAIN-world scripts

## 1. Purpose

Scripts that must run inside the tracked page's own JavaScript context, declared
in `manifest.json` with `"world": "MAIN"` at `document_start`. They exist because
the isolated content-script world cannot see or patch the page's `window.fetch`,
`XMLHttpRequest`, or `window.monaco`.

**These files cannot load any other file in this repo.** They are injected into
the page, not the extension, so there is no `chrome.*` and no `Traverse`
namespace. Everything they need arrives over `window.postMessage`.

## 2. Modules

| File | Responsibility |
|---|---|
| `net-interceptor.js` | Patches `window.fetch` and `XMLHttpRequest` once. Matches requests against filters supplied by the content script and posts every matching request + response back |
| `monaco-bridge.js` | Answers "what is in the editor right now?" for LeetCode, by reading `window.monaco` (DOM fallback for when Monaco isn't reachable) |

## 3. Data flow

**In (both files):** `window.postMessage` from the content script.

| Message | Sent by | Meaning |
|---|---|---|
| `TRV_NET_CONFIG` `{ filters, debug }` | `core/net-bridge.js` | Install/replace the URL filters |
| `{ source: 'LeetFeedback', type: 'LEETFEEDBACK_REQUEST_CODE', requestId }` | `platforms/leetcode.js` | Read the editor |

**Out:**

| Message | Consumed by | Meaning |
|---|---|---|
| `TRV_NET_ACK` `{ count }` | `core/net-bridge.js` | Filters applied; suppresses the retry |
| `TRV_NET_EVENT` `{ phase, url, method, requestBody, status, response }` | `core/net-bridge.js` → adapter | One matched request or response |
| `{ source: 'LeetFeedback', type: 'LEETFEEDBACK_CODE', requestId, code, language }` | `platforms/leetcode.js` | Editor contents |

A single request emits **two** events: one with `phase: 'request'` (carries
`requestBody`, which is where the submitted code lives) and one with
`phase: 'response'` (carries `status` and the parsed body, which is where the
verdict lives). Adapters switch on `phase`.

## 4. Invariants & gotchas

- **The message type strings are duplicated from `core/net-protocol.js`.**
  `page/*` cannot import them. Change them in both places or neither.
- Both files are installed at `document_start` and guard against double
  installation (`window.__traverseNetInterceptorInstalled`) — a page can end up
  running the script more than once.
- `net-interceptor.js` patches `fetch`/XHR **immediately, before any filters
  exist**, so requests made during page boot aren't structurally missed. Until
  the config message arrives `findRule` simply matches nothing.
- Capture must never break the page: response bodies are read from a `clone()`,
  and every parse is wrapped. Keep it that way — an exception here breaks the
  site's own editor.
- Bodies are only parsed when they are strings. `FormData`, `Blob` and
  `URLSearchParams` bodies are passed through as `undefined`.
- Non-JSON string bodies under 10 kB are forwarded raw; anything larger is
  dropped rather than shipped over `postMessage`.
- `monaco-bridge.js` is the only way to read editor code *before* a submission.
  The network capture only sees code the user actually submitted, so this is not
  redundant — don't delete it as a "DOM fallback".
- **The interceptor only logs on the request phase.** `[Traverse][net] fetch <method>
  <url>` means an outgoing request; the response-phase emit goes through
  `response.clone().text()` and arrives later (and with a different stack frame).
  When debugging a verdict that fires at the wrong time, use the request-phase
  log lines to reconstruct the real event ordering — that is how the LeetCode
  pending-poll bug was diagnosed (a check request was sent, its empty response
  arrived before the submit response, and the adapter had no guard).

## 5. Where to make common changes

| Change | File |
|---|---|
| Intercept `WebSocket` traffic too (planned for CodeChef) | `net-interceptor.js` — add a rule type, keep the patch additive |
| Change how request/response bodies are decoded | `net-interceptor.js` → `parseBody` |
| Support another editor (CodeMirror, ACE) in the page world | `monaco-bridge.js` |
| Add a message type | `core/net-protocol.js` **and** the matching constant in `net-interceptor.js` |
