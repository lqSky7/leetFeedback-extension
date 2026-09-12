'use strict';

// Smoke harness for the content-script stack.
//
// There is no build step and no test runner, so this file stands up a minimal
// browser/extension environment in Node, loads core/ + platforms/ in exactly the
// order manifest.json declares, and drives simulated submissions end to end.
//
// It catches wiring mistakes that a syntax check cannot: a missing T.* module, a
// renamed method, a broken capture -> verdict -> pipeline hand-off.
//
// Run: node tests/smoke.test.js

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
    classList: { add() {}, remove() {}, contains: () => false },
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

/** Selector -> fake element. Only the selectors the adapters actually use. */
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
  const localStore = {};
  const syncStore = {};
  const sentMessages = [];
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

  const env = {
    localStore,
    syncStore,
    sentMessages,
    storageListeners,
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

  const chrome = {
    storage: {
      local: area(localStore),
      sync: area(syncStore),
      onChanged: { addListener: (fn) => storageListeners.push(fn) },
    },
    runtime: {
      lastError: null,
      sendMessage(message, cb) {
        sentMessages.push(message);
        if (cb) cb({ success: true, status: 200, data: { message: 'Synced' } });
      },
    },
  };

  env.chrome = chrome;

  // Sign the harness in, otherwise BackendAPI refuses to push and the scenarios
  // would pass while testing nothing.
  localStore.auth_token = 'test-token';
  localStore.auth_user = { id: 1, username: 'tester' };

  return env;
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

function loadStack(env, platformFile) {
  // Fresh globals for each scenario.
  for (const key of ['window', 'document', 'chrome', 'location', 'Traverse']) {
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
  globalThis.addEventListener = (type, fn) => {
    (env.windowListeners || (env.windowListeners = {}))[type] ||= [];
    env.windowListeners[type].push(fn);
  };
  globalThis.removeEventListener = () => {};

  // Let the Monaco bridge answer code requests so extraction never blocks.
  globalThis.postMessage = (message) => {
    if (!message || message.type !== 'LEETFEEDBACK_REQUEST_CODE') return;
    setImmediate(() => {
      (env.windowListeners && env.windowListeners.message ? env.windowListeners.message : []).forEach(
        (fn) =>
          fn({
            source: globalThis,
            data: {
              source: 'LeetFeedback',
              type: 'LEETFEEDBACK_CODE',
              requestId: message.requestId,
              code: 'int main() { return 0; }',
              language: 'cpp',
            },
          })
      );
    });
  };

  const files = [...SHARED, platformFile];
  for (const file of files) {
    const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
    vm.runInThisContext(code, { filename: file });
  }

  // The hint prompt is UI. Stub it *after* loading, because ui/hint-prompt.js
  // installs the real instance on window and would otherwise run its countdown.
  globalThis.LeetFeedbackHintPrompt = { ask: async () => 'none' };

  // The extension's logger is silent unless debug_mode is on; surface it when
  // diagnosing a failure with SMOKE_DEBUG=1.
  if (process.env.SMOKE_DEBUG) globalThis.Traverse.logger.setDebugMode(true);

  return globalThis.Traverse;
}

/** Build an adapter instance for the loaded platform, without startPlatform. */
function makeAdapter(T, AdapterClass) {
  const adapter = new AdapterClass();
  return adapter;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ──────────────────────────────── scenarios ─────────────────────────────── */

async function leetcodeAccepted() {
  const env = createEnvironment();
  const T = loadStack(env, 'platforms/leetcode.js');

  for (const name of [
    'PlatformAdapter',
    'AttemptTracker',
    'sessionStore',
    'submissionPipeline',
    'NetBridge',
    'ProblemTimer',
    'BackendAPI',
    'GitHubAPI',
  ]) {
    assert.ok(T[name], `core module missing after load: T.${name}`);
  }

  const adapter = makeAdapter(T, T.LeetCodeAdapter);
  await adapter.init();

  assert.strictEqual(adapter.isProblemPage(), true, 'leetcode: /problems/ should be a problem page');
  assert.strictEqual(adapter.getCurrentProblemKey(), 'two-sum', 'leetcode: slug key');

  // The site submits: request carries the code, response carries the id.
  await adapter.onNetEvent({
    phase: 'request',
    url: 'https://leetcode.com/problems/two-sum/submit/',
    method: 'POST',
    requestBody: { lang: 'cpp', typed_code: 'class Solution { public: int x; };' },
  });
  assert.strictEqual(adapter.tracker.submitCounter, 1, 'leetcode: submit recorded');
  assert.strictEqual(adapter.tracker.attempts.length, 1, 'leetcode: attempt stored');

  await adapter.onNetEvent({
    phase: 'response',
    url: 'https://leetcode.com/problems/two-sum/submit/',
    method: 'POST',
    response: { submission_id: 42 },
  });
  assert.strictEqual(adapter.currentSubmissionId, 42, 'leetcode: submission id captured');

  // Verdict.
  await adapter.onNetEvent({
    phase: 'response',
    url: 'https://leetcode.com/submissions/detail/42/check/',
    method: 'GET',
    response: {
      state: 'SUCCESS',
      status_code: 10,
      status_msg: 'Accepted',
      run_success: true,
      total_correct: 5,
      total_testcases: 5,
      status_runtime: '40 ms',
      status_memory: '16 MB',
      runtime_percentile: 88.5,
    },
  });

  await sleep(2600); // completeSubmission waits 2s for stats to render

  const record = await T.sessionStore.getProblemData('two-sum');
  assert.ok(record, 'leetcode: problem record written');
  assert.strictEqual(record.solved.value, true, 'leetcode: stored as solved');
  assert.strictEqual(record.platform, 'leetcode');
  assert.strictEqual(record.name, 'Two Sum', 'leetcode: title extracted');
  assert.strictEqual(record.difficulty, 0, 'leetcode: difficulty normalized to easy');

  const push = env.sentMessages.find((m) => m.type === 'BACKEND_API_FETCH');
  assert.ok(push, 'leetcode: backend push attempted');
  assert.ok(push.url.endsWith('/api/submissions'), 'leetcode: push URL');

  const payload = JSON.parse(push.options.body);
  assert.strictEqual(payload.platform, 'leetcode');
  assert.strictEqual(payload.problemTitle, 'Two Sum');
  assert.strictEqual(payload.problemSlug, 'two-sum');
  assert.strictEqual(payload.difficulty, 'easy');
  assert.strictEqual(payload.outcome, 'accepted');
  assert.strictEqual(payload.assistanceLevel, 'none', 'leetcode: hint answer rides along');
  assert.strictEqual(payload.shouldAnalyzeWithAI, true, 'leetcode: analysis on by default');
  assert.ok(payload.numberOfTries >= 1, 'leetcode: tries reported');
  assert.strictEqual(payload.attempts.length, 1, 'leetcode: attempts reported');
  assert.ok(payload.idempotencyKey.startsWith('two-sum-'), 'leetcode: idempotency key');

  assert.strictEqual(adapter.tracker.submitCounter, 0, 'leetcode: tracker reset after push');

  return 'LeetCode accepted submit -> backend payload';
}

async function leetcodeRejectedThenFlag() {
  const env = createEnvironment();
  const T = loadStack(env, 'platforms/leetcode.js');

  const adapter = makeAdapter(T, T.LeetCodeAdapter);
  await adapter.init();

  await adapter.onNetEvent({
    phase: 'request',
    url: 'https://leetcode.com/problems/two-sum/submit/',
    method: 'POST',
    requestBody: { lang: 'cpp', typed_code: 'class Solution { public: int broken; };' },
  });
  await adapter.onNetEvent({
    phase: 'response',
    url: 'https://leetcode.com/problems/two-sum/submit/',
    method: 'POST',
    response: { submission_id: 7 },
  });
  await adapter.onNetEvent({
    phase: 'response',
    url: 'https://leetcode.com/submissions/detail/7/check/',
    method: 'GET',
    response: { state: 'SUCCESS', status_code: 11, status_msg: 'Wrong Answer', run_success: true },
  });

  assert.strictEqual(adapter.tracker.incorrectRunCounter, 1, 'leetcode: failure counted');
  assert.strictEqual(
    adapter.tracker.shouldAnalyzeWithGemini,
    true,
    'leetcode: analysis flag stays on (intentional default)'
  );
  assert.strictEqual(adapter.tracker.submissionInProgress, false, 'leetcode: lock released on rejection');
  assert.strictEqual(
    env.sentMessages.filter((m) => m.type === 'BACKEND_API_FETCH').length,
    0,
    'leetcode: rejected submit does not push'
  );

  return 'LeetCode rejected submit -> failure counted, no push';
}

async function leetcodeRun() {
  const env = createEnvironment();
  const T = loadStack(env, 'platforms/leetcode.js');

  const adapter = makeAdapter(T, T.LeetCodeAdapter);
  await adapter.init();

  await adapter.onNetEvent({
    phase: 'request',
    url: 'https://leetcode.com/problems/two-sum/interpret_solution/',
    method: 'POST',
    requestBody: { lang: 'cpp', typed_code: 'class Solution { public: int y; };' },
  });
  await adapter.onNetEvent({
    phase: 'response',
    url: 'https://leetcode.com/problems/two-sum/interpret_solution/',
    method: 'POST',
    response: { interpret_id: 'abc' },
  });
  await adapter.onNetEvent({
    phase: 'response',
    url: 'https://leetcode.com/submissions/detail/abc/check/',
    method: 'GET',
    response: { state: 'SUCCESS', run_success: true, correct_answer: true },
  });

  assert.strictEqual(adapter.tracker.runCounter, 1, 'leetcode: run counted');
  assert.strictEqual(adapter.tracker.incorrectRunCounter, 0, 'leetcode: successful run not a failure');

  return 'LeetCode run -> counted, not a failure';
}

async function takeuforwardVerdict() {
  const env = createEnvironment();
  const T = loadStack(env, 'platforms/takeuforward.js');

  env.location.href = 'https://takeuforward.org/plus/dsa/problems/two-sum?category=arrays';
  env.location.pathname = '/plus/dsa/problems/two-sum';
  env.location.search = '?category=arrays';

  const adapter = makeAdapter(T, T.TakeUforwardAdapter);
  await adapter.init();

  assert.strictEqual(adapter.isProblemPage(), true, 'tuf: /plus/.../problems/<slug> is a problem page');
  assert.strictEqual(
    adapter.getCurrentProblemKey(),
    'https://takeuforward.org/plus/dsa/problems/two-sum',
    'tuf: keyed by URL without query'
  );

  const submitUrl = 'https://backend-go.takeuforward.org/api/v1/plus/judge/submit';
  await adapter.onNetEvent({
    phase: 'request',
    url: submitUrl,
    method: 'POST',
    requestBody: { language: 'cpp', usercode: 'int main() { return 0; }', problem_id: 99 },
  });
  assert.strictEqual(adapter.tracker.submitCounter, 1, 'tuf: submit recorded from request body');

  const checkUrl = 'https://backend-go.takeuforward.org/api/v1/plus/judge/check-submit';
  await adapter.onNetEvent({
    phase: 'response',
    url: checkUrl,
    method: 'GET',
    response: { success: true, data: { status: 'judging' } },
  });
  assert.strictEqual(adapter.tracker.submissionInProgress, true, 'tuf: pending status ignored');

  await adapter.onNetEvent({
    phase: 'response',
    url: checkUrl,
    method: 'GET',
    response: {
      success: true,
      data: { status: 'Accepted', total_test_cases: 10, passed_test_cases: 10, time: '0.12', memory: 5.1 },
    },
  });

  await sleep(2600);

  const push = env.sentMessages.find((m) => m.type === 'BACKEND_API_FETCH');
  assert.ok(push, 'tuf: backend push attempted');
  const payload = JSON.parse(push.options.body);
  assert.strictEqual(payload.platform, 'takeuforward');
  assert.strictEqual(payload.outcome, 'accepted');
  assert.strictEqual(payload.topic, 'Arrays', 'tuf: topic from ?category=');

  return 'TakeUforward network verdict -> push (pending statuses ignored)';
}

async function geeksforgeeksDomPath() {
  const env = createEnvironment();
  const T = loadStack(env, 'platforms/geeksforgeeks.js');

  const adapter = makeAdapter(T, T.GeeksforGeeksAdapter);

  assert.strictEqual(
    T.config.domVerdictFallback.geeksforgeeks,
    true,
    'gfg: DOM fallback enabled while network rules are unverified'
  );

  // No network filters configured, so the DOM path must take the attempt.
  const took = await adapter.captureFromDom('submit', 'int main() { return 0; }', 'cpp');
  assert.strictEqual(took, true, 'gfg: DOM capture records when the network saw nothing');
  assert.strictEqual(adapter.tracker.submitCounter, 1, 'gfg: submit recorded via DOM');

  // Once the network has captured it, the DOM path must stand down.
  adapter._netCaptureAt.submit = Date.now();
  const skipped = await adapter.captureFromDom('submit', 'int main() { return 0; }', 'cpp');
  assert.strictEqual(skipped, false, 'gfg: DOM capture stands down when the network won');
  assert.strictEqual(adapter.tracker.submitCounter, 1, 'gfg: no double record');

  // And with the fallback switched off, the DOM path is retired.
  T.config.domVerdictFallback.geeksforgeeks = false;
  const disabled = await adapter.captureFromDom('run', 'int main() { return 0; }', 'cpp');
  assert.strictEqual(disabled, false, 'gfg: DOM capture retired when the fallback is off');
  T.config.domVerdictFallback.geeksforgeeks = true;

  return 'GeeksforGeeks DOM fallback -> records, stands down, and retires';
}

async function pipelineRetriesOnBackendFailure() {
  const env = createEnvironment();
  const T = loadStack(env, 'platforms/leetcode.js');

  // Make the backend push fail.
  env.chrome.runtime.sendMessage = (message, cb) => {
    env.sentMessages.push(message);
    if (cb) cb({ success: false, status: 500, error: 'boom' });
  };

  const adapter = makeAdapter(T, T.LeetCodeAdapter);
  await adapter.init();

  await adapter.onNetEvent({
    phase: 'request',
    url: 'https://leetcode.com/problems/two-sum/submit/',
    method: 'POST',
    requestBody: { lang: 'cpp', typed_code: 'class Solution { public: int z; };' },
  });
  await adapter.onNetEvent({
    phase: 'response',
    url: 'https://leetcode.com/problems/two-sum/submit/',
    method: 'POST',
    response: { submission_id: 1 },
  });
  await adapter.onNetEvent({
    phase: 'response',
    url: 'https://leetcode.com/submissions/detail/1/check/',
    method: 'GET',
    response: { state: 'SUCCESS', status_code: 10, status_msg: 'Accepted', run_success: true },
  });

  await sleep(2600);

  assert.strictEqual(adapter.tracker.submitCounter, 1, 'failure: tracking state preserved for retry');
  assert.ok(adapter.tracker.attempts.length >= 1, 'failure: attempts preserved');

  return 'Backend failure -> tracking state preserved for the next solve';
}

/* ───────────────────────────────── runner ───────────────────────────────── */

const SCENARIOS = [
  leetcodeAccepted,
  leetcodeRejectedThenFlag,
  leetcodeRun,
  takeuforwardVerdict,
  geeksforgeeksDomPath,
  pipelineRetriesOnBackendFailure,
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
  console.log(`All ${SCENARIOS.length} smoke scenarios passed.`);

  // The loaded content-script stack installs polling timers and observers that
  // never get torn down, so the event loop would stay alive forever. Exit
  // explicitly instead of hanging.
  process.exit(0);
})();
