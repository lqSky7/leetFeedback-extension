'use strict';

// Focused harness for the platform recon controller (core/recon-controller.js).
//
// The main smoke harness (tests/smoke.test.js) stands up the platform-adapter
// stack and pins the environment to leetcode.com. Recon needs the opposite:
// a non-LeetCode host, a DOM with run/submit buttons, and clickable elements —
// so it gets its own smaller environment rather than complicating that one.
//
// Run: node tests/recon.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

const RECON_STACK = [
  'core/config.js',
  'core/logger.js',
  'core/net-protocol.js',
  'core/recon-controller.js',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The controller debounces its storage writes by 1.5s. Assertions read the
// persisted bundle (the real artifact), so they have to outwait that.
const PERSIST_SETTLE_MS = 1800;

/* ─────────────────────────────── fake DOM ─────────────────────────────── */

function makeElement(spec) {
  const element = {
    nodeType: 1,
    tagName: String(spec.tagName || 'BUTTON').toUpperCase(),
    id: spec.id || '',
    className: spec.className || '',
    textContent: spec.textContent || '',
    value: spec.value || '',
    disabled: false,
    offsetParent: {},
    parentElement: null,
    children: [],
    _attrs: spec.attrs || {},
    getAttribute(name) {
      return name in element._attrs ? element._attrs[name] : null;
    },
    hasAttribute(name) {
      return name in element._attrs;
    },
    closest(selector) {
      return String(selector).includes('button') ? element : null;
    },
  };
  return element;
}

/** Enough selector support for the selectors the controller generates. */
function matchesSimple(element, rawSelector) {
  const selector = rawSelector.trim();
  if (!selector || selector.includes(' ') || selector.includes('>')) return false;

  // Tag names may contain digits (h1, h2, h3), so the tag group is not [a-z]+.
  const parsed = selector.match(/^([a-z][a-z0-9]*)?((?:[#.][\w-]+)*)(?:\[([\w-]+)([~*^$]?=)"([^"]*)"\])?$/i);
  if (!parsed) return false;

  const [, tag, modifiers, attrName, attrOp, attrValue] = parsed;

  if (tag && element.tagName.toLowerCase() !== tag.toLowerCase()) return false;

  if (modifiers) {
    for (const part of modifiers.split(/(?=[#.])/).filter(Boolean)) {
      if (part[0] === '.') {
        if (!element.className.split(/\s+/).includes(part.slice(1))) return false;
      } else if (part[0] === '#') {
        if (element.id !== part.slice(1)) return false;
      }
    }
  }

  if (attrName) {
    const actual = element.getAttribute(attrName) || '';
    if (attrOp === '*') {
      if (!actual.includes(attrValue)) return false;
    } else if (actual !== attrValue) {
      return false;
    }
  }

  return true;
}

function createEnvironment(options = {}) {
  const localStore = { ...(options.storage || {}) };
  const storageListeners = [];
  // Kept separate: the controller listens on `window` for interceptor events
  // and on `document` for clicks, and merging the two would deliver message
  // events to the click handler.
  const windowListeners = {};
  const documentListeners = {};
  const postedMessages = [];
  const sentMessages = [];

  const registry = [];

  const document = {
    readyState: 'complete',
    hidden: false,
    title: 'Solve Me | HackerRank',
    body: makeElement({ tagName: 'body' }),
    createElement: (tag) => makeElement({ tagName: tag }),
    getElementById: () => null,
    querySelector(selector) {
      const found = document.querySelectorAll(selector);
      return found.length > 0 ? found[0] : null;
    },
    querySelectorAll(selector) {
      const parts = String(selector).split(',').map((part) => part.trim()).filter(Boolean);
      const out = [];
      for (const part of parts) {
        for (const element of registry) {
          if (matchesSimple(element, part) && !out.includes(element)) out.push(element);
        }
      }
      return out;
    },
    addEventListener(type, handler) {
      (documentListeners[type] || (documentListeners[type] = [])).push(handler);
    },
    removeEventListener() {},
  };

  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const out = {};
          for (const key of keys) if (key in localStore) out[key] = localStore[key];
          return out;
        },
        async set(items) {
          const changes = {};
          for (const key of Object.keys(items)) {
            changes[key] = { oldValue: localStore[key], newValue: items[key] };
            localStore[key] = items[key];
          }
          storageListeners.forEach((fn) => fn(changes, 'local'));
        },
        async remove(keys) {
          for (const key of keys) delete localStore[key];
        },
      },
      onChanged: { addListener: (fn) => storageListeners.push(fn) },
    },
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        sentMessages.push(message);
        if (callback) callback({ success: true, status: 202, data: {} });
      },
    },
  };

  return {
    localStore,
    postedMessages,
    sentMessages,
    registry,
    document,
    chrome,
    location: {
      href: options.href || 'https://www.hackerrank.com/challenges/solve-me/problem',
      pathname: options.pathname || '/challenges/solve-me/problem',
      search: '',
      hostname: options.hostname || 'www.hackerrank.com',
      origin: options.origin || 'https://www.hackerrank.com',
    },
    listeners: windowListeners,
    documentListeners,

    addElement(spec) {
      const element = makeElement(spec);
      registry.push(element);
      return element;
    },

    /** Invoke the registered click handlers the way a real click would. */
    click(element) {
      for (const handler of documentListeners.click || []) handler({ target: element });
    },

    /** Deliver a message event to every registered window listener. */
    emit(data) {
      for (const handler of windowListeners.message || []) {
        handler({ source: globalThis, data });
      }
    },
  };
}

function loadReconStack(env, options = {}) {
  // Tear the previous scenario's controller down first. Its scan interval and
  // persist timers would otherwise keep firing and write into *this* scenario's
  // storage mock, making results depend on run order.
  const previous = globalThis.__traverseRecon;
  if (previous && typeof previous.destroy === 'function') previous.destroy();

  // The controller installs itself as a page-level singleton, so a scenario
  // that forgot to clear it would silently drive the *previous* scenario's
  // instance (and its chrome mock).
  for (const key of [
    'window', 'document', 'chrome', 'location', 'Traverse', 'navigator', 'CSS',
    '__traverseRecon', '__traverseNetInterceptorInstalled',
  ]) {
    delete globalThis[key];
  }

  globalThis.window = globalThis;
  globalThis.document = env.document;
  globalThis.chrome = env.chrome;
  globalThis.location = env.location;
  globalThis.navigator = { userAgent: 'node-smoke', language: 'en-US' };
  globalThis.CSS = { escape: (value) => String(value) };
  globalThis.innerWidth = 1200;
  globalThis.innerHeight = 800;

  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };

  globalThis.addEventListener = (type, handler) => {
    (env.listeners[type] || (env.listeners[type] = [])).push(handler);
  };
  globalThis.removeEventListener = () => {};
  globalThis.postMessage = (message) => env.postedMessages.push(message);

  for (const file of RECON_STACK) {
    let code = fs.readFileSync(path.join(ROOT, file), 'utf8');

    // The controller boots as soon as the file is evaluated, so a scenario that
    // needs a build with no baked-in token has to patch the config *source*
    // rather than mutate T.config afterwards — by then init() has already run.
    if (options.stripDefaultToken && file === 'core/config.js') {
      code = code.replace(/defaultToken:\s*'[^']*'/, "defaultToken: ''");
    }

    vm.runInThisContext(code, { filename: file });
  }

  if (process.env.SMOKE_DEBUG) globalThis.Traverse.logger.setDebugMode(true);

  return globalThis.Traverse;
}

/** Standard button set: a submit and a run, as any judge page has. */
function standardButtons(env) {
  const submit = env.addElement({
    tagName: 'button',
    className: 'btn btn-primary submit-btn',
    textContent: 'Submit',
    attrs: { 'data-testid': 'submit-btn' },
  });

  const run = env.addElement({
    tagName: 'button',
    className: 'btn run-btn',
    textContent: 'Run Code',
  });

  env.addElement({ tagName: 'div', className: 'monaco-editor' });
  env.addElement({ tagName: 'h1', className: 'problem-title', textContent: 'Solve Me First' });
  env.addElement({ tagName: 'span', className: 'difficulty-label', textContent: 'Easy' });

  return { submit, run };
}

function reconEvent(payload) {
  return { type: 'TRV_RECON_EVENT', ...payload };
}

/* ──────────────────────────────── scenarios ─────────────────────────────── */

async function armsAndCapturesAllFourFlows() {
  const env = createEnvironment({ storage: { recon_ingest_token: 'tok-123' } });
  const buttons = standardButtons(env);
  loadReconStack(env);
  await sleep(20);

  const status = env.localStore.recon_status;
  assert.strictEqual(status.armed, true, 'should arm on a problem page with a token');
  assert.strictEqual(status.platform, 'hackerrank');

  // The interceptor must have been configured, with the ingest URL excluded so
  // uploading a capture is not itself captured.
  const config = env.postedMessages.find((m) => m.type === 'TRV_RECON_CONFIG');
  assert.ok(config, 'expected a TRV_RECON_CONFIG message');
  assert.strictEqual(config.enabled, true);
  assert.ok(config.excludeUrl && config.excludeUrl.includes('ngrok'), 'ingest URL should be excluded');

  // Buttons were discovered, with usable selectors.
  assert.ok(
    status.buttons.some((b) => b.kind === 'submit' && b.selector === 'button[data-testid="submit-btn"]'),
    'submit button should be described with its stable selector'
  );
  assert.ok(
    status.buttons.some((b) => b.kind === 'run' && b.selector === 'button.btn.run-btn'),
    'run button should be described with its stable selector'
  );

  // ── submit, accepted ──
  env.click(buttons.submit);
  const submitUrl = 'https://www.hackerrank.com/rest/contests/master/challenges/solve-me/submissions';
  env.emit(reconEvent({ seq: 1, phase: 'request', url: submitUrl, method: 'POST', startedAt: Date.now(),
    requestBody: JSON.stringify({ code: 'print("hi")', language: 'python3' }) }));
  env.emit(reconEvent({ seq: 1, phase: 'response', url: submitUrl, method: 'POST', status: 200,
    responseBody: JSON.stringify({ status: 'Accepted', score: 1 }) }));

  // ── run, wrong answer ──
  env.click(buttons.run);
  const runUrl = 'https://www.hackerrank.com/rest/contests/master/challenges/solve-me/run';
  env.emit(reconEvent({ seq: 2, phase: 'request', url: runUrl, method: 'POST', startedAt: Date.now(),
    requestBody: JSON.stringify({ code: 'print(1)', language: 'python3' }) }));
  env.emit(reconEvent({ seq: 2, phase: 'response', url: runUrl, method: 'POST', status: 200,
    responseBody: JSON.stringify({ status: 'Wrong Answer' }) }));

  await sleep(PERSIST_SETTLE_MS);

  const flows = env.localStore.recon_status.flows;
  assert.strictEqual(flows['submit-pass'].status, 'observed', 'submit + Accepted should record submit-pass');
  assert.strictEqual(flows['submit-pass'].verdict.status, 'Accepted');
  assert.strictEqual(flows['run-fail'].status, 'observed', 'run + Wrong Answer should record run-fail');
  assert.strictEqual(flows['run-fail'].verdict.accepted, false);
  assert.strictEqual(flows['run-pass'].status, 'missing');
  assert.strictEqual(flows['submit-fail'].status, 'missing');

  // ── the bundle ──
  const bundle = env.localStore.recon_bundle;
  assert.strictEqual(bundle.schema, 'traverse.recon.v1');
  assert.strictEqual(bundle.platform, 'hackerrank');
  assert.ok(bundle.captureId.startsWith('recon-hackerrank-'));
  assert.strictEqual(bundle.network.length, 2, 'request and response should merge into one record per seq');

  const first = bundle.network[0];
  assert.strictEqual(first.method, 'POST');
  assert.strictEqual(first.status, 200);
  assert.strictEqual(first.flow, 'submit');
  assert.strictEqual(first.requestBody.code, 'print("hi")', 'request body should be parsed');
  assert.strictEqual(first.responseBody.status, 'Accepted', 'response body should be parsed');

  assert.ok(bundle.dom.buttons.length >= 2, 'bundle should carry the button inventory');
  assert.ok(bundle.dom.editors.some((e) => e.kind === 'monaco'), 'bundle should carry the editor shape');
  assert.ok(
    bundle.dom.metadata.candidates.some((c) => c.kind === 'title' && c.text === 'Solve Me First'),
    'bundle should carry metadata selectors'
  );
}

async function weakTokensDoNotInventVerdicts() {
  const env = createEnvironment({ storage: { recon_ingest_token: 'tok-123' } });
  const buttons = standardButtons(env);
  loadReconStack(env);
  await sleep(20);

  env.click(buttons.submit);

  // A plain envelope from a non-judge endpoint. `success: true` is a weak token
  // on a URL that looks nothing like a judge, so it must not become a verdict.
  env.emit(reconEvent({ seq: 1, phase: 'response', url: 'https://www.hackerrank.com/rest/user/me',
    method: 'GET', status: 200, responseBody: JSON.stringify({ success: true, data: { id: 7 } }) }));

  // "lookup" contains the token "ok" — a naive substring match would read this
  // as an accepted verdict.
  env.emit(reconEvent({ seq: 2, phase: 'response', url: 'https://www.hackerrank.com/rest/challenges/solve-me',
    method: 'GET', status: 200, responseBody: JSON.stringify({ status: 'lookup' }) }));

  await sleep(PERSIST_SETTLE_MS);

  const flows = env.localStore.recon_status.flows;
  assert.strictEqual(flows['submit-pass'].status, 'missing', 'generic success envelope must not be a verdict');
  assert.strictEqual(flows['submit-fail'].status, 'missing');
}

async function doesNotArmOnExcludedOrUnknownHosts() {
  // LeetCode has verified network capture — recon must stay off.
  const leetcode = createEnvironment({
    storage: { recon_ingest_token: 'tok-123' },
    href: 'https://leetcode.com/problems/two-sum/',
    pathname: '/problems/two-sum/',
    hostname: 'leetcode.com',
    origin: 'https://leetcode.com',
  });
  loadReconStack(leetcode);
  await sleep(20);
  assert.strictEqual(leetcode.localStore.recon_status, undefined, 'no status should be published on LeetCode');
  assert.strictEqual(leetcode.postedMessages.length, 0, 'recon must not configure the interceptor on LeetCode');

  // A host with no platform mapping.
  const other = createEnvironment({
    storage: { recon_ingest_token: 'tok-123' },
    href: 'https://example.com/problems/x/',
    pathname: '/problems/x/',
    hostname: 'example.com',
    origin: 'https://example.com',
  });
  loadReconStack(other);
  await sleep(20);
  assert.strictEqual(other.postedMessages.length, 0, 'recon must not run on an unmapped host');
}

/**
 * The point of the baked-in token: a user who never opens the sidepanel — and so
 * never writes anything to storage — must still get recorded. If this regresses,
 * recon silently collects nothing for everyone who just opens a problem page.
 */
async function armsWithBuiltInTokenAndNoSetup() {
  const env = createEnvironment({ storage: {} });
  standardButtons(env);
  loadReconStack(env);
  await sleep(20);

  const status = env.localStore.recon_status;
  assert.strictEqual(status.armed, true, 'must arm from the built-in token alone');
  assert.strictEqual(status.hasToken, true, 'the built-in token must count as configured');

  assert.ok(
    env.postedMessages.some((m) => m.type === 'TRV_RECON_CONFIG' && m.enabled === true),
    'recon must ask the interceptor to capture without any user setup'
  );
}

/**
 * The built-in token is a convenience, not a guarantee: a build that ships with
 * none (and no stored override) must stay idle rather than accumulate a bundle
 * it could never deliver.
 */
async function doesNotArmWithoutAToken() {
  const env = createEnvironment({ storage: {} });
  standardButtons(env);
  loadReconStack(env, { stripDefaultToken: true });
  await sleep(20);

  const status = env.localStore.recon_status;
  assert.strictEqual(status.armed, false, 'recording must stay off when no token exists at all');
  assert.strictEqual(status.hasToken, false);

  // The interceptor starts disabled, so the requirement is simply that recon
  // never asked it to capture.
  assert.ok(
    !env.postedMessages.some((m) => m.type === 'TRV_RECON_CONFIG' && m.enabled === true),
    'recon must never enable capture without a token'
  );
}

/** A stored override must win over the built-in token. */
async function storedTokenOverridesTheBuiltInOne() {
  const env = createEnvironment({ storage: { recon_ingest_token: 'override-tok' } });
  standardButtons(env);
  loadReconStack(env);
  await sleep(20);

  const controller = globalThis.__traverseRecon;
  assert.strictEqual(controller.token, 'override-tok', 'the stored token must take precedence');
  assert.strictEqual(env.localStore.recon_status.armed, true);
}

async function doesNotArmOffAProblemPage() {
  const env = createEnvironment({
    storage: { recon_ingest_token: 'tok-123' },
    href: 'https://www.hackerrank.com/dashboard',
    pathname: '/dashboard',
  });
  standardButtons(env);
  loadReconStack(env);
  await sleep(20);

  const status = env.localStore.recon_status;
  assert.strictEqual(status.armed, false, 'the dashboard is not a problem page');
  assert.strictEqual(status.onProblemPage, false);
}

async function uploadsTheStagedBundle() {
  const env = createEnvironment({ storage: { recon_ingest_token: 'tok-123' } });
  standardButtons(env);
  loadReconStack(env);
  await sleep(20);

  // Drive an upload the way the sidepanel does.
  const controller = globalThis.__traverseRecon;
  assert.ok(controller, 'controller should be installed on window');

  const result = await controller.upload();
  assert.strictEqual(result.success, true);
  assert.ok(
    env.sentMessages.some((m) => m.type === 'RECON_UPLOAD'),
    'upload should be delegated to the background worker, not posted from the page'
  );
  assert.ok(env.localStore.recon_status.uploadedAt, 'a successful upload should be stamped');
}

/**
 * The regression this guards: auto-upload used to require **all four** flows.
 * Plenty of judges expose only a Run, or make a failing attempt awkward to
 * force, so captures sat in chrome.storage forever and nothing was ever
 * delivered — the feature silently produced nothing on exactly the platforms it
 * exists for. Two passes and no failure must still upload.
 */
async function autoUploadsAPartialCapture() {
  const env = createEnvironment({ storage: {} }); // built-in token, zero setup
  const buttons = standardButtons(env);
  loadReconStack(env);
  await sleep(20);

  // Shorten the quiet window. What is under test is that a partial capture is
  // sent at all, not how long we wait first.
  globalThis.Traverse.config.recon.idleMsNoPair = 30;

  // Two passes, no failure anywhere.
  env.click(buttons.submit);
  const submitUrl = 'https://www.hackerrank.com/rest/contests/master/challenges/solve-me/submissions';
  env.emit(reconEvent({ seq: 1, phase: 'response', url: submitUrl, method: 'POST', status: 200,
    responseBody: JSON.stringify({ status: 'Accepted', score: 1 }) }));

  env.click(buttons.run);
  const runUrl = 'https://www.hackerrank.com/rest/contests/master/challenges/solve-me/run';
  env.emit(reconEvent({ seq: 2, phase: 'response', url: runUrl, method: 'POST', status: 200,
    responseBody: JSON.stringify({ status: 'Accepted' }) }));

  // Long enough for the auto-upload (shortened above) *and* for the debounced
  // status write to land — the status record lags the controller by ~1.5s.
  await sleep(PERSIST_SETTLE_MS);

  const controller = globalThis.__traverseRecon;
  assert.strictEqual(controller.observedFlowIds().length, 2, 'two flows should be observed');
  assert.strictEqual(controller.hasPassFailPair(), false, 'there is no failing attempt in this capture');

  assert.ok(
    env.sentMessages.some((m) => m.type === 'RECON_UPLOAD'),
    'a capture with only passes must still upload — waiting for all four flows is the bug'
  );

  const status = env.localStore.recon_status;
  assert.ok(status.uploadedAt, 'a successful auto-upload should be stamped');

  // And it must not fire again for the same set of flows.
  const before = env.sentMessages.filter((m) => m.type === 'RECON_UPLOAD').length;
  await sleep(200);
  const after = env.sentMessages.filter((m) => m.type === 'RECON_UPLOAD').length;
  assert.strictEqual(after, before, 'the same capture must not be re-uploaded in a loop');
}

/* ───────────────────────────────── runner ──────────────────────────────── */

const SCENARIOS = [
  ['arms on a problem page and captures all four flows', armsAndCapturesAllFourFlows],
  ['ignores weak tokens and substring false positives', weakTokensDoNotInventVerdicts],
  ['stays off LeetCode and unmapped hosts', doesNotArmOnExcludedOrUnknownHosts],
  ['arms with the built-in token and no user setup', armsWithBuiltInTokenAndNoSetup],
  ['a stored token overrides the built-in one', storedTokenOverridesTheBuiltInOne],
  ['stays off when no token exists at all', doesNotArmWithoutAToken],
  ['stays off away from problem pages', doesNotArmOffAProblemPage],
  ['auto-uploads a partial capture with no failure', autoUploadsAPartialCapture],
  ['delegates uploads to the background worker', uploadsTheStagedBundle],
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

  if (failures > 0) {
    console.error(`\n${failures} recon scenario(s) failed.`);
    process.exit(1);
  }

  console.log(`\nAll ${SCENARIOS.length} recon scenarios passed.`);
  process.exit(0);
})();
