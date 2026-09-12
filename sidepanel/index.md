# Sidepanel (`sidepanel/`)

## 1. Purpose
The sidepanel provides the primary interactive user interface for the extension, docked alongside problem pages. It allows users to authenticate, select active accounts, toggle timer overlays, configure GitHub repository sync, and view connection statuses.

## 2. Modules
| File | Responsibility |
|---|---|
| `sidepanel.html` | HTML markup and tab structure for Home (Account, Timer Options) and Settings (GitHub sync, Gemini AI, Debug logs, Updates). |
| `sidepanel.css` | Styles, dark theme tokens, layout geometry, responsive typography, and glowing button animations. |
| `sidepanel.js` | UI controller: renders tabs, handles auth forms, manages multiple user accounts, updates GitHub status, and syncs settings to storage. |

## 3. Data Flow
- **In:** Reads `debug_mode`, `auth_*`, `github_*`, `timer_overlay_*` from `chrome.storage.sync` and `chrome.storage.local`.
- **Out:** Writes user settings to `chrome.storage.sync`/`local`; sends messages to background for GitHub connection tests.

## 4. Invariants & Gotchas
- **UI Freeze:** Appearance, CSS variables, tab layout, and existing control flows must remain pixel- and behavior-identical.
- Uses `ExtensionAuth` (`utils/auth.js`) for authentication workflows.
- Logging must go through `spLog` / `spError` (connected to `Traverse.logger`).

## 5. Where to Make Common Changes
- Modify account presentation or auth UI: edit `PopupController.renderAuthSection` in `sidepanel/sidepanel.js`.
- Adjust theme tokens or styles: edit `sidepanel/sidepanel.css`.
