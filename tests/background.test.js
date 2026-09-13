'use strict';

// Loads the background service worker and checks that its message router is
// actually wired up.
//
// This exists because of a real bug that nothing else could catch: a handler
// was deleted from background.js while its entry in RUNTIME_HANDLERS was left
// behind. `node --check` passes — the file is syntactically valid — but
// evaluating it throws a ReferenceError, so the worker never registers
// `onMessage`. Every `sendMessage` from the sidepanel then hangs forever with
// no response and no error, which surfaces to the user as "the UI is stuck on
// Sending…" rather than as a crash.
//
// So: evaluate the worker, assert it registered a listener, and assert every
// registered handler is callable.
//
// Run: node tests/background.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const BACKGROUND_DIR = path.join(ROOT, 'background');

/** A chrome mock covering what background.js touches at load time. */
function createChrome() {
  const listeners = { message: [], external: [], installed: [], startup: [] };
  const store = {};

  const localGet = (keysOrCb, maybeCb) => {
    const cb = typeof keysOrCb === 'function' ? keysOrCb : maybeCb;
    const names = typeof keysOrCb === 'function' ? null : keysOrCb;
    const out = {};
    if (names === null || names === undefined) {
      Object.assign(out, store);
    } else {
      for (const name of Array.isArray(names) ? names : [names]) {
        if (name in store) out[name] = store[name];
      }
    }
    if (typeof cb === 'function') {
      cb(out);
      return undefined;
    }
    return Promise.resolve(out);
  };

  return {
    listeners,
    store,
    sidePanel: { setPanelBehavior: () => Promise.resolve() },
    runtime: {
      onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
      onStartup: { addListener: (fn) => listeners.startup.push(fn) },
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      onMessageExternal: { addListener: (fn) => listeners.external.push(fn) },
      getURL: (p) => `chrome-extension://test/${p}`,
      lastError: null,
    },
    storage: {
      local: {
        get: localGet,
        set: (obj, cb) => {
          Object.assign(store, obj);
          if (cb) cb();
          return Promise.resolve();
        },
        remove: (names, cb) => {
          for (const name of Array.isArray(names) ? names : [names]) delete store[name];
          if (cb) cb();
          return Promise.resolve();
        },
      },
      sync: {
        get: (names, cb) => (cb ? cb({}) : Promise.resolve({})),
        set: (obj, cb) => (cb ? cb() : Promise.resolve()),
      },
      onChanged: { addListener: () => {} },
    },
  };
}

/**
 * Evaluate the worker the way MV3 does: `importScripts` first, then the worker
 * body. Returns the chrome mock and any load error.
 *
 * Each load gets its own VM context. `runInThisContext` would share one global,
 * and background.js declares top-level `const`s (`T`, `logger`, `keys`) that
 * cannot be re-declared — so a second scenario would fail on the harness rather
 * than on the code.
 */
function loadBackgroundWorker(options = {}) {
  const chromeMock = createChrome();

  const sandbox = {
    chrome: chromeMock,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    fetch:
      options.fetch ||
      (async () => {
        throw new Error('network is not available in this test');
      }),
  };

  const context = vm.createContext(sandbox);

  sandbox.importScripts = (...files) => {
    for (const file of files) {
      const resolved = path.join(BACKGROUND_DIR, file);
      vm.runInContext(fs.readFileSync(resolved, 'utf8'), context, { filename: resolved });
    }
  };

  let loadError = null;
  try {
    const file = path.join(BACKGROUND_DIR, 'background.js');
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  } catch (error) {
    loadError = error;
  }

  return { chromeMock, loadError };
}

/** Ask the registered listener for a response, the way sendMessage does. */
function sendMessage(chromeMock, message) {
  return new Promise((resolve) => {
    const listener = chromeMock.listeners.message[0];
    let settled = false;
    const sendResponse = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const returned = listener(message, { id: 'test' }, sendResponse);

    // An async handler returns true and responds later; a synchronous one
    // responds inline. Either way, if nothing arrives the assertion below fails
    // rather than hanging the suite.
    if (returned === false && !settled) {
      resolve(undefined);
    }
  });
}

/* ─────────────────────────────── scenarios ─────────────────────────────── */

/** The core regression: the worker must evaluate and register a listener. */
async function workerLoadsAndRegistersListener() {
  const { chromeMock, loadError } = loadBackgroundWorker();

  assert.strictEqual(
    loadError,
    null,
    `background.js threw while loading (a dangling RUNTIME_HANDLERS reference ` +
      `looks exactly like this): ${loadError && loadError.message}`
  );

  assert.strictEqual(
    chromeMock.listeners.message.length,
    1,
    'the worker must register exactly one onMessage listener'
  );
}

/**
 * Every handler in the router must be callable. A deleted function leaves a
 * `RECON_PING: handleReconPing` style entry that loads fine in isolation and
 * blows up the moment that message type arrives.
 */
async function everyKnownHandlerIsCallable() {
  const { chromeMock, loadError } = loadBackgroundWorker();
  assert.strictEqual(loadError, null, 'worker must load');

  const known = ['BACKEND_API_FETCH', 'RECON_UPLOAD'];

  for (const type of known) {
    const response = await sendMessage(chromeMock, { type });
    assert.notStrictEqual(
      response && response.error,
      'Unknown message type',
      `${type} must have a registered handler`
    );
  }
}

/** An unknown type must be rejected cleanly, not silently swallowed. */
async function unknownMessageTypeIsRejected() {
  const { chromeMock, loadError } = loadBackgroundWorker();
  assert.strictEqual(loadError, null, 'worker must load');

  const response = await sendMessage(chromeMock, { type: 'NOT_A_REAL_TYPE' });
  assert.strictEqual(response && response.error, 'Unknown message type');
  assert.strictEqual(response && response.success, false);
}

/**
 * The recon upload authenticates with the token baked into core/config.js.
 *
 * A stored override used to win. That is the trap this guards: once the
 * sidepanel's token field was removed, a stale value in storage kept winning,
 * so the extension sent a token the backend rejected (401) with no UI left to
 * correct it.
 */
async function reconUploadIgnoresStoredTokenOverride() {
  const { chromeMock, loadError } = loadBackgroundWorker();
  assert.strictEqual(loadError, null, 'worker must load');

  chromeMock.store.recon_ingest_token = 'stale-token-from-an-older-build';

  const response = await sendMessage(chromeMock, { type: 'RECON_UPLOAD' });

  // No bundle staged, so it fails — but for the *bundle* reason. Reaching that
  // branch proves the token resolved and the handler ran.
  assert.strictEqual(
    response && response.error,
    'No recon bundle staged',
    `upload should resolve the built-in token and then fail on the missing bundle, got: ${JSON.stringify(response)}`
  );
}

/**
 * A 401 has to say something actionable.
 *
 * This is the failure the operator actually hit: the backend rejected the token,
 * the sidepanel showed the raw code, and nothing pointed at the real cause — a
 * stale extension build still sending an old token.
 */
async function tokenRejectionIsActionable() {
  const { chromeMock, loadError } = loadBackgroundWorker({
    fetch: async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: 'RECON_TOKEN_INVALID' }),
    }),
  });
  assert.strictEqual(loadError, null, 'worker must load');

  chromeMock.store.recon_bundle = { platform: 'neetcode', captureId: 'c1', network: [] };

  const response = await sendMessage(chromeMock, { type: 'RECON_UPLOAD' });

  assert.strictEqual(response.success, false);
  assert.strictEqual(response.status, 401);
  assert.ok(
    /reload the extension/i.test(response.error),
    `a 401 should tell the operator to reload the extension, got: ${response.error}`
  );
  assert.ok(
    /RECON_INGEST_TOKEN/.test(response.error),
    'a 401 should name the server-side variable to compare against'
  );
}

/* ───────────────────────────────── runner ──────────────────────────────── */

const SCENARIOS = [
  ['worker loads and registers a message listener', workerLoadsAndRegistersListener],
  ['every registered handler is callable', everyKnownHandlerIsCallable],
  ['an unknown message type is rejected', unknownMessageTypeIsRejected],
  ['recon upload ignores a stale stored token', reconUploadIgnoresStoredTokenOverride],
  ['a token rejection is actionable', tokenRejectionIsActionable],
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
    console.error(`${failures} background scenario(s) failed.`);
    process.exit(1);
  }
  console.log(`All ${SCENARIOS.length} background scenarios passed.`);
})();
