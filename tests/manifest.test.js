'use strict';

// The two manifests, and the overlay that separates them.
//
// This exists because the split is invisible at runtime and fails late. A
// Chrome-only key left in `manifest.json` is not a broken extension — Firefox
// still runs it, it just warns in about:debugging, which is easy to ignore and
// easy to reintroduce. A Firefox-only key that leaks into the Chrome build is
// worse: Chrome ignores it and the packaged extension quietly loses a feature
// (no service worker means no background at all).
//
// So: pin what each side must and must not contain, that the Chrome manifest is
// derived rather than hand-written, and that the two agree on everything shared.
//
// Run: node tests/manifest.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  ROOT,
  CHROME_ONLY_KEYS,
  FIREFOX_ONLY_KEYS,
  readFirefoxManifest,
  readChromeOverlay,
  deriveChromeManifest,
} = require('../scripts/manifest.js');

const firefox = readFirefoxManifest();
const overlay = readChromeOverlay();
const chrome = deriveChromeManifest(firefox);

/** Every file a manifest references, so a rename cannot silently orphan one. */
function referencedFiles(manifest) {
  const refs = new Set();
  const add = (rel) => rel && refs.add(rel);

  add(manifest.background && manifest.background.service_worker);
  for (const script of (manifest.background && manifest.background.scripts) || []) add(script);
  add(manifest.side_panel && manifest.side_panel.default_path);
  add(manifest.sidebar_action && manifest.sidebar_action.default_panel);
  for (const icon of Object.values((manifest.sidebar_action && manifest.sidebar_action.default_icon) || {})) add(icon);
  for (const icon of Object.values(manifest.icons || {})) add(icon);
  for (const icon of Object.values((manifest.action && manifest.action.default_icon) || {})) add(icon);
  for (const cs of manifest.content_scripts || []) for (const js of cs.js || []) add(js);

  return [...refs];
}

/* ─────────────────────────────── scenarios ─────────────────────────────── */

/** The Firefox manifest must be one Firefox can parse without complaining. */
function firefoxManifestIsClean() {
  assert.strictEqual(firefox.manifest_version, 3, 'both browsers need MV3');
  assert.ok(firefox.name && firefox.version, 'name and version are required');

  // Keys Firefox warns about, and would show in about:debugging.
  assert.ok(!('side_panel' in firefox), 'side_panel is Chrome-only — Firefox reports it as an unexpected property');
  assert.ok(!('externally_connectable' in firefox), 'externally_connectable is unsupported in Firefox');
  assert.ok(
    !(firefox.permissions || []).includes('sidePanel'),
    'sidePanel is not a Firefox permission — it makes about:debugging print a schema dump'
  );
  assert.ok(
    !(firefox.background || {}).service_worker,
    'service_worker is ignored by Firefox, which warns and uses background.scripts'
  );

  // Keys Firefox needs.
  assert.ok(firefox.browser_specific_settings?.gecko?.id, 'an add-on id is required for storage.sync and for signing');
  assert.ok(Array.isArray(firefox.background?.scripts), 'Firefox loads the background from background.scripts');
  assert.strictEqual(
    firefox.sidebar_action?.default_panel,
    'sidepanel/sidepanel.html',
    'Firefox renders the panel as a sidebar'
  );
}

/**
 * The Firefox manifest and the background's importScripts call must name the
 * same files. Chrome only ever runs the importScripts list; Firefox only ever
 * runs the manifest list. A file added to one and not the other works in one
 * browser and throws on start in the other.
 */
function backgroundListsAgree() {
  const source = fs.readFileSync(path.join(ROOT, 'background', 'background.js'), 'utf8');
  const call = source.match(/importScripts\(([^)]*)\)/);
  assert.ok(call, 'background.js must still call importScripts for the Chrome path');

  const imported = [...call[1].matchAll(/['"]([^'"]+)['"]/g)]
    .map((match) => path.normalize(path.join('background', match[1])));

  const scripts = firefox.background.scripts;
  assert.strictEqual(
    scripts[scripts.length - 1],
    'background/background.js',
    'the entry file must be last — it reads T.* set up by the earlier scripts'
  );
  assert.deepStrictEqual(
    scripts.slice(0, -1),
    imported,
    'background.scripts must list exactly the importScripts arguments, in order'
  );
}

/** The overlay carries Chrome's keys and nothing else. */
function overlayIsChromeOnly() {
  for (const key of Object.keys(overlay)) {
    assert.ok(
      CHROME_ONLY_KEYS.includes(key),
      `"${key}" is in the Chrome overlay but not a known Chrome-only key — add it to CHROME_ONLY_KEYS or remove it`
    );
  }
  for (const key of FIREFOX_ONLY_KEYS) {
    assert.ok(!(key in overlay), `"${key}" is Firefox-only and must not appear in the Chrome overlay`);
  }

  assert.strictEqual(overlay.background.service_worker, 'background/background.js', 'Chrome runs a service worker');
  assert.ok(overlay.permissions.includes('sidePanel'), 'Chrome needs the sidePanel permission for chrome.sidePanel');
  assert.strictEqual(overlay.side_panel.default_path, 'sidepanel/sidepanel.html', 'Chrome renders the panel as a side panel');
  assert.ok(Array.isArray(overlay.externally_connectable.matches), 'Chrome keeps the web-page auth handshake');
}

/** The derived Chrome manifest: Chrome's keys present, Firefox's gone. */
function chromeManifestIsComplete() {
  assert.strictEqual(chrome.background.service_worker, 'background/background.js');
  assert.ok(!chrome.background.scripts, 'Chrome must not ship background.scripts');
  assert.ok(!('sidebar_action' in chrome), 'sidebar_action would be an unrecognised key in Chrome');
  assert.ok(!('browser_specific_settings' in chrome), 'browser_specific_settings would be an unrecognised key in Chrome');
  assert.strictEqual(chrome.side_panel.default_path, 'sidepanel/sidepanel.html');

  // Same panel, two hosts: if these ever diverge the two browsers show
  // different UIs from the same source tree.
  assert.strictEqual(
    chrome.side_panel.default_path,
    firefox.sidebar_action.default_panel,
    'the side panel and the sidebar must point at the same HTML'
  );
}

/**
 * The permission lists differ by exactly `sidePanel`.
 *
 * This is the one piece of content the overlay restates instead of inheriting,
 * so it is the one piece that can drift. A permission added to the Firefox
 * manifest and forgotten here is a feature that works in Firefox and silently
 * fails in Chrome.
 */
function permissionDeltaIsExactlySidePanel() {
  const firefoxPerms = [...firefox.permissions].sort();
  const chromePerms = [...chrome.permissions].sort();

  const added = chromePerms.filter((p) => !firefoxPerms.includes(p));
  const removed = firefoxPerms.filter((p) => !chromePerms.includes(p));

  assert.deepStrictEqual(added, ['sidePanel'], 'Chrome adds exactly the sidePanel permission');
  assert.deepStrictEqual(removed, [], 'the Chrome overlay must not drop a permission Firefox has');
}

/** Everything the two browsers must agree on, because it is not in the overlay. */
function sharedKeysAreIdentical() {
  for (const key of ['manifest_version', 'name', 'version', 'description', 'icons', 'host_permissions', 'content_scripts', 'action']) {
    assert.deepStrictEqual(
      chrome[key],
      firefox[key],
      `"${key}" must be identical in both manifests — it is not browser-specific`
    );
  }
}

/**
 * `externally_connectable.matches` and `config.allowedExternalOrigins` are two
 * halves of one handshake: the manifest decides which origins may message the
 * background, and the background re-checks the sender against the config list.
 * An origin allowed by one and not the other fails in a way that looks like a
 * broken login.
 */
function externalOriginsCoverTheConfigList() {
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'core', 'config.js'), 'utf8'), sandbox, {
    filename: 'core/config.js',
  });

  const allowed = sandbox.Traverse.config.allowedExternalOrigins;
  const matches = chrome.externally_connectable.matches;

  assert.ok(allowed.length > 0, 'config.allowedExternalOrigins must not be empty');
  for (const origin of allowed) {
    assert.ok(
      matches.some((pattern) => pattern.startsWith(`${origin}/`)),
      `"${origin}" is allowed by config.js but no externally_connectable match covers it`
    );
  }
}

/** A rename that orphans a file breaks the package, not just the manifest. */
function everyReferencedFileExists() {
  for (const [label, manifest] of [['Firefox', firefox], ['Chrome', chrome]]) {
    const missing = referencedFiles(manifest).filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
    assert.deepStrictEqual(missing, [], `${label} manifest references missing files: ${missing.join(', ')}`);
  }
}

/* ───────────────────────────────── runner ──────────────────────────────── */

const SCENARIOS = [
  ['the Firefox manifest carries no Chrome-only keys', firefoxManifestIsClean],
  ['background.scripts mirrors the importScripts list', backgroundListsAgree],
  ['the Chrome overlay defines Chrome keys only', overlayIsChromeOnly],
  ['the derived Chrome manifest is complete', chromeManifestIsComplete],
  ['permissions differ by exactly sidePanel', permissionDeltaIsExactlySidePanel],
  ['shared keys are identical in both manifests', sharedKeysAreIdentical],
  ['externally_connectable covers config.allowedExternalOrigins', externalOriginsCoverTheConfigList],
  ['every referenced file exists', everyReferencedFileExists],
];

(async () => {
  let failures = 0;

  for (const [name, run] of SCENARIOS) {
    try {
      await run();
      console.log(`  ok  ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`  FAIL ${name}`);
      console.error(`       ${error && error.message}`);
    }
  }

  console.log('');
  if (failures > 0) {
    console.error(`${failures} manifest scenario(s) failed.`);
    process.exit(1);
  }
  console.log(`All ${SCENARIOS.length} manifest scenarios passed.`);
})();
