# Content Scripts Directory (`content-scripts/`)

## 1. Purpose
Contains platform-specific content scripts executed in isolated worlds across the 5 tracked coding platforms and the companion website.

## 2. Modules
| File | Responsibility |
|---|---|
| `leetcode.js` | LeetCode extraction, Monaco bridge integration, network event handling, problem timers, submissions. |
| `geeksforgeeks.js` | GeeksforGeeks submission tracking, attempts, timers, and problem metadata extraction. |
| `takeuforward.js` | TakeUforward (TUF+) problem tracking, timers, and submission capture. |
| `codechef.js` | CodeChef problem extraction, run/submit detection, and timers. |
| `naukri.js` | Naukri Code360 tracking, timers, and submission extraction. |
| `website-sync.js` | Syncs authentication credentials from traverses.tech directly to extension storage. |

## 3. Data Flow
- **In:** Page events via `window.postMessage` from injected `interceptor.js` or `monaco-bridge.js`; DOM element queries for titles/difficulty.
- **Out:** Writes problem session data to `chrome.storage.local`; sends `BACKEND_API_FETCH` requests via `chrome.runtime.sendMessage` to background service worker; coordinates hints and GitHub push.

## 4. Invariants & Gotchas
- UI behavior, toasts, and timer overlay must remain strictly preserved (UI freeze).
- Solutions are captured via network interception; do not re-introduce `.view-lines` DOM scraping or `localStorage` scanners.
- SPA URL navigation must trigger page type checks and timer resets properly.

## 5. Where to Make Common Changes
- Fix or update LeetCode extraction: edit `content-scripts/leetcode.js`.
- Add or modify platform-specific DOM selectors: edit the corresponding platform script.
