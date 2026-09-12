# `sidepanel/` — extension UI

## 1. Purpose

The extension's own interface, docked beside the problem page. Users sign in,
switch accounts, configure GitHub mirroring, AI provider, the timer overlay, the
hint prompt and debug logging here.

**UI freeze applies (root `index.md`, invariant 7).** This directory was *not*
restructured in the refactor — only the script paths in `sidepanel.html` changed,
because the modules it loads moved from `shared/` and `utils/` into `core/`.

## 2. Modules

| File | Responsibility |
|---|---|
| `sidepanel.html` | Markup + tab structure (Home: Account, Timer; Settings: GitHub, AI, Debug, Updates). Loads `../core/config.js`, `../core/logger.js`, `../core/auth.js`, then `sidepanel.js` |
| `sidepanel.css` | All styling and theme tokens |
| `sidepanel.js` | The controller: renders tabs, drives the auth forms, manages accounts, reads/writes settings, shows connection and session status |

The `ExtensionAuth` class lives in `../core/auth.js` (exposed as
`window.extensionAuth`) because it is a self-contained auth client, not markup.

## 3. Data flow

**In:** `chrome.storage.sync` and `chrome.storage.local` — `auth_*`, `github_*`,
`gemini_api_key`, `ai_provider`, `gemini_model`, `debug_mode`,
`timer_overlay_*`, `hint_prompt_*`.

**Out:**
- Settings written straight to `chrome.storage.sync`.
- Auth actions delegated to `window.extensionAuth`
  (`login`, `signOut`, `switchAccount`, `openSignIn`, `requestAuthStatus`,
  `onAuthStatusChange`, `getAccounts`).
- Login/logout persist through `core/auth.js` → `chrome.storage.local`; the
  background worker and the content scripts pick the change up from there.

The sidepanel does **not** message the background worker for anything today. It
reads and writes storage directly.

## 4. Invariants & gotchas

- **Script order in `sidepanel.html` matters.** `core/config.js` must load
  before `core/logger.js` and `core/auth.js`; `sidepanel.js` last.
- Logging goes through `_spLogger` / `spLog` / `spError`, which delegate to
  `Traverse.createLogger('Sidepanel')`. Don't reintroduce a separate debug flag —
  `debug_mode` is the single switch.
- `window.extensionAuth` is referenced with `typeof extensionAuth ===
  'undefined'` guards in several handlers. Keep those guards; the panel must
  still render if the auth module fails to load.
- Storage keys are read as literals here (`'github_token'`, `'auth_user'`, …).
  They must match `core/config.js` → `keys`. If you rename a key, grep this
  directory.
- GitHub push is opt-in: `github_push_enabled` defaults to `false`
  (`=== true` check on read).

## 5. Where to make common changes

| Change | File |
|---|---|
| Tab layout, copy, or control behaviour | `sidepanel.js` (`PopupController`) + `sidepanel.html` |
| Theme tokens or spacing | `sidepanel.css` |
| Sign-in / account switching | `../core/auth.js` |
| A new setting | `sidepanel.html` + `sidepanel.js` + a key in `core/config.js` |
