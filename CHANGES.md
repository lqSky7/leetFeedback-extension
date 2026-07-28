# Changes in 1.8.0 (since 1.7.3)

## What's New & Improvements
- **Sidepanel Redesign & UI Enhancements**: Re-architected sidepanel layout, styles, and HTML for improved visual hierarchy, responsiveness, and state handling.
- **Timer Overlay Improvements**: Refined problem timer overlay UI with a sleek pill design, integrated section dividers, pause/resume, and reset timer options.
- **Submission State Management**: Fixed edge cases in clearing submission state across content scripts and background handlers.
- **Backend API & Data Sync**: Enhanced backend sync capabilities for problem sessions and feedback handling.
- **Version Bump**: Extension version updated to 1.8.0.

---

# Changes in 1.7.3 (since 1.7)

## What it means for users
- **Massive Token & Network Savings**: When you make multiple attempts to solve a problem, only the differences/changes (diffs) from your previous attempt are sent to the AI for analysis. The first attempt is sent in full to establish the baseline code, but subsequent submissions only transmit what you actually changed. This dramatically reduces token consumption and API cost.
- **Precision AI Analysis**: The AI is instructed to interpret the additions and deletions in the code, ensuring that the final mistake analysis remains highly contextual and accurate while using a fraction of the data.
- **Version Bump**: Extension version updated to 1.7.3.

---

# Changes — CodeChef Integration Fix (1.7.0)

### Critical: CodeChef Script Syntax Error
- Fixed a `SyntaxError` in `getProblemTitle()` where the `selectors` array was empty and missing its closing bracket, preventing the entire `codechef.js` script from loading.

### Critical: Title Extraction Failing
- `getProblemTitle()` was filtering out all CodeChef page titles because `document.title` contains "CodeChef" (e.g. "Water Consumption Practice Coding Problem | CodeChef").
- Fixed to properly strip the " | CodeChef" and "Practice Coding Problem" suffixes instead of rejecting the title entirely.
- Added URL path fallback (`/problems/WATERCONS` → "WATERCONS") as a last resort.

### Inline Problem Info Fallback
- Added an inline fallback in `handleSuccessfulSubmission()` that constructs `this.currentProblem` directly from `document.title` and page data when `extractProblemInfo()` fails, ensuring the GitHub push always has data to work with.

### Partially Correct Answer Sync
- Fixed a bug where "Partially Correct Answer" was being synced to GitHub because it contains the word "correct", matching the success condition.
- Failure conditions (including `partially correct`, `partial`) are now checked before success conditions.

### `analysisResult` Crash
- Fixed `Cannot read properties of undefined (reading 'analysis')` in `github-api.js` by using optional chaining (`analysisResult?.analysis`).

### `submissionInProgress` Deadlock
- Added `try...catch` in `handleSubmissionAttempt()` to ensure `submissionInProgress` is always reset to `false`, preventing subsequent submissions from being silently blocked.

### Undefined `debugError`
- `debugError` was referenced in error paths but never defined, causing silent crashes in error handlers.

## New Features

### CodeChef Difficulty Tier Mapping
- CodeChef numeric difficulty ratings are now mapped to named tiers for the GitHub folder structure:

| Rating     | Tier       | Description                          |
|------------|------------|--------------------------------------|
| 0 – 500    | Basic      | Syntax, I/O, simple logic            |
| 500 – 1000 | Easy       | Arrays, loops, basic math            |
| 1000 – 1400| Medium     | Standard Division 4 problems         |
| 1400 – 2000| Hard       | Competitive programming              |
| 2000+      | Advanced   | Expert-level CP                      |

- Folder structure now matches LeetCode: `codechef/{tier}/{problem-name}/solution.md`

### Improved Difficulty Extraction
- `getDifficulty()` now uses multiple DOM selectors and a full-page text fallback to reliably find the `Difficulty: NNN` rating on both Statement and IDE tabs.

## Code Cleanup

### Removed Dead Code
- **`SELECTORS`** constant — defined but never used anywhere.
- **`GFG_LANGUAGES`** constant — copy-pasted from GeeksforGeeks, never referenced.
- **`debugLog` function** — redundant wrapper around `DSAUtils.logDebug`.
- **`debugError`** — referenced but never defined (replaced with `DSAUtils.logError`).

### Standardized Logging
- All `console.log` / `console.error` calls replaced with `DSAUtils.logDebug(PLATFORM, ...)` / `DSAUtils.logError(PLATFORM, ...)`.
- All `debugLog()` / `debugError()` calls replaced with direct `DSAUtils` calls.

### Removed Documentation
- Deleted `Understand/` directory (5 markdown files not meant for commit).

## Files Modified
- `content-scripts/codechef.js` — All fixes and cleanup above
- `utils/github-api.js` — `analysisResult?.analysis` fix
