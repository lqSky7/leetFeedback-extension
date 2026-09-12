# Core Framework Directory (`core/`)

## 1. Purpose
Contains reusable core modules and base adapters that abstract attempt tracking, persistence caching, and platform abstraction for the Traverse extension.

## 2. Modules
| File | Responsibility |
|---|---|
| `session-store.js` | Unified `problem_data` storage manager and key derivation (`problem_data_<slug>`). |
| `attempt-tracker.js` | Tracks run/submit attempts, failure counts, and triggers AI analysis flags upon reaching threshold. |
| `platform-adapter.js` | Base adapter class defining URL parsing, metadata extraction contracts, and SPA navigation observers. |

## 3. Data Flow
- **In:** Content scripts and background pass attempt payloads, problem slugs, and metadata.
- **Out:** Writes formatted `problem_data` to `chrome.storage.local`; provides standardized tracking state.

## 4. Invariants & Gotchas
- `SessionStore` derives keys as `problem_data_${slug}`; never create divergent storage key schemes.
- `AttemptTracker` failure threshold is read directly from `Traverse.config.failedRunsBeforeAnalysis` (default: 2); do not hardcode per-platform numbers.

## 5. Where to Make Common Changes
- Modify how problems are keyed or cached: edit `core/session-store.js`.
- Alter attempt counting logic or thresholds: edit `core/attempt-tracker.js`.
- Add new base adapter lifecycle hooks: edit `core/platform-adapter.js`.
