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
| `net-interceptor.js` | Patches `window.fetch` and `XMLHttpRequest` once. Serves two independent channels: the filter-driven **platform** channel, and the capture-all **recon** channel |
| `monaco-bridge.js` | Answers "what is in the editor right now?" for LeetCode, by reading `window.monaco` (DOM fallback for when Monaco isn't reachable) |

### The two channels

`net-interceptor.js` deliberately exposes two separate config/event pairs rather
than one flag, because a domain can need both at once — GeeksforGeeks has a
platform adapter *and* is a recon target, and a shared rule list would have them
clobbering each other.

| | Platform channel | Recon channel |
|---|---|---|
| Config / ack / event | `TRV_NET_CONFIG` / `TRV_NET_ACK` / `TRV_NET_EVENT` | `TRV_RECON_CONFIG` / `TRV_RECON_ACK` / `TRV_RECON_EVENT` |
| What it emits | Only requests matching the supplied filters | **Everything**, until its event budget runs out |
| Payload | `requestBody` / `response` (parsed) | Raw bodies, request **and** response headers, timing, and the JS initiator stack |
| Consumer | `core/net-bridge.js` → platform adapter | `core/recon-controller.js` |
| Used by | Sites with a verified judge API (LeetCode, TakeUforward) | Sites being reverse-engineered |

Recon is off unless a `TRV_RECON_CONFIG` with `enabled: true` arrives, so the
interceptor costs nothing on a site that never arms it.

## 3. Data flow

**In (both files):** `window.postMessage` from the content script.

| Message | Sent by | Meaning |
|---|---|---|
| `TRV_NET_CONFIG` `{ filters, debug }` | `core/net-bridge.js` | Install/replace the URL filters |
| `TRV_RECON_CONFIG` `{ enabled, maxBodyChars, maxEvents, excludeUrl, debug }` | `core/recon-controller.js` | Turn capture-all recording on or off |
| `{ source: 'LeetFeedback', type: 'LEETFEEDBACK_REQUEST_CODE', requestId }` | `platforms/leetcode.js` | Read the editor |

**Out:**

| Message | Consumed by | Meaning |
|---|---|---|
| `TRV_NET_ACK` `{ count }` | `core/net-bridge.js` | Filters applied; suppresses the retry |
| `TRV_NET_EVENT` `{ phase, url, method, requestBody, status, response }` | `core/net-bridge.js` → adapter | One matched request or response |
| `TRV_RECON_ACK` `{ enabled }` | `core/recon-controller.js` | Recon config applied |
| `TRV_RECON_EVENT` `{ seq, phase, ... }` | `core/recon-controller.js` | One recon capture event — see below |
| `{ source: 'LeetFeedback', type: 'LEETFEEDBACK_CODE', requestId, code, language }` | `platforms/leetcode.js` | Editor contents |

A single request emits **two** platform events: one with `phase: 'request'`
(carries `requestBody`, which is where the submitted code lives) and one with
`phase: 'response'` (carries `status` and the parsed body, which is where the
verdict lives). Adapters switch on `phase`.

Recon uses `seq` instead of pairing by URL: events sharing a `seq` belong to the
same request. Phases are `request`, `request-body` (an async `Request` body,
reported separately under the same `seq` so ordering doesn't matter),
`response`, and `overflow` (the event budget was hit and capture stopped).

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
- **Recon redacts credentials.** `authorization`, `cookie`, `set-cookie` and the
  other entries in `SENSITIVE_HEADERS` are replaced with `[redacted]` — presence
  is still reported, the value never leaves the page. Captures get emailed and
  written to disk, so anything added to that list matters. Do not "fix" a
  missing header value by removing an entry from it.
- **Recon must never capture its own upload.** `excludeUrl` carries the backend
  origin, so the `POST` that delivers a bundle is not recorded into the next
  bundle. Keep that exclusion when the backend URL changes.
- The recon event budget (`maxEvents`) is per session and resets on each
  `enabled: true` config, which is what lets a re-arm after an upload start
  capturing again.

## 5. Where to make common changes

| Change | File |
|---|---|
| Intercept `WebSocket` traffic too (planned for CodeChef) | `net-interceptor.js` — add a rule type, keep the patch additive |
| Change how request/response bodies are decoded | `net-interceptor.js` → `parseBody` |
| Support another editor (CodeMirror, ACE) in the page world | `monaco-bridge.js` |
| Add a message type | `core/net-protocol.js` **and** the matching constant in `net-interceptor.js` |
