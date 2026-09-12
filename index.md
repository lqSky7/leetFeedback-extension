# Traverse Chrome Extension — Architecture & Directory Index

## 1. Overview
Traverse is a Manifest V3 Chrome Extension that tracks and analyzes DSA problem-solving sessions across 5 major coding platforms (LeetCode, TakeUforward, GeeksforGeeks, CodeChef, and Naukri Code360) and synchronizes them with the Traverse web platform and GitHub repositories.

Detailed refactoring roadmap and architectural decisions are maintained in [REFACTOR_PLAN.md](file:///Users/ca5/Projects/personal/leetFeedback-extension/REFACTOR_PLAN.md).

## 2. Directory Index
| Directory | Description | Documentation |
|---|---|---|
| `shared/` | Shared configuration, unified logger, and typed event definitions. | [`shared/index.md`](file:///Users/ca5/Projects/personal/leetFeedback-extension/shared/index.md) |
| `core/` | Core session store, attempt tracker, and platform adapter base classes. | [`core/index.md`](file:///Users/ca5/Projects/personal/leetFeedback-extension/core/index.md) |
| `content-scripts/` | Per-platform content scripts for LeetCode, GFG, TUF, CodeChef, Naukri, and website auth sync. | [`content-scripts/index.md`](file:///Users/ca5/Projects/personal/leetFeedback-extension/content-scripts/index.md) |
| `utils/` | Utility modules for timers, toasts, auth, hints, and API clients. | `utils/` |
| `sidepanel/` | Sidepanel HTML, CSS, and controller scripts. | `sidepanel/` |
| `icons/` & `fonts/` | Visual extension assets, UI icons, and bundled typography. | — |

## 3. High-Level Architecture
```
┌─────────────────────────── page world ───────────────────────────┐
│  utils/interceptor.js & utils/monaco-bridge.js                   │
│  Intercepts fetch / XHR payloads & editor models                 │
└──────────────┬───────────────────────────────────────────────────┘
               │ window.postMessage
┌──────────────▼────────────── content scripts ─────────────────────┐
│  content-scripts/<platform>.js                                   │
│  • PlatformAdapter / AttemptTracker / SessionStore               │
│  • ProblemTimer overlay                                          │
│  • Hint prompt & toast triggers                                  │
└──────────────┬───────────────────────────────────────────────────┘
               │ chrome.runtime.sendMessage
┌──────────────▼────────────── background service worker ──────────┐
│  background.js                                                   │
│  • Service worker message routing                                │
│  • CORS-free BACKEND_API_FETCH proxy                              │
│  • Website auth synchronization (externally_connectable)         │
└───────────────────────────────────────────────────────────────────┘
```

## 4. Key Invariants
- **UI & Data Freeze:** UI appearance and behavior (sidepanel, timer, toasts, hints) must remain strictly preserved.
- **Single Source of Truth:** All URLs and storage key names are defined in `shared/config.js`.
- **Zero DOM Verdict Scraping:** Solutions and verdicts are obtained through network interception; no `.view-lines` text-scraping or `localStorage` scanners.
