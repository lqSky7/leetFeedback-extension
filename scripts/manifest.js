// Traverse — per-browser manifest derivation.
//
// `manifest.json` is the **Firefox** manifest, and it is the single source of
// truth for everything the two browsers share: name, version, icons, host
// permissions, content scripts and the toolbar action. A browser loads that
// filename when the folder is loaded unpacked, so the Firefox one holds it —
// this fork ships for Firefox first, and a manifest Firefox warns about is a
// warning the user sees in about:debugging.
//
// Chrome cannot use it unchanged, and Firefox cannot tolerate Chrome's keys:
//
//   key                          Chrome              Firefox
//   background.service_worker    runs it             warns; runs background.scripts
//   background.scripts           ignores (Chrome 121+) runs it
//   permissions "sidePanel"      required            unknown permission
//   side_panel                   the panel           unexpected property
//   sidebar_action               unexpected key      the panel
//   externally_connectable       web page -> ext     not supported
//   browser_specific_settings    unexpected key      required for signing
//
// So Chrome's half is an overlay: `manifest.chrome.overlay.json` adds Chrome's
// keys and FIREFOX_ONLY_KEYS are deleted. The only content the two files share
// is the permission list, and `tests/manifest.test.js` holds that to a
// one-entry delta.
//
// Shared by `scripts/build.js` and the tests, so neither can drift from the
// other's idea of what "the Chrome manifest" means.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FIREFOX_MANIFEST = path.join(ROOT, 'manifest.json');
const CHROME_OVERLAY = path.join(ROOT, 'manifest.chrome.overlay.json');

/** Keys Chrome must never see. Anything Firefox-only not in the overlay belongs here. */
const FIREFOX_ONLY_KEYS = ['browser_specific_settings', 'sidebar_action'];

/** Keys the overlay is allowed to define — a typo here is a silent no-op otherwise. */
const CHROME_ONLY_KEYS = ['permissions', 'background', 'externally_connectable', 'side_panel'];

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const readFirefoxManifest = () => readJson(FIREFOX_MANIFEST);
const readChromeOverlay = () => readJson(CHROME_OVERLAY);

/** Firefox manifest + Chrome overlay, minus the keys Firefox owns. */
function deriveChromeManifest(base) {
  const manifest = { ...base, ...readChromeOverlay() };
  for (const key of FIREFOX_ONLY_KEYS) delete manifest[key];
  return manifest;
}

/** The manifest a given browser ships. Firefox uses the source file untouched. */
function manifestFor(browser, base) {
  return browser === 'chrome' ? deriveChromeManifest(base) : base;
}

module.exports = {
  ROOT,
  FIREFOX_MANIFEST,
  CHROME_OVERLAY,
  FIREFOX_ONLY_KEYS,
  CHROME_ONLY_KEYS,
  readFirefoxManifest,
  readChromeOverlay,
  deriveChromeManifest,
  manifestFor,
};
