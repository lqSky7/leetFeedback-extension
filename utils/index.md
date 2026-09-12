# Utilities Directory (`utils/`)

## 1. Purpose
Provides shared operational utilities for authentication, API communication (backend, GitHub, Gemini), submission toasts, active timer overlays, hint prompts, and page-world network interception.

## 2. Modules
| File | Responsibility |
|---|---|
| `auth.js` | `ExtensionAuth` manager: handles multi-account storage, login/logout flows, and token validation. |
| `backend-api.js` | `BackendAPI` client: prepares submission payloads with attempt diffs, assistance levels, and dispatches via background fetch. |
| `github-api.js` | `GitHubAPI` client: commits and pushes solution files to user repositories with formatted directory structures. |
| `gemini-api.js` | `GeminiAPI` client: manages API keys and model configuration for cognitive analysis. |
| `problem-timer.js` | `ProblemTimer`: floating in-page timer overlay, tracking active problem solving time and paused states across tab visibility. |
| `toast.js` | `LeetFeedbackToast`: in-page feedback toasts for submission progress (testing, syncing, AI analysis, success/failure). |
| `hint-prompt.js` | `LeetFeedbackHintPrompt`: post-solve modal asking self-reported assistance level ('none', 'hint', 'solution'). |
| `interceptor.js` | Page-world `fetch` & `XMLHttpRequest` patcher: intercepts submission requests and responses for LeetCode & TakeUforward. |
| `monaco-bridge.js` | Page-world bridge: reads Monaco editor model values directly without DOM scraping. |
| `common.js` | `DSAUtils`: platform detection, file naming, commit message generation, and stats increments. |

## 3. Data Flow
- **In:** Content scripts instantiate utility singletons; `interceptor.js` intercepts page network calls and posts events to `window`.
- **Out:** In-page UI overlays (toast, timer, hint modal); network dispatches to Traverse backend and GitHub API.

## 4. Invariants & Gotchas
- `interceptor.js` and `monaco-bridge.js` run in the **page execution world** (not the isolated content script world). They communicate strictly via `window.postMessage`.
- `backend-api.js` dispatches requests through `chrome.runtime.sendMessage({ type: 'BACKEND_API_FETCH' })` to bypass CORS limitations in content scripts.
- `problem-timer.js` automatically caps recorded elapsed time at 2 hours to avoid skewed analytics from forgotten tabs.

## 5. Where to Make Common Changes
- Change submission toast styles or duration: edit `utils/toast.js`.
- Adjust timer display formatting or positioning: edit `utils/problem-timer.js`.
- Update backend submission formatting or attempt diffing: edit `utils/backend-api.js`.
