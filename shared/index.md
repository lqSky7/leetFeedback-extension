# Shared Directory (`shared/`)

## 1. Purpose
Contains environment-agnostic, dependency-free foundational modules loaded in every execution context (background service worker via `importScripts`, content scripts via `manifest.json`, sidepanel via `<script>`).

## 2. Modules
| File | Responsibility |
|---|---|
| `config.js` | Single source of truth for backend URLs, storage keys, failure thresholds, and feature flags. |
| `logger.js` | Unified tag-based logger with cached `debug_mode` state replacing disparate log implementations. |
| `events.js` | Standardized event string constants and messaging types across window and runtime boundaries. |

## 3. Data Flow
- **In:** Reads `debug_mode` from `chrome.storage.sync` / `chrome.storage.local`.
- **Out:** Exposes `globalThis.Traverse.config`, `globalThis.Traverse.logger`, and `globalThis.Traverse.events` to all contexts.

## 4. Invariants & Gotchas
- Must remain strictly dependency-free (no DOM manipulation, no async initialization required at import time).
- Must safely check for existence of `chrome` and `window` to run in both page-world and service worker environments.
- Do not rename storage keys in `config.js` without an explicit migration plan.

## 5. Where to Make Common Changes
- Change backend or website URLs: update `Traverse.config.backendBaseURL` / `Traverse.config.websiteBaseURL` in `config.js`.
- Add new storage keys or modify failure threshold: edit `Traverse.config.keys` or `Traverse.config.failedRunsBeforeAnalysis` in `config.js`.
