# `background/` — service worker

## 1. Purpose

The MV3 background service worker (`background.js`). Deliberately thin: it is a
CORS proxy and the owner of auth storage, nothing more. It holds **no problem
state**, because Chrome terminates the worker whenever it goes idle.

## 2. Modules

| File | Responsibility |
|---|---|
| `background.js` | Lifecycle hooks, the `BACKEND_API_FETCH` proxy, external auth sync, auth reconciliation, side-panel behaviour |

It loads `core/config.js` and `core/logger.js` via `importScripts` — the only
two framework modules a worker needs. Do not add more without a reason; every
one costs startup time on each wake.

## 3. Data flow

**`chrome.runtime.onMessage`** (content scripts + sidepanel):

| Type | Payload | Response |
|---|---|---|
| `BACKEND_API_FETCH` | `{ url, options, timeoutMs? }` | `{ success, status, data }` or `{ success: false, error }` |

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
- `AUTH_SYNC` replaces the whole `auth_accounts` array with a single entry —
  matching the website's single-session model. Multi-account state is built by
  the sidepanel (`core/auth.js`), and the reconciliation block at the bottom of
  the file heals storage written by an older version.
- Removed in the refactor: the `getUserSolution` GFG DOM-extraction cascade,
  and the `testGitHubConnection` / `initializeConfig` / `CONTENT_SCRIPT_READY`
  handlers — none had a single call site.

## 5. Where to make common changes

| Change | File |
|---|---|
| A new cross-origin call a content script needs | add to `RUNTIME_HANDLERS` in `background.js` |
| A new external origin allowed to sync auth | `core/config.js` → `allowedExternalOrigins` **and** `manifest.json` → `externally_connectable` |
| Startup / install behaviour | `markSessionRestarted` in `background.js` |
| A storage key used by the worker | `core/config.js` only |
