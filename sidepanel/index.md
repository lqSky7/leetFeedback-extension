# `sidepanel/` — extension UI

## 1. Purpose

The extension's own interface, docked beside the problem page. Users sign in,
switch accounts, configure GitHub mirroring, AI provider, the timer overlay, the
hint prompt, debug logging and **platform recon** here.

**UI freeze applies (root `index.md`, invariant 9).** This directory was *not*
restructured in the refactor — only the script paths in `sidepanel.html` changed,
because the modules it loads moved from `shared/` and `utils/` into `core/`.
The recon settings card is the one sanctioned addition: it extends the existing
Settings tab instead of restyling anything.

## 2. Modules

| File | Responsibility |
|---|---|
| `sidepanel.html` | Markup + tab structure (Home: Account, Timer; Settings: GitHub, AI, Recon, Debug, Updates). Loads `../core/config.js`, `../core/logger.js`, `../core/auth.js`, then `sidepanel.js` |
| `sidepanel.css` | All styling and theme tokens |
| `sidepanel.js` | The controller: renders tabs, drives the auth forms, manages accounts, reads/writes settings, shows connection and session status, renders the recon card |

The `ExtensionAuth` class lives in `../core/auth.js` (exposed as
`window.extensionAuth`) because it is a self-contained auth client, not markup.

## 3. Data flow

**In:** `chrome.storage.sync` and `chrome.storage.local` — `auth_*`, `github_*`,
`gemini_api_key`, `ai_provider`, `gemini_model`, `debug_mode`,
`timer_overlay_*`, `hint_prompt_*`, and for recon `recon_enabled` plus
`recon_status` / `recon_flow_labels` (local, written by the content script).

**Out:**
- Settings written straight to `chrome.storage.sync`.
- Auth actions delegated to `window.extensionAuth`
  (`login`, `signOut`, `switchAccount`, `openSignIn`, `requestAuthStatus`,
  `onAuthStatusChange`, `getAccounts`).
- Login/logout persist through `core/auth.js` → `chrome.storage.local`; the
  background worker and the content scripts pick the change up from there.
- **One message to the background worker:** `RECON_UPLOAD` (the *Send now*
  button — forwards the staged recon bundle). Everything else is direct storage
  access.

The panel **never** reads `recon_bundle` itself. A capture can be several
megabytes; it is written by the content script and read by the background worker
at upload time.

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
- **The recon card is read-only apart from its on/off switch.** The ingest token
  is baked into `core/config.js` (`recon.defaultToken`) and is deliberately
  **not** exposed here — there is nothing for a user to configure, and a field
  they are told not to touch is worse than no field. Don't add one back.
- The recon status grid is a **read-only projection** of `recon_status`, which
  the content script writes. The panel must never write that key — doing so
  fights the controller and the last writer wins.
- Recon flow rows are built with DOM APIs (`createElement` / `textContent`), not
  `innerHTML`, because the labels derive from scraped page content.

## 5. Where to make common changes

| Change | File |
|---|---|
| Tab layout, copy, or control behaviour | `sidepanel.js` (`PopupController`) + `sidepanel.html` |
| Theme tokens or spacing | `sidepanel.css` |
| Sign-in / account switching | `../core/auth.js` |
| A new setting | `sidepanel.html` + `sidepanel.js` + a key in `core/config.js` |
| The recon card's fields, buttons or status grid | `sidepanel.html` + `sidepanel.js` (`initializeRecon`, `renderReconStatus`, `renderReconFlows`) |
| What recon records | `../core/recon-controller.js` — the panel only displays it |
