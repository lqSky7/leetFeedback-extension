'use strict';

// Network-path tests for the GeeksforGeeks and CodeChef adapters, plus the
// interceptor invariant they depend on.
//
// Two separate bugs motivate this file:
//
//   1. `applyReconConfig()` reset the interceptor's `seq` counter on every
//      config message, while the controller only cleared its own event map when
//      it actually re-armed. Because the controller re-pushes its config
//      whenever it re-evaluates arming — which happens on every SPA navigation
//      — a mid-session re-push restarted the counter and the next events landed
//      on unrelated records: the request body of one call paired with the
//      response body of another. The uploaded bundle looked plausible and was
//      wrong. The first scenario below is the regression test.
//
//   2. Both adapters scraped verdicts from the DOM, and their run-button
//      selectors had gone stale (GFG looked for `problems_compile_button__*`,
//      CodeChef for `#run_btn`; the real controls are `button.ui.mini.button`
//      and `#compile_btn`), so run attempts were not recorded at all. Both are
//      now network-driven, and the payload fixtures below are the real bodies
//      from the two uploaded recon captures.
//
// Run: node tests/platforms.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

const read = (relPath) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/* ─────────────────────── the MAIN-world interceptor ────────────────────── */

/**
 * Load page/net-interceptor.js the way the browser does: as a MAIN-world script
 * whose `window` is the page global, with `fetch` and `postMessage` in place
 * before it patches them.
 */
function loadInterceptor() {
  const posted = [];
  const listeners = {};

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    JSON,
    Error,
    RegExp,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Date,
    Math,
    URLSearchParams: undefined,
    FormData: undefined,
    XMLHttpRequest: undefined,
    addEventListener: (type, fn) => {
      (listeners[type] = listeners[type] || []).push(fn);
    },
    removeEventListener: () => {},
    postMessage: (message) => posted.push(message),
    fetch: async (url) => makeResponse(JSON.stringify({ served: String(url) })),
  };

  // In the page, `window` IS the global object — the interceptor relies on that
  // (`window.postMessage`, `window.__traverseNetInterceptorInstalled`).
  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(read('page/net-interceptor.js'), sandbox, { filename: 'net-interceptor.js' });

  // `vm.createContext` contextifies the sandbox, so the global object inside the
  // script is NOT the same object as `sandbox`. The interceptor's message
  // listener drops anything whose `event.source` is not its own `window`, so the
  // real inner reference has to be used when dispatching.
  const innerWindow = vm.runInContext('window', sandbox);

  const dispatch = (type, data) => {
    for (const fn of listeners[type] || []) fn({ source: innerWindow, data });
  };

  const recon = (phase) => posted.filter((m) => m.type === 'TRV_RECON_EVENT' && m.phase === phase);

  return {
    sandbox,
    posted,
    dispatch,
    reconRequests: () => recon('request'),
    reconResponses: () => recon('response'),
  };
}

function makeResponse(text, status = 200) {
  const headers = {
    forEach: (cb) => cb('application/json', 'content-type'),
    get: (name) => (String(name).toLowerCase() === 'content-type' ? 'application/json' : null),
  };
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    clone: () => ({ text: async () => text }),
  };
}

/**
 * The regression test for the bundle corruption.
 *
 * Before the fix the second call was captured as seq 1 as well, so it merged
 * into the record the first call had created: record 1 ended up holding the
 * first call's URL with the second call's response body.
 */
async function reconSeqStaysMonotonicAcrossConfigPushes() {
  const env = loadInterceptor();

  env.dispatch('message', { type: 'TRV_RECON_CONFIG', enabled: true });

  await env.sandbox.fetch('https://judge.example/one');
  await settle();
  await settle();

  const first = env.reconRequests();
  assert.strictEqual(first.length, 1, 'the first call should be captured once');
  assert.strictEqual(first[0].seq, 1, 'the first captured request takes seq 1');

  // The controller re-pushes its config whenever it re-evaluates arming, which
  // it does on every SPA navigation while already recording.
  env.dispatch('message', { type: 'TRV_RECON_CONFIG', enabled: true });

  await env.sandbox.fetch('https://judge.example/two');
  await settle();
  await settle();

  const requests = env.reconRequests();
  assert.strictEqual(requests.length, 2, 'both calls should be captured');
  assert.strictEqual(
    requests[1].seq,
    2,
    'a re-pushed config must not restart the seq counter — that is what cross-attributed the bundle'
  );

  // Each response must belong to the request that opened its seq.
  const responses = env.reconResponses();
  assert.strictEqual(responses.length, 2, 'both responses should be captured');
  for (const response of responses) {
    const request = requests.find((r) => r.seq === response.seq);
    assert.ok(request, `response seq ${response.seq} has no matching request`);
    assert.strictEqual(
      response.url,
      request.url,
      `seq ${response.seq} paired ${request.url} with a response from ${response.url}`
    );
    assert.ok(
      String(response.responseBody).includes(request.url),
      `seq ${response.seq} carries another call's response body`
    );
  }
}

/* ──────────────────────────── adapter harness ──────────────────────────── */

class StubPlatformAdapter {
  constructor(def = {}) {
    Object.assign(this, def);
    this.platform = def.platform;
    this.calls = [];
    this.logger = { log: () => {}, warn: () => {}, error: () => {} };
  }

  async captureSubmit(code, language) {
    this.calls.push({ kind: 'captureSubmit', code, language });
    return true;
  }

  async captureRun(code, language) {
    this.calls.push({ kind: 'captureRun', code, language });
    return { code, language };
  }

  async submitVerdict(verdict) {
    this.calls.push({ kind: 'submitVerdict', ...verdict });
  }

  async runVerdict(success) {
    this.calls.push({ kind: 'runVerdict', success });
  }

  async captureFromDom() {
    return false;
  }

  watchButton() {}
}

/**
 * Load a platform adapter with a stub base class, and hand back an instance
 * plus a log of every capture/verdict call it made.
 */
function loadAdapter(relPath, { href, pathname, elements = {} }) {
  let AdapterClass = null;

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    document: {
      title: '',
      querySelector: (selector) => elements[selector] || null,
      querySelectorAll: () => [],
    },
    location: { href, pathname },
    Traverse: {
      PlatformAdapter: StubPlatformAdapter,
      util: { sanitizeCode: (code) => code },
      config: { domVerdictFallback: {} },
      startPlatform: (Adapter) => {
        AdapterClass = Adapter;
      },
    },
  };

  sandbox.window = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(read(relPath), sandbox, { filename: relPath });

  assert.ok(AdapterClass, `${relPath} should register its adapter with T.startPlatform`);
  return { Adapter: AdapterClass, adapter: new AdapterClass(), sandbox };
}

const callsOfKind = (adapter, kind) => adapter.calls.filter((c) => c.kind === kind);

/* ───────────────────────────── GeeksforGeeks ───────────────────────────── */

const GFG = 'https://practiceapiorigin.geeksforgeeks.org/api/latest/problems';
const GFG_SLUG = 'fractional-knapsack-1587115620';

function loadGfg() {
  return loadAdapter('platforms/geeksforgeeks.js', {
    href: `https://practice.geeksforgeeks.org/problems/${GFG_SLUG}/1`,
    pathname: `/problems/${GFG_SLUG}/1`,
  });
}

async function gfgRecordsAttemptsFromTheJudgeRequests() {
  const { adapter } = loadGfg();

  await adapter.onNetEvent({
    phase: 'request',
    method: 'POST',
    url: `${GFG}/${GFG_SLUG}/compile-sub-id/?`,
    requestBody: 'request_type=compileOutput',
  });
  await adapter.onNetEvent({
    phase: 'request',
    method: 'POST',
    url: `${GFG}/${GFG_SLUG}/submit/compile/?`,
    requestBody: 'request_type=solutionCheck',
  });

  assert.strictEqual(callsOfKind(adapter, 'captureRun').length, 1, 'a run start records a run attempt');
  assert.strictEqual(callsOfKind(adapter, 'captureSubmit').length, 1, 'a submit start records a submit attempt');
}

async function gfgRunVerdictIgnoresTheReferenceSide() {
  const { adapter } = loadGfg();
  const runResult = (body) =>
    adapter.onNetEvent({ phase: 'response', method: 'POST', url: `${GFG}/submission/compile-output?`, response: body });

  // The first poll of a run: the *reference* solution's side is finished, the
  // user's side is still empty. Reading this as a verdict was the old bug — it
  // always looked like a pass, so run failures were never recorded.
  await runResult({
    results: {
      expectedOutput: { status: 'SUCCESS', view_mode: 'test_results', message: { output: '240.000000\n' } },
      testSolution: { status: '' },
    },
  });
  assert.strictEqual(callsOfKind(adapter, 'runVerdict').length, 0, 'the reference side finishing is not a verdict');

  // A compilation error on the user's side.
  await runResult({
    results: {
      expectedOutput: null,
      testSolution: {
        status: 'SUCCESS',
        sub_status: 13,
        view_mode: 'compilation',
        message: { error: "Solution.cpp:17:36: error: expected primary-expression before '(' token" },
      },
    },
  });

  // And a run that executed cleanly.
  await runResult({
    results: {
      expectedOutput: null,
      testSolution: {
        status: 'SUCCESS',
        sub_status: '',
        view_mode: 'test_results',
        test_cases_processed: 11,
        message: { output: '240.000000\n', output_type: 'Your Output: ' },
      },
    },
  });

  const verdicts = callsOfKind(adapter, 'runVerdict');
  assert.strictEqual(verdicts.length, 2, 'both of the user-side payloads are verdicts');
  assert.strictEqual(verdicts[0].success, false, 'view_mode "compilation" is a failed run');
  assert.strictEqual(verdicts[1].success, true, 'a clean run is a successful run');
}

async function gfgSubmitVerdictIgnoresTheQueuedPolls() {
  const { adapter } = loadGfg();
  const submitResult = (body) =>
    adapter.onNetEvent({ phase: 'response', method: 'POST', url: `${GFG}/submission/submit/result/?`, response: body });

  // The site polls this endpoint while the judge runs; these carry no verdict.
  for (let i = 0; i < 3; i++) {
    await submitResult({
      message: 'Request Queued.',
      status: 'QUEUED',
      test_cases_processed: 0,
      total_test_cases: 1115,
    });
  }
  assert.strictEqual(callsOfKind(adapter, 'submitVerdict').length, 0, 'a queued poll is not a verdict');

  const final = {
    status: 'SUCCESS',
    sub_status: 1,
    view_mode: 'correct',
    time: 0.28,
    test_cases_processed: 1115,
    total_test_cases: 1115,
    message: { accuracy: 80, attempt_count: 5, correct_submissions: 4 },
  };
  await submitResult(final);

  const verdicts = callsOfKind(adapter, 'submitVerdict');
  assert.strictEqual(verdicts.length, 1, 'the final payload is the verdict');
  assert.strictEqual(verdicts[0].accepted, true, 'view_mode "correct" is an accepted submission');
  assert.strictEqual(verdicts[0].stats.accuracy, '80%', 'accuracy is carried into the stats');

  // An accepted verdict runs the whole storage pipeline, so a repeat poll of the
  // same payload must not apply it twice.
  await submitResult(final);
  assert.strictEqual(callsOfKind(adapter, 'submitVerdict').length, 1, 'the verdict is applied once per submission');
}

async function gfgRejectedSubmitIsRecorded() {
  const { adapter } = loadGfg();

  await adapter.onNetEvent({
    phase: 'response',
    method: 'POST',
    url: `${GFG}/submission/submit/result/?`,
    response: { status: 'SUCCESS', sub_status: 2, view_mode: 'wrong', time: 0.3, message: {} },
  });

  const verdicts = callsOfKind(adapter, 'submitVerdict');
  assert.strictEqual(verdicts.length, 1, 'a non-"correct" view_mode is still a verdict');
  assert.strictEqual(verdicts[0].accepted, false, 'a wrong answer must not be recorded as accepted');
  assert.strictEqual(verdicts[0].status, 'Wrong Answer', 'the verdict carries a readable status');
}

/* ──────────────────────────────── CodeChef ─────────────────────────────── */

const CHEF_RUN = 'https://www.codechef.com/api/ide/run/BBXJG01';
const CHEF_SUBMIT = 'https://www.codechef.com/api/ide/submit';

function loadCodeChef() {
  return loadAdapter('platforms/codechef.js', {
    href: 'https://www.codechef.com/practice/course/stacks-and-queues-new/STACKQUE06/problems/BBXJG01',
    pathname: '/practice/course/stacks-and-queues-new/STACKQUE06/problems/BBXJG01',
  });
}

async function codechefRunVerdictComesFromSignalAndStderr() {
  const { adapter } = loadCodeChef();
  const runResponse = (body) =>
    adapter.onNetEvent({ phase: 'response', method: 'GET', url: `${CHEF_RUN}?timestamp=1789249735&isCodeVisualizer=0`, response: body });

  // The recorded success: `result: 15`, `signal: 0`, empty `stderr`.
  await runResponse({
    cmpinfo: '',
    code_status: 0,
    memory: '9828',
    output: 'None\nNone\n2\n1\nNone\n9\ntrue\n',
    result: 15,
    signal: 0,
    status: 'OK',
    stderr: '',
    time: '0.0100',
  });

  // The recorded runtime error: `result: 12`, `signal: 1`, a traceback in stderr.
  await runResponse({
    cmpinfo: '',
    code_status: 0,
    memory: '11948',
    output: 'None\nNone\n',
    result: 12,
    signal: 1,
    status: 'OK',
    stderr: 'Traceback (most recent call last):\n  File "/mnt/sol.py", line 29, in pop\nAttributeError',
    time: '0.0200',
  });

  // A compile error shows up in `cmpinfo`.
  await runResponse({ cmpinfo: 'sol.cpp:3:5: error: expected ;', result: 12, signal: 1, status: 'OK', stderr: '' });

  // Not a run payload at all.
  await runResponse({ status: 'OK', timestamp: 1789249702 });

  const verdicts = callsOfKind(adapter, 'runVerdict');
  assert.strictEqual(verdicts.length, 3, 'three of the four payloads are run verdicts');
  assert.deepStrictEqual(
    verdicts.map((v) => v.success),
    [true, false, false],
    'status "OK" must not be read as a passing run'
  );
}

async function codechefRunBurstRecordsOneAttempt() {
  const { adapter } = loadCodeChef();

  // The site can poll the run endpoint; every request in the burst belongs to
  // one run, and recordRun() increments the counter on every call.
  await adapter.onNetEvent({ phase: 'request', method: 'GET', url: `${CHEF_RUN}?timestamp=1` });
  await adapter.onNetEvent({ phase: 'request', method: 'GET', url: `${CHEF_RUN}?timestamp=2` });
  await adapter.onNetEvent({ phase: 'request', method: 'GET', url: `${CHEF_RUN}?timestamp=3` });

  assert.strictEqual(callsOfKind(adapter, 'captureRun').length, 1, 'a run burst is one attempt, not three');
}

async function codechefSubmitVerdictComesFromResultCode() {
  const { adapter } = loadCodeChef();

  // The submit itself returns a upid and is not a verdict.
  await adapter.onNetEvent({
    phase: 'response',
    method: 'POST',
    url: CHEF_SUBMIT,
    response: { status: 'OK', upid: 1356574672 },
  });
  assert.strictEqual(callsOfKind(adapter, 'submitVerdict').length, 0, 'the submit response is not a verdict');

  // The matching poll carries `result_code`.
  await adapter.onNetEvent({
    phase: 'response',
    method: 'GET',
    url: `${CHEF_SUBMIT}?solution_id=1356574672`,
    response: {
      result_code: 'accepted',
      result_description: '',
      time: '0.08',
      upid: '1356574672',
    },
  });

  const verdicts = callsOfKind(adapter, 'submitVerdict');
  assert.strictEqual(verdicts.length, 1, 'the poll is the verdict');
  assert.strictEqual(verdicts[0].accepted, true, 'result_code "accepted" is an accepted submission');
  assert.strictEqual(verdicts[0].status, 'Accepted', 'the slug is mapped to a readable status');

  // Repeating the poll must not re-apply an accepted verdict.
  await adapter.onNetEvent({
    phase: 'response',
    method: 'GET',
    url: `${CHEF_SUBMIT}?solution_id=1356574672`,
    response: { result_code: 'accepted', time: '0.08' },
  });
  assert.strictEqual(callsOfKind(adapter, 'submitVerdict').length, 1, 'the verdict is applied once per submission');
}

async function codechefRejectedSubmitAndSourcePollAreHandled() {
  const { adapter } = loadCodeChef();

  await adapter.onNetEvent({
    phase: 'response',
    method: 'GET',
    url: `${CHEF_SUBMIT}?solution_id=1356574671`,
    response: { result_code: 'runtime', time: '0.02', upid: '1356574671' },
  });

  // `/api/user_source_code` returns the saved source on page load — that is not
  // a verdict, even though the same endpoint carries `result_code` when polled.
  await adapter.onNetEvent({
    phase: 'response',
    method: 'GET',
    url: 'https://www.codechef.com/api/user_source_code?contestCode=STACKQUE06&problemCode=BBXJG01&languageId=116',
    response: { locked_lines: '', message: 'Successfully fetched user source code', source_code: 'class Stack:' },
  });

  const verdicts = callsOfKind(adapter, 'submitVerdict');
  assert.strictEqual(verdicts.length, 1, 'only the runtime payload is a verdict');
  assert.strictEqual(verdicts[0].accepted, false, 'result_code "runtime" is not accepted');
  assert.strictEqual(verdicts[0].status, 'Runtime Error', 'the slug is mapped to a readable status');
}

/* ──────────────────────────────── runner ──────────────────────────────── */

/**
 * A `netFilters` entry that never matches is invisible: the adapter simply
 * never runs, every test still passes, and the platform silently falls back to
 * DOM scraping. These are the real (url, method) pairs from the two uploaded
 * captures, so this pins the filters to the traffic they exist to catch.
 */
const CAPTURED_JUDGE_CALLS = {
  geeksforgeeks: [
    ['POST', `${GFG}/${GFG_SLUG}/compile-sub-id/?`],
    ['POST', `${GFG}/submission/compile-output?`],
    ['POST', `${GFG}/${GFG_SLUG}/submit/compile/?`],
    ['POST', `${GFG}/submission/submit/result/?`],
  ],
  codechef: [
    ['GET', `${CHEF_RUN}?timestamp=1789249735&isCodeVisualizer=0`],
    ['POST', CHEF_SUBMIT],
    ['GET', `${CHEF_SUBMIT}?solution_id=1356574672`],
    [
      'GET',
      'https://www.codechef.com/api/user_source_code?contestCode=STACKQUE06&problemCode=BBXJG01&languageId=116',
    ],
  ],
};

/** The interceptor's own matching rule, reproduced so the filters are exercised. */
function matchesAnyFilter(filters, url, method) {
  return filters.some((filter) => {
    if (!filter || !filter.url) return false;
    const methods = (filter.methods || []).map((m) => String(m).toUpperCase());
    if (methods.length > 0 && !methods.includes(String(method).toUpperCase())) return false;
    return new RegExp(filter.url).test(url);
  });
}

async function filtersMatchTheCapturedJudgeTraffic() {
  const adapters = { geeksforgeeks: loadGfg().adapter, codechef: loadCodeChef().adapter };

  for (const [platform, calls] of Object.entries(CAPTURED_JUDGE_CALLS)) {
    const { netFilters } = adapters[platform];
    assert.ok(netFilters.length > 0, `${platform} should declare netFilters`);

    for (const [method, url] of calls) {
      assert.ok(
        matchesAnyFilter(netFilters, url, method),
        `${platform}: no filter matches ${method} ${url} — that request would be invisible`
      );
    }
  }
}

const SCENARIOS = [
  ['recon seq stays monotonic across config pushes', reconSeqStaysMonotonicAcrossConfigPushes],
  ['netFilters match the captured judge traffic', filtersMatchTheCapturedJudgeTraffic],
  ['GFG records attempts from the judge requests', gfgRecordsAttemptsFromTheJudgeRequests],
  ['GFG run verdict ignores the reference side', gfgRunVerdictIgnoresTheReferenceSide],
  ['GFG submit verdict ignores the queued polls', gfgSubmitVerdictIgnoresTheQueuedPolls],
  ['GFG records a rejected submit', gfgRejectedSubmitIsRecorded],
  ['CodeChef run verdict comes from signal/stderr', codechefRunVerdictComesFromSignalAndStderr],
  ['CodeChef run burst records one attempt', codechefRunBurstRecordsOneAttempt],
  ['CodeChef submit verdict comes from result_code', codechefSubmitVerdictComesFromResultCode],
  ['CodeChef rejected submit and source poll', codechefRejectedSubmitAndSourcePollAreHandled],
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
    console.error(`\n${failures} platform scenario(s) failed.`);
    process.exit(1);
  }

  console.log(`\nAll ${SCENARIOS.length} platform scenarios passed.`);
  process.exit(0);
})();
