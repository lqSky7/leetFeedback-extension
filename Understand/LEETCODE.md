# LeetCode content script deep dive

This document describes how the LeetCode integration works: entry point, the `LeetCodeExtractor` class, the Monaco bridge, persistence, observers, and the successful-submission pipeline. It ties **leetcode.js** to the shared utils and the rest of the extension.

## Purpose

The LeetCode content script:

- Extracts problem metadata (title, number, description, difficulty, topics) and current code/language from LeetCode problem pages.
- Tracks **Run** and **Submit** attempts (code snapshots, run/submit counters).
- After 2+ failed runs, flags the problem for **Gemini** mistake analysis on the next successful submit.
- On **Accepted** submission: optionally runs Gemini analysis, stores problem data (including timer and AI fields), pushes to the Traverse backend, and optionally pushes the solution to GitHub.
- Uses a **unified problem timer** (ProblemTimer) for time spent on the problem (with visibility-based pause).

## Entry point

- **File**: `content-scripts/leetcode.js`
- **Wrapped in an IIFE**; uses `DSA_PLATFORMS.LEETCODE` from `utils/common.js`.
- **Initialization**: When the DOM is ready (`DOMContentLoaded` or immediate if already loaded), it calls `initializeLeetCode()`.
- **Dependency check**: `initializeLeetCode()` waits until `DSAUtils`, `GitHubAPI`, and `BackendAPI` are defined (retries every 500 ms if not). Then it creates or reuses a **singleton** `LeetCodeExtractor` and calls `extractorInstance.initialize()`.

So the script depends on the manifest’s script order: `common.js`, `github-api.js`, `gemini-api.js`, `backend-api.js`, `problem-timer.js`, `toast.js` must load before `leetcode.js`.

## LeetCodeExtractor class

### State

- **Problem/solution**: `currentProblem`, `currentSolution`; `currentProblemUrl` (slug from URL) to detect problem changes.
- **Attempts and counters**: `attempts[]`, `runCounter`, `incorrectRunCounter`, `submitCounter`; `hasAnalyzedMistakes`, `shouldAnalyzeWithGemini`; `currentSubmissionAttempt`.
- **Submission**: `submissionInProgress`, `submitCounter`.
- **AI**: `aiAnalysis`, `aiTags` (from Gemini).
- **Bridge**: `bridgeReady`, `pendingCodeRequests` (Map of requestId → resolver).
- **Timer**: Timer state lives in **ProblemTimer** (singleton); the extractor only reads `problemStartTime` and `pausedTime` when saving problem data.

### Monaco bridge

LeetCode’s editor runs in the **page** context; the content script runs in an isolated world. To get the current code and language reliably, the content script injects `utils/monaco-bridge.js` (from `chrome.runtime.getURL('utils/monaco-bridge.js')`) into the page.

- **Injection**: `injectMonacoBridge()` adds a `<script>` tag with the bridge URL; the bridge runs in the page and has access to `window.monaco`.
- **Listeners**: The content script listens for:
  - `LEETFEEDBACK_BRIDGE_READY`: sets `bridgeReady = true`.
  - `LEETFEEDBACK_CODE`: for a given `requestId`, resolves the matching promise in `pendingCodeRequests` with `{ code, language }`.
- **Request**: `getCodeViaBridge(timeoutMs)` creates a unique `requestId`, posts `LEETFEEDBACK_REQUEST_CODE` to the page, and races the resolver promise against a timeout. On timeout or missing response, returns `{ code: '', language: 'text' }`.
- **Fallbacks**: If the bridge returns no usable code, `getCurrentCode()` falls back to global `window.monaco.editor`, then DOM selectors (e.g. `.view-lines`, `.monaco-editor`, `.ace_content`), then `getStoredCode()` (localStorage keys containing `"code"`).

### Persistence

All per-problem state is keyed by **current problem URL slug** (e.g. `two-sum`). Storage key: `problem_data_<slug>` in `chrome.storage.local`.

- **loadPersistedState()**: On init, reads `problem_data_<currentUrl>` and restores attempts, run/submit counters, `hasAnalyzedMistakes`, `shouldAnalyzeWithGemini`, `aiAnalysis`, `aiTags`, `currentProblemUrl`, `parent_topic`. Timer fields are managed by ProblemTimer.
- **savePersistedState(overrides)**: Merges current extractor state (and optional overrides) with existing problem data, gets `problemStartTime` and `pausedTime` from ProblemTimer, writes back to `problem_data_<currentUrl>`.
- **storeProblemData(problemInfo, solved, tries)**: Builds a full problem payload (name, platform, difficulty, solved, parent_topic, problem_link, attempts, counters, AI fields, timer fields from ProblemTimer, timestamp) and sets `problem_data_<currentUrl>`. Used when first visiting a problem (unsolved) and on successful submit (solved).

When the user navigates to a **different** problem (different slug), the extractor resets counters and clears that problem’s stored data, then starts fresh for the new URL.

### Observers and event flow

1. **URL changes**  
   A `MutationObserver` on `document` watches for `location.href` changes (LeetCode is an SPA). On change, it calls `checkPageType()` and `extractProblemInfo()` after a short delay (e.g. 1000 ms).

2. **Submit button**  
   A MutationObserver and direct search attach a click listener to `button[data-e2e-locator="console-submit-button"]`. On click: `handleSubmissionAttempt()` (guards with `submissionInProgress`), gets code/language, pushes a submit attempt, saves state, then `monitorSubmissionResult(attempt)` polls the DOM for `[data-e2e-locator="submission-result"]` (e.g. “Accepted”, “Wrong answer”, …). On Accepted, `handleSuccessfulSubmission(attempt)` is called; on failure or timeout, submission is marked failed and state is saved.

3. **Run button**  
   Similar: find `button[data-e2e-locator="console-run-button"]`, attach click listener. On click: `handleRunAttempt()` gets code/language, increments run counter, pushes run attempt, saves, then `observeRunResult(attempt)` checks DOM (and uses a MutationObserver + periodic check) for success/failure. On 2+ failed runs, `handleThreeIncorrectRuns()` sets `hasAnalyzedMistakes = true` and `shouldAnalyzeWithGemini = true` and saves.

4. **Problem extraction**  
   `extractProblemInfo()` uses DOM selectors to get title (e.g. `.text-title-large`, `[data-cy="question-title"]`), number, description, difficulty, and topics (`div.mt-2.flex.flex-wrap.gap-1.pl-7 a`). It combines with current code/language and topics from the instance, then calls `storeProblemData(problemInfo, false, 0)` for first visit.

### Success path (handleSuccessfulSubmission)

1. Wait ~2 s for performance stats to appear; call `extractPerformanceStats()` (runtime, memory, beats selectors).
2. Call `extractProblemInfo()` again for up-to-date problem info; attach `stats`.
3. If `shouldAnalyzeWithGemini`: create `GeminiAPI`, call `analyzeMistakes(allAttempts, problemInfo)`; set `aiAnalysis` and `aiTags` on the extractor (and they are included when saving problem data).
4. Compute `totalTries` (e.g. from submit count or run count); call `storeProblemData(problemInfo, true, totalTries)` so `problem_data_<url>` has solved state, attempts, AI data, and timer fields.
5. Show toast “Analyzing solution...” (no auto-dismiss).
6. Call `backendAPI.pushCurrentProblemData(currentUrl)`. Backend reads `problem_data_<currentUrl>` from storage. On success/error, update toast via `LeetFeedbackToast.update(...)`.
7. If `github_push_enabled` (from sync storage) is not false: call `githubAPI.pushSolution(problemInfo, PLATFORM)`. On success (or if GitHub push is disabled), reset run/submit counters, clear attempts, `aiAnalysis`, `aiTags`, `shouldAnalyzeWithGemini`, etc., and save state.

So the “workflow” is: **Accepted → (optional Gemini) → storeProblemData → backend push → (optional) GitHub push → reset and save.**

## Dependencies

- **utils/common.js**: `DSA_PLATFORMS`, `DSAUtils.logDebug` / `DSAUtils.logError` / `DSAUtils.sleep`, `debugLog` / `debugError` / `debugWarn`.
- **utils/github-api.js**: `GitHubAPI`, `pushSolution(problemInfo, platform)`.
- **utils/gemini-api.js**: `GeminiAPI`, `analyzeMistakes(attempts, problemInfo)`.
- **utils/backend-api.js**: `BackendAPI`, `pushCurrentProblemData(problemUrl)` (reads from storage).
- **utils/problem-timer.js**: `ProblemTimer.getInstance()`, `startTimer(problemUrl)`, `reset()`, `getStartTime()`, `getPausedTime()`.
- **utils/toast.js**: `LeetFeedbackToast.info()`, `LeetFeedbackToast.update()`.
- **utils/monaco-bridge.js**: Injected into page; communicates via `postMessage` with the content script (same window, different JavaScript context).
