'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const store = { auth_token: 'token', auth_user: { id: 7 } };
const created = [], requests = [];
const configContext = { globalThis: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../core/config.js'), 'utf8'), configContext);
const T = configContext.globalThis.Traverse;
const chrome = {
  runtime: { getURL: value => `chrome-extension://test/${value}` },
  storage: { local: { get: async keys => Object.fromEntries(keys.map(key => [key, store[key]])), set: async obj => Object.assign(store, obj), remove: async keys => [].concat(keys).forEach(key => delete store[key]) } },
  tabs: { create: async options => { created.push(options); return { id: 9 }; }, get: async () => ({ id: 9, url: 'https://leetcode.com/progress/' }), update: async () => ({}), onRemoved: { addListener: () => {} } },
  scripting: { executeScript: async options => {
    const result = await options.func(...options.args);
    return [{ result }];
  } },
};
let fetchBehavior;
const nativeFetch = async (url, options) => {
  requests.push({ url, options });
  if (fetchBehavior) return fetchBehavior(url, options);
  return { ok: true, status: 200, json: async () => url.includes('/bulk-import/records') ? ({ records: [] }) : ({ data: { userStatus: { username: 'alice' } } }) };
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../background/leetcode-import.js'), 'utf8'), {
  globalThis: { Traverse: T }, chrome, crypto: { randomUUID: () => 'job-1' }, URL,
  fetch: nativeFetch, AbortSignal, document: { cookie: 'csrftoken=test-csrf' },
});
const call = (method, request, sender) => new Promise(resolve => T.leetcodeImport[method](request, sender, resolve));
(async () => {
  const panel = { url: 'chrome-extension://test/sidepanel/sidepanel.html' };
  const tab = { tab: { id: 9 }, url: 'https://leetcode.com/progress/' };
  assert.equal((await call('start', {}, tab)).success, false, 'content scripts cannot start imports');
  assert.equal((await call('start', {}, panel)).success, true);
  assert.equal(created[0].url, 'https://leetcode.com/progress/');
  assert.equal(store.leetcode_import_job.userId, '7');
  const runId = store.leetcode_import_job.runId;
  assert.equal((await call('fetch', { runId, path: '/graphql/', body: { query: 'query { userStatus { username } }' } }, { ...tab, tab: { id: 10 } })).success, false);
  assert.equal((await call('fetch', { runId, path: '/graphql/', body: { query: 'query { userStatus { username } }' } }, tab)).success, true);
  assert.equal(requests[0].options.credentials, 'omit', 'backend readiness checked first');
  assert.equal(requests[1].options.credentials, 'same-origin');
  assert.equal(requests[1].options.headers['x-csrftoken'], 'test-csrf');
  assert.equal((await call('fetch', { runId, path: 'https://evil.test/' }, tab)).success, false);
  store.leetcode_import_job.username = 'alice';
  store.auth_user = { id: 8 };
  assert.equal((await call('upload', { runId, username: 'alice', submissions: [{}] }, tab)).success, false, 'account switch blocks uploads');
  assert.equal(requests.length, 2);
  store.auth_user = { id: 7 };
  fetchBehavior = async () => { const error = new Error('signal timed out'); error.name = 'TimeoutError'; throw error; };
  const lcTimeout = await call('fetch', { runId, path: '/graphql/', body: { query: 'query { userStatus { username } }' } }, tab);
  assert.equal(lcTimeout.retryable, true); assert.equal(lcTimeout.source, 'leetcode'); assert.equal(lcTimeout.code, 'timeout');
  const blockedDraft = await call('upload', { runId, username: 'alice', submissions: [{}] }, tab);
  assert.equal(blockedDraft.retryable, undefined);
  assert.match(blockedDraft.error, /capture must be complete/);
  store.leetcode_import_job.phase = 'upload';
  const backendTimeout = await call('upload', { runId, username: 'alice', submissions: [{}] }, tab);
  assert.equal(backendTimeout.retryable, true); assert.equal(backendTimeout.source, 'backend'); assert.equal(backendTimeout.code, 'timeout');
  fetchBehavior = async () => ({ ok: true, status: 200, json: async () => { const e = new Error('signal timed out'); e.name = 'TimeoutError'; throw e; } });
  const bodyTimeout = await call('upload', { runId, username: 'alice', submissions: [{}] }, tab);
  assert.equal(bodyTimeout.retryable, true); assert.equal(bodyTimeout.code, 'timeout', 'slow response body is a timeout too');
  const before = requests.length;
  store.leetcode_import_job.runId = 'restarted-run';
  assert.equal((await call('upload', { runId, username: 'alice', submissions: [{}] }, tab)).success, false);
  assert.equal((await call('fetch', { runId, path: '/graphql/' }, tab)).success, false);
  assert.equal(requests.length, before, 'stale run cannot access network after Retry');
  fetchBehavior = async () => ({ ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) });
  const tabsBefore = created.length;
  const denied = await call('start', {}, panel);
  assert.equal(denied.success, false);
  assert.equal(created.length, tabsBefore, 'backend authentication fails before opening LeetCode');
  assert.equal(store.leetcode_import_job.state, 'error');
  assert.match(denied.error, /Sign in to Traverse/);
  console.log('LeetCode background: tab ownership, signed-in session fetch, endpoint restrictions, and account-switch protection passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
