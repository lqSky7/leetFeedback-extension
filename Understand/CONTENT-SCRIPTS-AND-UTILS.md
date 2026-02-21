# Content scripts and shared utils

This document lists the three platform-specific content scripts, the shared utilities loaded for all of them, and how they relate. It also summarizes which script uses which util and which messages each part sends.

## Platform scripts

### leetcode.js

- **Host**: `https://*.leetcode.com/*`
- **Role**: LeetCode-specific DOM extraction, Run/Submit tracking, optional Gemini mistake analysis, backend and optional GitHub push. Uses the **Monaco bridge** to read the code editor (injected into page context).
- **Details**: See [LEETCODE.md](LEETCODE.md).

### geeksforgeeks.js

- **Host**: `https://*.geeksforgeeks.org/*`, `https://practice.geeksforgeeks.org/*`
- **Role**: Same pattern as LeetCode: extract problem (title, description, difficulty, topics), track run/submit attempts, persist per-problem state, optional Gemini analysis, backend and optional GitHub push. Uses **GFG-specific selectors** and editor extraction (ACE, CodeMirror, Monaco, or DOM/textarea). When it needs the current solution from the page, it can send message **`getUserSolution`** to the background; the background injects `extractGfGSolution` into the tab and returns the code.
- **No Monaco bridge**: Code is read in-content-script or via background-injected function, not via a separate page script like LeetCode.

### takeuforward.js

- **Host**: `https://*.takeuforward.org/*`
- **Role**: Same high-level pattern: extract problem (slug, description, difficulty), track attempts and run/submit, persist state, optional Gemini, backend and GitHub. Uses **TUF-specific selectors** and injects **interceptor.js** for request/response interception to capture submission results. Uses **ProblemTimer** for time tracking. No Monaco bridge; code is obtained via DOM or interceptor.

## Shared utils (load order)

All three content script entries in the manifest load the same six utils **before** the platform script, in this order:

| Order | File | Exports / global behavior |
|-------|------|---------------------------|
| 1 | **utils/common.js** | `DSA_PLATFORMS` (LEETCODE, GEEKSFORGEEKS, TAKEUFORWARD), `debugLog` / `debugError` / `debugWarn` / `isDebugMode`, `DSAUtils` (logDebug, logError, sleep, etc.), `LANGUAGE_EXTENSIONS` |
| 2 | **utils/github-api.js** | `GitHubAPI` class; `pushSolution(problemInfo, platform)` |
| 3 | **utils/gemini-api.js** | `GeminiAPI` class; `analyzeMistakes(attempts, problemInfo)` → `{ success, analysis, tags }` |
| 4 | **utils/backend-api.js** | `BackendAPI` class; reads auth from `chrome.storage.local`; `pushCurrentProblemData(problemUrl)` reads `problem_data_<problemUrl>` from local storage and pushes to Traverse backend |
| 5 | **utils/problem-timer.js** | `ProblemTimer` singleton (getInstance, startTimer, reset, getStartTime, getPausedTime); visibility-based pause; draggable overlay (optional) |
| 6 | **utils/toast.js** | `LeetFeedbackToast` (info, update, etc.) for in-page toasts |

## LeetCode-only util (injected, not in manifest content_scripts)

- **utils/monaco-bridge.js**: Loaded by **leetcode.js** via a `<script>` tag into the **page** context so it can access LeetCode’s Monaco editor. Communicates with the content script via `window.postMessage` (LEETFEEDBACK_REQUEST_CODE / LEETFEEDBACK_CODE / LEETFEEDBACK_BRIDGE_READY). Not loaded on GeeksforGeeks or TakeUForward.

## Which script uses which util

| Util | leetcode.js | geeksforgeeks.js | takeuforward.js |
|------|-------------|------------------|-----------------|
| common.js | Yes (DSAUtils, DSA_PLATFORMS, debug*) | Yes | Yes |
| github-api.js | Yes (pushSolution) | Yes | Yes |
| gemini-api.js | Yes (analyzeMistakes) | Yes | Yes |
| backend-api.js | Yes (pushCurrentProblemData) | Yes | Yes |
| problem-timer.js | Yes (startTimer, getStartTime, getPausedTime, reset) | Yes | Yes |
| toast.js | Yes (sync feedback) | Yes | Yes |
| monaco-bridge.js | Yes (injected by leetcode.js) | No | No |
| interceptor.js | No | No | Yes (injected for TUF) |

## Messages sent by scripts

| Sender | Message type | Receiver | When |
|--------|--------------|----------|------|
| Content (any) | `initializeConfig` | Background | Popup/sidepanel or content script may request config from storage |
| Content (any) | `CONTENT_SCRIPT_READY` | Background | Optional notification that content script is ready |
| Content (GFG) | `getUserSolution` | Background | Need current solution from page; background injects extractor |
| Content (any) | `testGitHubConnection` | Background | Verify GitHub token (e.g. from popup) |
| Content (any) | `BACKEND_API_FETCH` | Background | CORS bypass: background performs fetch, returns result |
| LeetCode content | `LEETFEEDBACK_REQUEST_CODE` | Page (bridge) | Request code/language from Monaco (postMessage) |
| Page (bridge) | `LEETFEEDBACK_BRIDGE_READY`, `LEETFEEDBACK_CODE` | LeetCode content | Bridge ready / code response (postMessage) |

Sidepanel/popup sends the same config/auth-related messages (e.g. `initializeConfig`, or uses storage directly); auth is handled via `extensionAuth` and local storage, not necessarily through the background for every action.
