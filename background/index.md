# Background Service Worker (`background/`)

## 1. Purpose
The background service worker (`background.js`) coordinates extension lifecycle events, handles cross-origin network requests (`BACKEND_API_FETCH`), manages side panel opening behavior, and synchronizes authentication from traverses.tech via `externally_connectable`.

## 2. Modules
| File | Responsibility |
|---|---|
| `background.js` | Service worker entry point; routes runtime messages, proxies API requests to bypass CORS, handles browser startup session resets, and processes external auth sync. |

## 3. Data Flow
- **In:**
  - `chrome.runtime.onMessage`: Receives `BACKEND_API_FETCH`, `testGitHubConnection`, `initializeConfig`, and `CONTENT_SCRIPT_READY` from content scripts and sidepanel.
  - `chrome.runtime.onMessageExternal`: Receives `AUTH_SYNC` and `AUTH_LOGOUT` from authorized external origins.
- **Out:**
  - Performs `fetch()` to backend API and GitHub API on behalf of content scripts.
  - Updates `chrome.storage.local` with auth tokens and session restart markers.

## 4. Invariants & Gotchas
- Must call `return true` from `chrome.runtime.onMessage` listeners when responding asynchronously via `sendResponse`.
- Service workers terminate when idle; do not store in-memory state that must survive across user interactions. All state must be rehydrated from `chrome.storage`.
- Injected DOM script execution (`extractGfGSolution`) has been permanently deleted in favor of network interception.

## 5. Where to Make Common Changes
- Add new runtime message handlers: add a branch to `chrome.runtime.onMessage.addListener` in `background.js`.
- Modify permitted external origins for auth sync: edit `Traverse.config.allowedExternalOrigins` in `shared/config.js`.
