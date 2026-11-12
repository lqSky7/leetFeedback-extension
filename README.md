<div align="center">

# Traverse

<div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 10px; margin: 20px 0;">
  <h3 style="margin: 0; font-weight: 300;">The Complete Learning Ecosystem</h3>
</div>

<p>
  <img src="https://img.shields.io/badge/Chrome-Extension-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Chrome Extension">
  <img src="https://img.shields.io/badge/Firefox-Extension-FF7139?style=flat-square&logo=firefoxbrowser&logoColor=white" alt="Firefox Extension">
  <img src="https://img.shields.io/badge/License-MIT-45B7D1?style=flat-square" alt="MIT License">
  <img src="https://img.shields.io/badge/Status-Beta-FF6B6B?style=flat-square" alt="Beta Status">
  <img src="https://img.shields.io/badge/Free-Forever-4ECDC4?style=flat-square" alt="Free Forever">
</p>

</div>

---

## Overview

Traverse is an open-source browser extension that automatically tracks coding practice sessions, Basically Turns DSA into a habit with Streaks, Leaderboards, Friends and Achievements; right on your existing coding platforms.

<table>
  <tr>
    <td style="background-color: #f8f9fa; padding: 15px; border-radius: 8px;">
      <strong style="color: #2d3748;">Automated Tracking</strong><br>
      <span style="color: #718096;">Monitor submissions across multiple platforms</span>
    </td>
    <td style="background-color: #f8f9fa; padding: 15px; border-radius: 8px;">
      <strong style="color: #2d3748;">AI Analysis</strong><br>
      <span style="color: #718096;">Pattern recognition and mistake identification</span>
    </td>
  </tr>
  <tr>
    <td style="background-color: #f8f9fa; padding: 15px; border-radius: 8px;">
      <strong style="color: #2d3748;">GitHub Integration</strong><br>
      <span style="color: #718096;">Automated commits with analysis reports</span>
    </td>
    <td style="background-color: #f8f9fa; padding: 15px; border-radius: 8px;">
      <strong style="color: #2d3748;">Performance Insights</strong><br>
      <span style="color: #718096;">Comprehensive progress analytics</span>
    </td>
  </tr>
</table>

## Installation

### Quick Start

1. Clone the repository
   ```bash
   git clone https://github.com/QuickHasaCat/Traverse.git
   ```

2. Load the extension

   **Firefox 140 or newer** — the repository root *is* the Firefox extension
   - Navigate to `about:debugging#/runtime/this-firefox`
   - Click "Load Temporary Add-on…"
   - Select `manifest.json` in the repository root
   - Click the toolbar icon to open the sidebar

   Temporary add-ons are removed when Firefox closes. To keep it installed,
   build an `.xpi` (see below) and install the signed package, or load it from a
   profile's `extensions/` directory.

   **Chrome / Edge / Brave** — build first, then load the build
   - Run `npm install && npm run build`
   - Navigate to `chrome://extensions/`, enable Developer mode
   - Click "Load unpacked" and select the generated `dist/` directory
   - Click the toolbar icon to open the side panel

   Chrome cannot load the repository root: `manifest.json` is the Firefox
   manifest, and Chrome needs different keys. `npm run build` derives the Chrome
   one into `dist/`. See below.

3. Configure settings through the extension panel

### Browser support

Both browsers run the same code, but they need different manifests — Chrome and
Firefox each reject some of the other's keys, and a browser that is handed a key
it does not know prints a warning in its extension page.

`manifest.json` is the **Firefox** manifest, because that is the filename a
browser loads when the folder is loaded unpacked and this fork ships for Firefox
first. It is also the single source of truth for everything the two share.
Chrome's half is an overlay, `manifest.chrome.overlay.json`, applied by the
build.

| | Chrome | Firefox |
|---|---|---|
| Manifest | derived from `manifest.json` + overlay | `manifest.json` |
| Background | `background.service_worker` (service worker) | `background.scripts` (event page) |
| Panel | `side_panel` + `chrome.sidePanel` | `sidebar_action` + `chrome.sidebarAction` |
| Minimum version | Chrome 121 | Firefox 140 |
| Website → extension auth | `externally_connectable` | `platforms/website-sync.js` content script |

The Firefox floor is **140**, for two reasons: the network interceptor is
injected into the page's own JS context with `"world": "MAIN"`, which Firefox
added in 128, and the mandatory `data_collection_permissions` declaration
arrived in 140 (it is the current ESR baseline). Desktop only — Firefox for
Android has no sidebar, so `gecko_android` is deliberately not declared.

```bash
npm run build            # Chrome  -> ~/Desktop/traverse-v<version>.zip
npm run build:firefox    # Firefox -> ~/Desktop/traverse-firefox-v<version>.zip
npm run lint:firefox     # validate the Firefox manifest and sources
npm test                 # the node test suite, including the manifest guard
```

`tests/manifest.test.js` pins the split: that the Firefox manifest carries no
Chrome-only key, that the overlay defines nothing but Chrome keys, that the
derived Chrome manifest is complete, and that the two agree on everything
shared. The permission lists differ by exactly `sidePanel` — the one thing the
overlay restates rather than inherits, and therefore the one thing that can
drift.

## Authentication Backend

Just login from settings after creating an account in the website.
If you want to push your solutions to GitHub you can setup the key there as well, We DO NOT collect this data! you can check the code.


## Architecture

The extension is plain JavaScript with **no build step** — load the folder
unpacked and edit files in place. Each tracked site is a thin adapter over a
shared framework, and verdicts are captured from the site's own network traffic
rather than by scraping the page.

| Directory | What lives there |
|---|---|
| `core/` | Config, logging, storage, attempt tracking, the submission pipeline, the adapter base class, API clients, the timer |
| `page/` | MAIN-world scripts injected into the tracked sites (network interceptor, editor bridge) |
| `platforms/` | One adapter per site, plus the website auth bridge |
| `ui/` | Injected UI: toasts and the hint prompt |
| `background/` | Background context: backend request proxy + auth storage owner (service worker on Chrome, event page on Firefox) |
| `sidepanel/` | The extension's own interface, rendered as a side panel (Chrome) or a sidebar (Firefox) |

Start with [`index.md`](index.md) — it is the architecture map, and every
directory has its own `index.md`. Migration history and the remaining phases are
in [`REFACTOR_PLAN.md`](REFACTOR_PLAN.md).

## Contributing

see CONTRIBUTING.md

## Support

<div align="center" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; margin: 30px 0;">

### Open Source Community

Traverse is developed by the community, for the community. All features remain free forever.

<p style="margin: 20px 0;">
  <strong>Contribute:</strong> <a href="https://github.com/QuickHasaCat/Traverse" style="color: #a8edea;">GitHub Repository</a><br>
  <strong>Issues:</strong> <a href="https://github.com/QuickHasaCat/Traverse/issues" style="color: #a8edea;">Bug Reports & Feature Requests</a><br>
  <strong>Contact:</strong> <a href="mailto:catince@outlook.com" style="color: #a8edea;">Development Team</a>
</p>

</div>

## License

MIT License - Free to use, modify, and distribute.

---

<div align="center" style="color: #718096; font-size: 14px;">
  <strong>Traverse</strong> - The Complete Learning Ecosystem
</div>

### Import existing LeetCode history

Open **Settings → LeetCode Import → Import history**. The extension
opens LeetCode's Progress page and uses that tab's signed-in session. If you are signed out,
complete LeetCode login in the opened tab; collection starts automatically.
Keep the tab open until the Settings status reports completion.

The collector pages through `userProgressQuestionList` (50 per page), then
`userProgressSubmissionList` for every problem (10 attempts per page), following
both reported totals. It checkpoints all data locally and collects problem
statements and submission code before the first upload. An interrupted capture
resumes locally when you click Retry; it never reports partial data as success.
Login/verification failures, inaccessible code or missing required problem
details stop the import. No unfinished records are uploaded.

The bulk endpoint requires a completed-capture marker and validates every record
in each batch before writing any of it. Incomplete batches return 422. Imported
solves carry `leetcode-import`; no AI analysis or revision scheduling runs, and
imports never enter the live solution pipeline or GitHub mirroring. Ordinary
submission routes retain their existing contract.

Import checks: `node tests/leetcode-import.test.js` and
`node tests/leetcode-import-background.test.js`.
