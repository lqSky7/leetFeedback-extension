// Traverse — publication build script.
//
// Produces a minified, store-ready zip of the extension for one browser:
//   1. Bumps the version in manifest.json (patch by default; `minor`/`major` as
//      argv[2]).
//   2. Copies the publication set into dist/ — dev-only files (tests, docs,
//      tooling) stay out of the store package.
//   3. Writes the browser's manifest into dist/. `manifest.json` is the Firefox
//      manifest; the Chrome build derives its own from it plus an overlay, so
//      neither package carries keys the other browser warns about.
//   4. Minifies: JS via Terser (a real parser — regex minification corrupts
//      template literals), CSS/HTML via conservative whitespace/comment
//      stripping. This is standard minification, NOT obfuscation: no top-level
//      renaming, no string encryption, no control-flow tricks — the store's
//      review diff stays readable and Chrome's obfuscation policy is respected.
//   5. Verifies the output: every manifest-referenced file exists, and every
//      dist .js still parses (`node --check`).
//   6. Zips dist/ contents at the zip root (manifest.json must sit at the top
//      level) onto the Desktop.
//
// Run: node scripts/build.js [patch|minor|major] [chrome|firefox]
//   chrome  (default) -> traverse-v<version>.zip
//   firefox           -> traverse-firefox-v<version>.zip

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { minify } = require('terser');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DESKTOP = path.join(os.homedir(), 'Desktop');

// Dev-only paths that must never ship to the store.
const EXCLUDED = new Set([
  '.git',
  '.github',
  '.gitignore',
  '.DS_Store',
  '.workbuddy-ai',
  'node_modules',
  'dist',
  'scripts',
  'tests',
  'testing',
  'coverage',
  'package.json',
  'package-lock.json',
  'CHANGES.md',
  'CONTRIBUTING.md',
  'REFACTOR_PLAN.md',
  'README.md',
  'LICENSE',
  'index.md',
  'manifest.chrome.overlay.json',
]);

const log = (...args) => console.log('[build]', ...args);
const fail = (message) => {
  console.error('[build] FAIL:', message);
  process.exit(1);
};

/* ── version ────────────────────────────────────────────────────────────── */

function bumpVersion(version, level) {
  const parts = version.split('.').map((n) => parseInt(n, 10));
  while (parts.length < 3) parts.push(0);

  if (level === 'major') return [parts[0] + 1, 0, 0].join('.');
  if (level === 'minor') return [parts[0], parts[1] + 1, 0].join('.');
  return [parts[0], parts[1], parts[2] + 1].join('.');
}

/* ── minifiers ──────────────────────────────────────────────────────────── */

async function minifyJs(code, file) {
  const result = await minify(code, {
    module: false,
    compress: { passes: 2 },
    mangle: true, // locals only — top-level names survive, per CWS policy
    format: { comments: false },
  });

  if (result.code === undefined || result.code === null) {
    throw new Error(`terser returned no output for ${file}`);
  }
  if (result.warnings) result.warnings.forEach((w) => log(`warning (${file}):`, w));

  return result.code;
}

/** Conservative CSS minify: comments + redundant whitespace only. */
function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,>+~])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

/** Conservative HTML minify: comments + blank lines only (text spacing stays). */
function minifyHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ── copy + minify pass ─────────────────────────────────────────────────── */

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (EXCLUDED.has(entry.name)) continue;
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

async function buildTree() {
  let files = 0;

  for (const file of walk(ROOT)) {
    const rel = path.relative(ROOT, file);
    const out = path.join(DIST, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });

    const ext = path.extname(file).toLowerCase();

    if (ext === '.js') {
      const code = fs.readFileSync(file, 'utf8');
      const before = code.length;
      const minified = await minifyJs(code, rel);
      fs.writeFileSync(out, minified);
      files += 1;
      log(`js  ${rel}  ${(before / 1024).toFixed(1)}kB -> ${(minified.length / 1024).toFixed(1)}kB`);
    } else if (ext === '.css') {
      const css = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(out, minifyCss(css));
      files += 1;
    } else if (ext === '.html') {
      const html = fs.readFileSync(file, 'utf8');
      fs.writeFileSync(out, minifyHtml(html));
      files += 1;
    } else {
      fs.copyFileSync(file, out); // manifest, icons, fonts, …
      files += 1;
    }
  }

  return files;
}

/* ── per-browser manifests ──────────────────────────────────────────────── */

// `manifest.json` is the Firefox manifest and the single source of truth for
// everything the two browsers share; Chrome's half is an overlay. The
// derivation, and the reasoning behind it, live in scripts/manifest.js so the
// tests and this script cannot disagree about what "the Chrome manifest" means.
const { manifestFor } = require('./manifest.js');

/* ── verification ───────────────────────────────────────────────────────── */

/** Every file the manifest (and the background's importScripts) references must exist in dist. */
function verifyReferencedFiles() {
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
  const referenced = new Set();

  const add = (rel) => rel && referenced.add(rel);

  add(manifest.background && manifest.background.service_worker);
  // Firefox has no MV3 service worker and loads the background as an event page
  // from this list instead, so its entries are just as load-bearing.
  for (const script of (manifest.background && manifest.background.scripts) || []) add(script);
  add(manifest.side_panel && manifest.side_panel.default_path);
  add(manifest.sidebar_action && manifest.sidebar_action.default_panel);
  for (const icon of Object.values((manifest.sidebar_action && manifest.sidebar_action.default_icon) || {})) add(icon);
  for (const icon of Object.values(manifest.icons || {})) add(icon);
  for (const icon of Object.values((manifest.action && manifest.action.default_icon) || {})) add(icon);
  for (const cs of manifest.content_scripts || []) for (const js of cs.js || []) add(js);
  for (const war of manifest.web_accessible_resources || []) {
    for (const res of war.resources || []) add(res);
  }

  // background.js pulls core modules via importScripts('…') on Chrome. The call
  // is guarded for Firefox, but the argument list still has to resolve.
  const workerPath = manifest.background && manifest.background.service_worker;
  if (workerPath) {
    const worker = path.join(DIST, workerPath);
    const importScripts = fs
      .readFileSync(worker, 'utf8')
      .match(/importScripts\(([^)]*)\)/g) || [];
    for (const call of importScripts) {
      for (const match of call.matchAll(/['"]([^'"]+)['"]/g)) {
        add(path.join(path.dirname(workerPath), match[1]));
      }
    }
  }

  const missing = [...referenced].filter((rel) => !fs.existsSync(path.join(DIST, rel)));
  if (missing.length > 0) fail(`manifest references missing from dist: ${missing.join(', ')}`);
  return referenced.size;
}

/** Every minified .js must still parse — the loud guard against minifier corruption. */
function verifyJsParses() {
  let checked = 0;
  const stack = [DIST];

  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (full.endsWith('.js')) {
        const probe = spawnSync(process.execPath, ['--check', full], { encoding: 'utf8' });
        if (probe.status !== 0) {
          fail(`minified file does not parse: ${path.relative(DIST, full)}\n${probe.stderr}`);
        }
        checked += 1;
      }
    }
  }
  return checked;
}

/**
 * No hidden directories in the package.
 *
 * The copy pass is driven by a deny-list of basenames, so anything new at the
 * repo root ships unless someone remembers to exclude it. That has already gone
 * wrong once: a tooling directory (`.workbuddy-ai/`) rode along into both zips.
 * A store package never legitimately contains a dot-directory, so this turns
 * "someone forgot" into a build failure instead of a silent upload.
 */
function verifyNoHiddenDirs() {
  const found = [];
  const stack = [DIST];

  while (stack.length > 0) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith('.')) {
        found.push(path.relative(DIST, full));
        continue;
      }
      stack.push(full);
    }
  }

  if (found.length > 0) fail(`dev-only directories shipped to dist/: ${found.join(', ')}`);
  return true;
}

/* ── zip ────────────────────────────────────────────────────────────────── */

/** Chrome keeps the historical filename; the Firefox package must not clobber it. */
function zipDist(version, browser) {
  if (!fs.existsSync(DESKTOP)) fail(`Desktop not found: ${DESKTOP}`);

  const name = browser === 'chrome' ? `traverse-v${version}.zip` : `traverse-firefox-v${version}.zip`;
  const out = path.join(DESKTOP, name);
  fs.rmSync(out, { force: true });

  // Files at the zip ROOT — both stores expect manifest.json at the top level.
  const probe = spawnSync('zip', ['-r', '-X', '-q', out, '.'], { cwd: DIST, encoding: 'utf8' });
  if (probe.status !== 0) fail(`zip failed: ${probe.stderr || probe.stdout}`);

  return out;
}

/* ── main ───────────────────────────────────────────────────────────────── */

(async () => {
  const level = (process.argv[2] || 'patch').toLowerCase();
  if (!['patch', 'minor', 'major'].includes(level)) {
    fail(`usage: node scripts/build.js [patch|minor|major] [chrome|firefox] (got "${level}")`);
  }

  const browser = (process.argv[3] || 'chrome').toLowerCase();
  if (!['chrome', 'firefox'].includes(browser)) {
    fail(`unknown browser "${browser}" — expected chrome or firefox`);
  }

  const manifestPath = path.join(ROOT, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const version = bumpVersion(manifest.version, level);

  manifest.version = version;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + '\n');
  log(`version bumped: ${manifest.version} -> ${version}`);

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const fileCount = await buildTree();
  log(`built ${fileCount} files into dist/`);

  // buildTree copies the source manifest verbatim. Chrome gets the derived one
  // instead, so a Chrome package never carries keys Chrome warns about.
  const shipped = manifestFor(browser, manifest);
  fs.writeFileSync(path.join(DIST, 'manifest.json'), JSON.stringify(shipped, null, 4) + '\n');
  log(`${browser} manifest: ${Object.keys(shipped).length} keys`);

  const refCount = verifyReferencedFiles();
  log(`verified ${refCount} manifest-referenced files exist in dist/`);

  const jsCount = verifyJsParses();
  log(`verified ${jsCount} minified .js files still parse`);

  verifyNoHiddenDirs();
  log('verified no dev-only directories shipped');

  const out = zipDist(version, browser);
  const zipSize = fs.statSync(out).size;

  log('');
  log(`✓ ${path.basename(out)}`);
  log(`  ${(zipSize / 1024).toFixed(1)} kB, ${fileCount} files`);
  log(`  ${out}`);
})().catch((error) => fail(error && error.stack ? error.stack : error));
