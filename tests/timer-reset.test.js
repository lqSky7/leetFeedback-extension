'use strict';

// Timer behavior tests: the overlay buttons' contracts.
//
// Covers the three behaviours the smoke suite does not reach (it drives the
// adapter stack, not the overlay):
//   1. Restart (↺) — restarts the clock AND wipes the problem's stored record;
//      the adapter drops its in-memory tracker state via the
//      traverse:problem-data-cleared event.
//   2. Hide — hides the overlay for the current problem only; it never
//      writes the enabled setting, returns on the next problem, and a settings
//      re-enable wins over a stale hide.
//   3. Pause (⏸) — freezes the clock but never touches the collected data.
//
// Run: node tests/timer-reset.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* ────────────────────────────── environment ────────────────────────────── */

function createElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    innerHTML: '',
    value: '',
    style: {},
    dataset: {},
    children: [],
    parentNode: null,
    disabled: false,
    _attrs: {},
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    appendChild(child) {
      child.parentNode = el;
      el.children.push(child);
      return child;
    },
    removeChild(child) {
      el.children = el.children.filter((c) => c !== child);
      child.parentNode = null;
      return child;
    },
    remove() {
      if (el.parentNode) el.parentNode.removeChild(el);
    },
    setAttribute(name, value) {
      el._attrs[name] = value;
    },
    getAttribute(name) {
      return el._attrs[name] === undefined ? null : el._attrs[name];
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(el._attrs, name);
    },
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => createElement('div'),
    querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 156, height: 38 }),
    focus() {},
  };
  return el;
}

function createEnvironment() {
  const localStore = {};
  const syncStore = {};
  const storageListeners = [];
  const windowListeners = {};

  const area = (store) => ({
    get(keys, cb) {
      let out = {};
      if (keys === null || keys === undefined) {
        out = { ...store };
      } else if (Array.isArray(keys)) {
        keys.forEach((k) => {
          if (k in store) out[k] = store[k];
        });
      } else if (typeof keys === 'string') {
        if (keys in store) out[keys] = store[keys];
      } else {
        Object.keys(keys).forEach((k) => {
          out[k] = k in store ? store[k] : keys[k];
        });
      }
      if (cb) {
        cb(out);
        return undefined;
      }
      return Promise.resolve(out);
    },
    set(items, cb) {
      Object.assign(store, items);
      if (cb) cb();
      return Promise.resolve();
    },
    remove(keys, cb) {
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]);
      if (cb) cb();
      return Promise.resolve();
    },
  });

  const document = {
    readyState: 'loading',
    hidden: false,
    title: 'Two Sum - LeetCode',
    body: createElement('body'),
    head: createElement('head'),
    documentElement: createElement('html'),
    createElement,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };

  const env = {
    localStore,
    syncStore,
    storageListeners,
    windowListeners,
    document,
    location: {
      href: 'https://leetcode.com/problems/two-sum/',
      pathname: '/problems/two-sum/',
      search: '',
      hostname: 'leetcode.com',
    },
    innerWidth: 1200,
    innerHeight: 800,
  };

  env.chrome = {
    storage: {
      local: area(localStore),
      sync: area(syncStore),
      onChanged: { addListener: (fn) => storageListeners.push(fn) },
    },
    runtime: {
      lastError: null,
      sendMessage(message, cb) {
        if (cb) cb({ success: true, status: 200, data: { message: 'Synced' } });
      },
    },
  };

  localStore.auth_token = 'test-token';
  localStore.auth_user = { id: 1, username: 'tester' };

  return env;
}

const SHARED = [
  'core/config.js',
  'core/logger.js',
  'core/util.js',
  'core/net-protocol.js',
  'core/net-bridge.js',
  'core/ai-config.js',
  'core/session-store.js',
  'core/attempt-tracker.js',
  'core/backend-api.js',
  'core/github-api.js',
  'core/submission-pipeline.js',
  'core/problem-timer.js',
  'ui/toast.js',
  'ui/hint-prompt.js',
  'core/platform-adapter.js',
];

function loadStack(env, platformFile) {
  // Fresh globals per scenario. _problemTimerInstance lives on globalThis and
  // would otherwise survive, pinning every later scenario to the first
  // scenario's env (its chrome listeners, its storage).
  for (const key of ['window', 'document', 'chrome', 'location', 'Traverse', '_problemTimerInstance']) {
    delete globalThis[key];
  }

  globalThis.window = globalThis;
  globalThis.document = env.document;
  globalThis.chrome = env.chrome;
  globalThis.location = env.location;
  globalThis.innerWidth = env.innerWidth;
  globalThis.innerHeight = env.innerHeight;

  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  // NetBridge._sendConfig pings the page world; the page interceptor is not
  // loaded in this harness, so a no-op suffices.
  globalThis.postMessage = () => {};
  // Node's globalThis is not a real EventTarget, so dispatch is faked to
  // mirror the captured addEventListener — the timer's real dispatch path
  // (resetTimer -> traverse:problem-data-cleared -> adapter handler) then
  // works end to end in tests.
  globalThis.dispatchEvent = (event) => {
    for (const fn of env.windowListeners[event && event.type] || []) fn(event);
    return true;
  };
  if (typeof globalThis.CustomEvent !== 'function') {
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, params = {}) {
        this.type = type;
        this.detail = params.detail;
      }
    };
  }
  globalThis.addEventListener = (type, fn) => {
    (env.windowListeners[type] || (env.windowListeners[type] = [])).push(fn);
  };
  globalThis.removeEventListener = () => {};

  for (const file of [...SHARED, platformFile]) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInThisContext(code, { filename: file });
  }

  globalThis.LeetFeedbackHintPrompt = { ask: async () => 'none' };
  return globalThis.Traverse;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A fresh timer state for a scenario, since the module auto-instantiates. */
let activeTimer = null;
function freshTimer(T) {
  const timer = T.ProblemTimer.getInstance();
  timer.reset();
  timer.hideOverlay();
  activeTimer = timer;
  return timer;
}

/* ──────────────────────────────── scenarios ────────────────────────────── */

async function restartClearsStoredDataAndDropsAdapterState() {
  const env = createEnvironment();
  const T = loadStack(env, 'platforms/leetcode.js');

  // A populated record — counters, attempts, code, an unsolved marker.
  env.localStore['problem_data_two-sum'] = {
    name: 'Two Sum',
    platform: 'leetcode',
    attempts: [
      {
        code: 'int main() { return 0; }',
        language: 'cpp',
        type: 'run',
        successful: false,
        timestamp: new Date().toISOString(),
      },
    ],
    runCounter: 3,
    submitCounter: 2,
    incorrectRunCounter: 1,
    code: 'int main() { return 0; }',
    solved: { value: false, date: 0, tries: 0 },
    problemStartTime: Date.now() - 60000,
    timestamp: new Date().toISOString(),
  };

  const adapter = new T.LeetCodeAdapter();
  await adapter.init();

  assert.strictEqual(adapter.tracker.runCounter, 3, 'precondition: restored run counter');
  assert.strictEqual(adapter.tracker.attempts.length, 1, 'precondition: restored attempts');

  const timer = freshTimer(T);
  await timer.startTimer('two-sum');

  const beforeStart = timer.startTime;
  await sleep(30);
  await timer.resetTimer();

  // Clock restarted.
  assert.ok(timer.startTime > beforeStart, 'restart must move startTime forward');
  assert.ok(timer.getElapsedActiveTime() < 2000, 'elapsed time must be near zero after restart');

  // Adapter in-memory state dropped via the dispatched event.
  assert.strictEqual(adapter.tracker.runCounter, 0, 'adapter tracker must reset on the clear event');
  assert.strictEqual(adapter.tracker.submitCounter, 0, 'adapter submit counter must reset');
  assert.strictEqual(adapter.tracker.attempts.length, 0, 'adapter attempts must reset');

  // Stored record: tracker data gone. The timer heartbeat re-saves a fresh
  // timer-only snapshot, which is fine — nothing of the old session survives.
  await sleep(80);
  const record = await T.sessionStore.getProblemData('two-sum');
  assert.ok(record, 'a fresh timer snapshot may exist');
  assert.strictEqual(record.runCounter, undefined, 'old run counter must be gone');
  assert.strictEqual(record.submitCounter, undefined, 'old submit counter must be gone');
  assert.strictEqual(record.attempts, undefined, 'old attempts must be gone');
  assert.strictEqual(record.code, undefined, 'old code must be gone');
  assert.strictEqual(record.solved, undefined, 'old solved marker must be gone');

  return 'restart (↺) clears the record and resets the adapter tracker';
}

async function hideButtonHidesPerProblemAndSettingsReenableWins() {
  const env = createEnvironment();
  const T = loadStack(env, 'platforms/leetcode.js');
  const timer = freshTimer(T);

  await timer.startTimer('two-sum');
  assert.ok(timer.overlay, 'precondition: overlay visible');

  timer.hideForNow();
  assert.strictEqual(timer.hiddenByUser, true, 'hide must set hiddenByUser');
  assert.strictEqual(timer.overlay, null, 'hide must remove the overlay');

  // Same problem, SPA re-render: stays hidden. The old close button's
  // disabled-setting must NOT be written either.
  await timer.startTimer('two-sum');
  assert.strictEqual(timer.hiddenByUser, true, 'same-problem start must keep the hide');
  assert.strictEqual(timer.overlay, null, 'same-problem start must not re-show');

  const syncSettings = await new Promise((r) => chrome.storage.sync.get(null, r));
  assert.strictEqual(
    syncSettings.timer_overlay_enabled,
    undefined,
    'hide must never write the enabled setting'
  );

  // A different problem: the hide never survives navigation.
  await timer.startTimer('three-sum');
  assert.strictEqual(timer.hiddenByUser, false, 'new problem clears the hide');
  assert.ok(timer.overlay, 'overlay returns on the next problem');

  // And a settings re-enable wins over a hide on the same problem.
  timer.hideForNow();
  assert.strictEqual(timer.overlay, null);
  env.storageListeners.forEach((fn) =>
    fn({ timer_overlay_enabled: { oldValue: true, newValue: true } }, 'sync')
  );
  assert.strictEqual(timer.hiddenByUser, false, 'settings re-enable clears the hide');
  assert.ok(timer.overlay, 'settings re-enable re-shows the overlay');

  return 'eye hides per problem only; setting writes are never touched';
}

async function restartWithoutProblemIsHarmless() {
  const env = createEnvironment();
  const T = loadStack(env, 'platforms/leetcode.js');
  const timer = freshTimer(T);

  // No problem tracked (e.g. reset pressed on a non-problem page) — must not
  // throw, must not clear anything else in storage.
  env.localStore['problem_data_unrelated'] = { name: 'Keep Me' };
  await timer.resetTimer();
  assert.strictEqual(timer.getElapsedActiveTime() < 2000, true, 'clock restarted');
  assert.ok(env.localStore['problem_data_unrelated'], 'unrelated records survive');

  return 'restart with no tracked problem is a no-op';
}

async function pauseTouchesTimeOnly() {
  const env = createEnvironment();
  const T = loadStack(env, 'platforms/leetcode.js');
  const timer = freshTimer(T);

  await timer.startTimer('p1');
  await T.sessionStore.setProblemData('p1', {
    attempts: [{ code: 'x'.repeat(20), language: 'cpp', type: 'run', successful: false }],
  });

  await sleep(30);
  const before = timer.getElapsedActiveTime();
  await timer.pauseTimer();

  await sleep(90);
  const during = timer.getElapsedActiveTime();
  assert.ok(
    Math.abs(during - before) <= 50,
    `clock must be frozen while paused (moved ${during - before}ms)`
  );

  // The collected data must be untouched by pausing.
  const record = await T.sessionStore.getProblemData('p1');
  assert.ok(record.attempts && record.attempts.length === 1, 'attempts survive a pause');
  assert.ok(record.pausedTime >= 0, 'paused time is recorded alongside the data');

  await timer.resumeTimer();
  await sleep(90);
  assert.ok(timer.getElapsedActiveTime() > during, 'clock runs again after resume');

  return 'pause freezes the clock and never touches collected data';
}

/* ───────────────────────────────── runner ──────────────────────────────── */

const SCENARIOS = [
  ['restart clears stored data and drops adapter state', restartClearsStoredDataAndDropsAdapterState],
  ['hide hides per problem; settings re-enable wins', hideButtonHidesPerProblemAndSettingsReenableWins],
  ['restart with no tracked problem is a no-op', restartWithoutProblemIsHarmless],
  ['pause touches time only', pauseTouchesTimeOnly],
];

(async () => {
  let failures = 0;

  for (const [name, run] of SCENARIOS) {
    try {
      const note = await run();
      console.log(`  ok  ${name}${note ? ` — ${note}` : ''}`);
    } catch (error) {
      failures += 1;
      console.error(`  FAIL ${name}`);
      console.error(`       ${error && error.stack ? error.stack : error}`);
    } finally {
      // startTimer arms a 1s display interval; without this the process
      // would never exit.
      if (activeTimer) {
        activeTimer.hideOverlay();
        activeTimer = null;
      }
    }
  }

  console.log('');
  if (failures > 0) {
    console.error(`${failures} timer scenario(s) failed.`);
    process.exit(1);
  }
  console.log(`All ${SCENARIOS.length} timer scenarios passed.`);
})();
