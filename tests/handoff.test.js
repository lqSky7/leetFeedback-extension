'use strict';

// Regression harness for the timer-pill <-> submission-card hand-off.
//
// The morph is pure geometry: the card keeps its final box and a FLIP transform
// stretches it back over the box the pill left, so the two read as one shape
// changing. None of that is observable in the smoke harness (its fake DOM has
// no `animate` and returns one rect for every element), so this file stands up
// a DOM that does have both and pins:
//
//   - the pill is parked (detached, still counting) when a submission starts;
//   - the card's first frame lands exactly on the pill's box, and its last
//     frame on its own;
//   - the glyph is held back while the box is stretched;
//   - a failed submission scales the card back into a rebuilt pill;
//   - a successful sync hands the pill back too, so the corner is never lost.
//
// Run: node tests/handoff.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/* ────────────────────────────── environment ────────────────────────────── */

// The two boxes the morph interpolates between. The pill sits where
// ProblemTimer parks it by default; the card where `.lfb-card.lfb-fixed` puts
// itself (bottom/right 24px) inside a 1200x800 viewport.
const PILL_RECT = { left: 980, top: 680, width: 219, height: 38 };
const CARD_RECT = { left: 1064, top: 664, width: 112, height: 112 };
const DEFAULT_RECT = { left: 0, top: 0, width: 156, height: 38 };

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
    _classes: new Set(),
    _anims: [],
    _qs: {},
    classList: {
      add(...names) {
        names.forEach((n) => el._classes.add(n));
      },
      remove(...names) {
        names.forEach((n) => el._classes.delete(n));
      },
      contains: (name) => el._classes.has(name),
    },
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
    focus() {},
    // Stable per selector, so a node the code styles twice is the node the test
    // reads. Real innerHTML parsing is out of scope here.
    querySelector(selector) {
      if (!el._qs[selector]) el._qs[selector] = createElement('div');
      return el._qs[selector];
    },
    querySelectorAll: () => [],
    getBoundingClientRect() {
      if (el.id === 'leetfeedback-timer-overlay') return { ...PILL_RECT };
      if (el._classes.has('leetfeedback-submission-card')) return { ...CARD_RECT };
      return { ...DEFAULT_RECT };
    },
    /**
     * Web Animations, recorded rather than played. `finished` resolves on a
     * microtask so the code under test walks its settle path immediately.
     */
    animate(keyframes, options) {
      const record = { keyframes, options };
      el._anims.push(record);
      return {
        finished: Promise.resolve(),
        cancel() {
          record.cancelled = true;
        },
      };
    },
  };
  return el;
}

function createQuerySelectorMap() {
  return {
    '.text-title-large': { textContent: '1. Two Sum' },
    '[data-mode-id]': { getAttribute: () => 'cpp', textContent: '' },
    '.text-difficulty-easy, .text-difficulty-medium, .text-difficulty-hard': { textContent: 'Easy' },
    '[class*="text-difficulty"]': { textContent: 'Easy' },
    '[class*="difficulty"]': { textContent: 'Easy' },
  };
}

function createEnvironment() {
  const localStore = { auth_token: 'test-token', auth_user: { id: 1, username: 'tester' } };
  const syncStore = {};
  const storageListeners = [];

  const area = (store) => ({
    get(keys, cb) {
      let out = {};
      if (keys === null || keys === undefined) out = { ...store };
      else if (Array.isArray(keys)) keys.forEach((k) => { if (k in store) out[k] = store[k]; });
      else if (typeof keys === 'string') { if (keys in store) out[keys] = store[keys]; }
      else Object.keys(keys).forEach((k) => { out[k] = k in store ? store[k] : keys[k]; });
      if (cb) { cb(out); return undefined; }
      return Promise.resolve(out);
    },
    set(items, cb) {
      const changes = {};
      Object.keys(items).forEach((k) => {
        changes[k] = { oldValue: store[k], newValue: items[k] };
        store[k] = items[k];
      });
      storageListeners.forEach((fn) => fn(changes, store === syncStore ? 'sync' : 'local'));
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
    querySelector(selector) {
      return createQuerySelectorMap()[selector] || null;
    },
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
  };

  return {
    document,
    location: {
      href: 'https://leetcode.com/problems/two-sum/',
      pathname: '/problems/two-sum/',
      search: '',
      hostname: 'leetcode.com',
    },
    innerWidth: 1200,
    innerHeight: 800,
    chrome: {
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
    },
  };
}

/* ─────────────────────────────── load stack ─────────────────────────────── */

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

// Every singleton the stack pins on `window` (= globalThis here). A stale
// ProblemTimer would make scenario two assert against scenario one's overlay.
const GLOBALS = [
  'window',
  'document',
  'chrome',
  'location',
  'Traverse',
  '_problemTimerInstance',
  'ProblemTimer',
  'LeetFeedbackToast',
  'LeetFeedbackHintPrompt',
  '__traverseAdapter_leetcode',
];

function loadStack(env) {
  GLOBALS.forEach((key) => delete globalThis[key]);

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
  // No window listeners and no MAIN-world bridge: the adapter's code read falls
  // through to its own timeout. This harness only cares about the overlay.
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.postMessage = () => {};

  [...SHARED, 'platforms/leetcode.js'].forEach((file) => {
    vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
  });

  // The hint prompt is UI; stub it so it cannot open a countdown.
  globalThis.LeetFeedbackHintPrompt = { ask: async () => 'none' };

  return globalThis.Traverse;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const inBody = (id) => globalThis.document.body.children.some((el) => el.id === id);
const boxOf = (el) => globalThis.Traverse.util.rectOf(el.getBoundingClientRect());

/** The overlay is built by an async startTimer, so wait for it to land. */
async function waitForOverlay(timer) {
  for (let i = 0; i < 40 && !timer.overlay; i++) await sleep(25);
  return timer.overlay;
}

/* ──────────────────────────────── scenarios ─────────────────────────────── */

async function pillHandsOverToTheCard() {
  const env = createEnvironment();
  const T = loadStack(env);

  const adapter = new T.LeetCodeAdapter();
  await adapter.init();

  const timer = T.ProblemTimer.getInstance();
  assert.ok(await waitForOverlay(timer), 'the pill is on screen before the submission');
  const pillBox = boxOf(timer.overlay);

  const tracker = window.LeetFeedbackToast.createSubmission();

  assert.strictEqual(timer.isParked, true, 'the pill is parked for the hand-off');
  assert.ok(timer.displayIntervalId, 'the clock keeps running while parked');
  assert.ok(tracker.morphFrom, 'the card owns the pill box it grew out of');

  const card = tracker.card;
  const cardBox = boxOf(card);

  assert.strictEqual(card._anims.length, 2, 'one shape morph, one opacity swap');

  const shape = card._anims[0];
  assert.strictEqual(
    shape.keyframes[0].transform,
    T.util.morphTransform(pillBox, cardBox),
    'the card starts exactly over the pill'
  );
  assert.strictEqual(shape.keyframes[1].transform, 'none', '...and lands on its own box');
  assert.strictEqual(shape.options.duration, 460, 'the morph is the hand-off duration');

  const swap = card._anims[1];
  assert.deepStrictEqual(
    swap.keyframes.map((k) => k.opacity),
    [0, 1],
    'the card fades in under the pill'
  );
  assert.ok(
    swap.options.duration < shape.options.duration,
    'the swap finishes early, while the two boxes still coincide'
  );

  assert.strictEqual(
    card.querySelector('.lfb-stage').style.opacity,
    '0',
    'the glyph is held back while the box is stretched'
  );

  // The pill stays in the DOM for the length of its fade, then goes.
  await sleep(280);
  assert.strictEqual(inBody('leetfeedback-timer-overlay'), false, 'the pill leaves the DOM');
  assert.strictEqual(timer.overlay, null, 'and the timer lets go of it');

  return 'submission -> the pill is parked and the card grows out of its box';
}

async function failedCrossScalesBackIntoThePill() {
  const env = createEnvironment();
  const T = loadStack(env);

  const adapter = new T.LeetCodeAdapter();
  await adapter.init();

  const timer = T.ProblemTimer.getInstance();
  assert.ok(await waitForOverlay(timer), 'the pill is on screen before the submission');
  const pillBox = boxOf(timer.overlay);

  const tracker = window.LeetFeedbackToast.createSubmission();
  const card = tracker.card;
  const cardBox = boxOf(card);

  await sleep(280);
  assert.strictEqual(inBody('leetfeedback-timer-overlay'), false, 'the pill is gone while judging');

  // Rejected verdict.
  tracker.fail('Wrong Answer');
  await sleep(700);
  assert.strictEqual(tracker.phase, 'failed', 'the cross is up');
  assert.ok(card._classes.has('lfb-fail'), 'and the error panel is revealed');

  // The cross rests, then the card scales back into a rebuilt pill.
  await sleep(4000);

  const outShape = card._anims.find((a) => a.keyframes.length === 2 && a.keyframes[0].transform === 'none');
  assert.ok(outShape, 'the card animates back out of its own box');
  assert.strictEqual(
    outShape.keyframes[1].transform,
    T.util.morphTransform(pillBox, cardBox),
    'and lands exactly on the pill box'
  );

  const outFade = card._anims.find((a) => a.keyframes.length === 3);
  assert.deepStrictEqual(
    outFade.keyframes.map((k) => k.opacity),
    [1, 1, 0],
    'the card holds opaque until it lands, then hands the corner over'
  );

  assert.strictEqual(timer.isParked, false, 'the pill is un-parked');
  assert.ok(timer.overlay, 'the pill was rebuilt');
  assert.strictEqual(inBody('leetfeedback-timer-overlay'), true, 'and is on screen again');
  assert.strictEqual(tracker.morphFrom, null, 'the card no longer owns the corner');

  return 'failed submission -> the cross scales back into the timer pill';
}

async function successfulSyncHandsThePillBack() {
  const env = createEnvironment();
  const T = loadStack(env);

  const adapter = new T.LeetCodeAdapter();
  await adapter.init();

  const timer = T.ProblemTimer.getInstance();
  assert.ok(await waitForOverlay(timer), 'the pill starts on screen');

  const tracker = window.LeetFeedbackToast.createSubmission();
  assert.strictEqual(inBody('leetfeedback-timer-overlay'), true, 'the pill lingers only for its fade');

  tracker.succeed('Synced');
  await sleep(3400);

  assert.ok(tracker.isDismissed, 'the synced card dismissed itself');
  assert.strictEqual(timer.isParked, false, 'the pill is un-parked');
  assert.strictEqual(inBody('leetfeedback-timer-overlay'), true, 'and the corner is handed back');

  return 'successful sync -> the pill returns, the corner is never lost';
}

async function fallsBackWhenThereIsNoPill() {
  const env = createEnvironment();
  const T = loadStack(env);

  const adapter = new T.LeetCodeAdapter();
  await adapter.init();

  const timer = T.ProblemTimer.getInstance();
  await waitForOverlay(timer);
  timer.hideOverlay();
  assert.strictEqual(timer.overlay, null, 'no pill on screen');

  const tracker = window.LeetFeedbackToast.createSubmission();
  assert.strictEqual(tracker.morphFrom, null, 'no box to morph out of');
  assert.strictEqual(tracker.card._anims.length, 0, 'so the card keeps its slide-in entrance');
  assert.ok(tracker.card._classes.has('lfb-hidden'), 'which starts hidden');

  await sleep(60);
  assert.ok(!tracker.card._classes.has('lfb-hidden'), 'and slides in as before');

  return 'no timer overlay -> the card falls back to its slide-in entrance';
}

/* ───────────────────────────────── runner ───────────────────────────────── */

const SCENARIOS = [
  pillHandsOverToTheCard,
  failedCrossScalesBackIntoThePill,
  successfulSyncHandsThePillBack,
  fallsBackWhenThereIsNoPill,
];

(async () => {
  let failed = 0;

  for (const scenario of SCENARIOS) {
    try {
      const label = await scenario();
      console.log(`  ok  ${label}`);
    } catch (error) {
      failed++;
      console.error(`FAIL  ${scenario.name}`);
      console.error(`      ${error.message}`);
    }
  }

  console.log('');
  if (failed > 0) {
    console.error(`${failed}/${SCENARIOS.length} scenario(s) failed`);
    process.exit(1);
  }
  console.log(`All ${SCENARIOS.length} hand-off scenarios passed.`);
  process.exit(0);
})();
