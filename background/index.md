# `background/` — service worker

## 1. Purpose

The MV3 background service worker (`background.js`). Deliberately thin: it is a
CORS proxy and the owner of auth storage, nothing more. It holds **no problem
state**, because Chrome terminates the worker whenever it goes idle.

## 2. Modules

| File | Responsibility |
|---|---|
| `background.js` | Lifecycle hooks, the `BACKEND_API_FETCH` proxy, the `RECON_UPLOAD` / `RECON_PING` recon bridge, external auth sync, auth reconciliation, side-panel behaviour |

It loads `core/config.js` and `core/logger.js` via `importScripts` — the only
two framework modules a worker needs. Do not add more without a reason; every
one costs startup time on each wake.

## 3. Data flow

**`chrome.runtime.onMessage`** (content scripts + sidepanel):

| Type | Payload | Response |
|---|---|---|
| `BACKEND_API_FETCH` | `{ url, options, timeoutMs? }` | `{ success, status, data }` or `{ success: false, error }` |
| `RECON_UPLOAD` | `{ }` | `{ success, status, data }` or `{ success: false, error }` — reads the staged recon bundle and POSTs it to `/api/recon/ingest` |

The recon upload takes **no payload**. It re-reads the bundle from
`chrome.storage.local`, because a multi-megabyte capture cannot survive
`runtime.sendMessage` serialisation. It is the only message the sidepanel sends
today.

A `RECON_PING` handler existed to let the sidepanel verify the ingest token
before a long capture. It was removed with the token field: the token is now
baked into `config.js` and there is nothing for a user to get wrong, so nothing
called it. The backend keeps `GET /api/recon/ping` for manual `curl` checks
after a deploy or a rotation.

**`chrome.runtime.onMessageExternal`** (the Traverse website, origin-checked
against `config.allowedExternalOrigins`):

| Type | Payload | Effect |
|---|---|---|
| `AUTH_SYNC` | `{ token, user }` | Writes `auth_token`, `auth_user`, `auth_timestamp`, `auth_accounts`, `auth_active_account_id` |
| `AUTH_LOGOUT` | — | Removes all five auth keys |

**`chrome.storage`** — writes `browser_session_restarted` + `session_start_time`
on install/startup so `ProblemTimer` discards timers from a previous browser
session.

## 4. Invariants & gotchas

- **`return true` for every async `sendResponse`.** If the listener returns
  `false`/`undefined`, the message channel closes before the response is sent.
  The router returns `true` for every known handler; keep it that way.
- The `Authorization` header on `BACKEND_API_FETCH` is **rebuilt from
  `chrome.storage.local`**, never trusted from the caller — a tab holding a stale
  token must not push under the wrong account.
- `credentials: 'omit'` on that fetch stops ambient cookies from overriding the
  bearer token.
- `timeoutMs` is part of the handler contract but no current caller passes it;
  the `AbortController` path is dormant, not dead. Keep it working if you touch
  the function.
- Origin checks compare against `config.allowedExternalOrigins`, which must stay
  in sync with `externally_connectable.matches` in `manifest.json`.
- **`RECON_UPLOAD` must never accept the bundle in the message.** The recon
  controller stages it in `chrome.storage.local` (`config.recon.keys.bundle`)
  and sends an empty message. Inlining the bundle would hit the IPC message-size
  ceiling and silently truncate the capture.
- `RECON_UPLOAD` is the **only** place the `X-Recon-Token` header is attached,
  and it goes through `resolveReconToken()`. That helper returns
  `config.recon.defaultToken` and nothing else. It must **not** consult storage:
  a stored override used to take precedence, and once the sidepanel's token field
  was removed that left any value from an older build winning forever — every
  upload 401'd with no UI left to correct it. The legacy key is cleared on
  install, but the invariant is that the built-in token is the only source.
- Upload rejections are turned into prose by `describeUploadFailure()`. The
  sidepanel prints that string verbatim, so a bare error code is a dead end for
  whoever has to debug it — a 401 names the stale-build cause and the server
  variable to compare against.
- Recon upload failures are returned as `{ success: false, error }` rather than
  thrown, because the caller is a UI action and needs a message to render.
- `AUTH_SYNC` replaces the whole `auth_accounts` array with a single entry —
  matching the website's single-session model. Multi-account state is built by
  the sidepanel (`core/auth.js`), and the reconciliation block at the bottom of
  the file heals storage written by an older version.
- Removed in the refactor: the `getUserSolution` GFG DOM-extraction cascade,
  and the `testGitHubConnection` / `initializeConfig` / `CONTENT_SCRIPT_READY`
  handlers — none had a single call site.
- Removed with the recon token field: the `RECON_PING` handler. See §3.

## 5. Where to make common changes

| Change | File |
|---|---|
| A new cross-origin call a content script needs | add to `RUNTIME_HANDLERS` in `background.js` |
| A new external origin allowed to sync auth | `core/config.js` → `allowedExternalOrigins` **and** `manifest.json` → `externally_connectable` |
| Startup / install behaviour | `markSessionRestarted` in `background.js` |
| A storage key used by the worker | `core/config.js` only |
| The recon upload target, headers or timeout | the `RECON_UPLOAD` handler in `background.js` |
| Which token an upload authenticates with | `resolveReconToken()` in `background.js` — do not bypass it |
| Which hosts may run recon | `core/config.js` → `recon.excludedHosts` / `recon.platforms`, plus the recon `content_scripts` `matches` in `manifest.json` |
