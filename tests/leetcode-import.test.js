'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const contract = require('./fixtures/leetcode-progress-contract.json');
const compact = text => text.replace(/[\s,]+/g, '');
const source = fs.readFileSync(path.join(__dirname, '../core/leetcode-import.js'), 'utf8');
// Contract captured from the signed-in Progress page: question pages use filters,
// attempt pages use offset/limit/questionSlug, and verdicts are numeric.
async function collect({ count = 65, repeat = false, failUpload = false, incomplete = false, unavailableDetails = false, detailAuthFailure = false, transientUpload = false, lostAcknowledgement = false, slowBatches = false, partialFailure = false, readTimeout = false, restartDuringRead = false, store: previous } = {}) {
  const store = previous || { job: { id: 'job-1', schemaVersion: 4, tabId: 1, state: 'running', phase: 'questions', offset: 0, imported: 0, collected: 0, warnings: 0, seen: {} } };
  const calls = [], uploads = [];
  let failures = failUpload || transientUpload || lostAcknowledgement ? 1 : 0;
  let readFailures = readTimeout ? 3 : 0;
  const retained = new Map();
  const problems = Array.from({ length: count }, (_, id) => ({ translatedTitle: null, frontendId: String(id+1), title: `Problem ${id}`, titleSlug: `problem-${id}`, difficulty: 'EASY', lastSubmittedAt: '2026-10-03T15:25:06+00:00', numSubmitted: id === 0 ? 65 : 1, questionStatus: id === 1 ? 'ATTEMPTED' : 'SOLVED', lastResult: 'WA', topicTags: [{ name: 'Math', nameTranslated: '', slug: 'math' }] }));
  const chrome = {
    storage: { local: {
      get: async keys => JSON.parse(JSON.stringify(Object.fromEntries(keys.filter(key => key in store).map(key => [key, store[key]])))),
      set: async value => { Object.assign(store, JSON.parse(JSON.stringify(value))); },
      remove: async keys => { for (const key of [].concat(keys)) delete store[key]; }
    }, onChanged: { addListener: () => {} } },
    runtime: { sendMessage: async request => {
      calls.push(request);
      if (request.type === 'LEETCODE_IMPORT_STATUS') return { owned: true };
      if (request.type === 'LEETCODE_IMPORT_UPLOAD') {
        if (slowBatches && request.submissions.length > 2) return { success: false, retryable: true, code: 'timeout', error: 'signal timed out' };
        if (partialFailure && uploads.length >= 5) return { success: false, status: 401, error: 'Sign in to Traverse' };
        if (failures > 0) {
          failures--;
          if (lostAcknowledgement) request.submissions.forEach(row => retained.set(row.externalId, row));
          return transientUpload || lostAcknowledgement ? { success: false, retryable: true, code: 'timeout', error: 'signal timed out' } : { success: false, status: 400, error: 'Upload interrupted' };
        }
        request.submissions.forEach(row => retained.set(row.externalId, row));
        uploads.push(...JSON.parse(JSON.stringify(request.submissions)));
        return { success: true, data: { import: { archivedRecords: request.submissions.length, skippedInvalid: 0, aiAnalysis: false, revisionScheduling: false } } };
      }
      assert.equal(request.path, '/graphql/');
      const { query, variables, operationName } = request.body;
      assert(operationName);
      if (contract.queries[operationName]) assert.equal(compact(query), compact(contract.queries[operationName]), 'pagination query must match captured LeetCode source');
      if (restartDuringRead && operationName === 'ImportSubmission') {
        store.job.runId = 'new-run';
        return { success: false, retryable: true, code: 'timeout', error: 'signal timed out' };
      }
      if (readFailures > 0 && operationName === 'ImportSubmission') {
        readFailures--; return { success: false, retryable: true, code: 'timeout', error: 'signal timed out' };
      }
      let field, data;
      if (query.includes('userStatus')) { field = 'userStatus'; data = { isSignedIn: true, username: 'fixture-user' }; }
      else if (operationName === 'userProgressQuestionList') {
        assert.equal(variables.filters.limit, 50);
        field = 'userProgressQuestionList'; data = { totalNum: count, questions: problems.slice(variables.filters.skip, variables.filters.skip + 50) };
      } else if (operationName === 'userProgressSubmissionList') {
        assert.equal(variables.limit, 10);
        const n = Number(variables.questionSlug.split('-')[1]), total = problems[n].numSubmitted;
        const offset = repeat && n === 0 ? 0 : variables.offset;
        field = 'userProgressSubmissionList';
        data = { totalNum: total, submissions: incomplete ? [] : Array.from({ length: total }, (_, i) => ({ id: n*1000+i+1, status: i === 0 ? 11 : 10, langName: 'Python3', runtime: '4 ms', timestamp: '1700000000', memory: '20 MB' })).slice(offset, offset+10) };
      } else if (query.includes('submissionDetails')) {
        if (detailAuthFailure) return { success: false, status: 403, error: 'Login required' };
        if (unavailableDetails) return { success: false, status: 400, data: { errors: [{ message: 'Cannot query field "submissionDetails" on type "Query".' }] } };
        if (query.includes('outputDetail') || /\bid code/.test(query)) return { success: false, status: 400, data: { errors: [
          { message: 'Cannot query field "outputDetail" on type "SubmissionDetails".' },
          { message: 'Cannot query field "id" on type "SubmissionDetails".' }
        ] } };
        assert(!/\bid code/.test(query), 'all reported unsupported fields must be removed together');
        assert(!query.includes('lastTestcase'));
        field = 'submissionDetails'; data = { id: variables.id, code: 'print(42)', runtime: 4, memory: 2000 };
      } else { field = 'question'; data = { titleSlug: variables.slug, title: 'Fixture problem', difficulty: 'Easy', content: '<p>Question</p>', topicTags: [{ name: 'Array' }] }; }
      return { success: true, data: { data: { [field]: data } } };
    } }
  };
  vm.runInNewContext(source, { globalThis: { Traverse: { config: { leetcodeImport: { jobKey: 'job', pageKey: 'page', catalogKey: 'catalog' } } } }, chrome, TextEncoder, URL, setTimeout: fn => queueMicrotask(fn), setInterval: () => 1, console });
  for (let i=0;i<3000;i++) {
    await new Promise(resolve => setImmediate(resolve));
    if (['error','partial','complete'].includes(store.job.state)) break;
  }
  return { store, calls, uploads, retained };
}
(async () => {
  const expected = 65 + 65 + 64;
  const complete = await collect();
  assert.equal(complete.store.job.state, 'complete', complete.store.job.message);
  assert.equal(complete.retained.size, expected);
  assert.equal(complete.uploads.length, expected, 'only complete records are uploaded');
  assert(complete.uploads.every(r => r.captureComplete && r.problem.content && (r.recordKind === 'problem' || r.submissionDetail.code)), 'no unfinished record may be uploaded');
  assert.equal(complete.retained.get('1').statusDisplay, 'Wrong Answer');
  assert.equal(complete.retained.get('65').submissionDetail.code, 'print(42)');
  assert.equal(complete.retained.get('65').problem.content, '<p>Question</p>');
  const snapshot = complete.retained.get('problem:problem-0');
  assert.equal(snapshot.statusDisplay, 'Accepted'); assert.equal(snapshot.timestamp, undefined); assert.equal(snapshot.dateUnknown, true);
  assert.equal(complete.retained.get('problem:problem-1').statusDisplay, 'Tried');
  assert.equal(complete.calls.filter(c => c.body?.operationName === 'userProgressQuestionList').length, 2);
  assert.equal(complete.calls.filter(c => c.body?.operationName === 'userProgressSubmissionList' && c.body.variables.questionSlug === 'problem-0').length, 7);
  const firstDetail = complete.calls.findIndex(c => c.body?.operationName === 'ImportQuestion');
  const beforeDetails = complete.calls.slice(0, firstDetail).filter(c => c.type === 'LEETCODE_IMPORT_UPLOAD').flatMap(c => c.submissions);
  assert.equal(beforeDetails.length, 0, 'no history is uploaded before full collection and details');
  assert.equal(complete.calls.filter(c => c.body?.query.includes('outputDetail')).length, 1);
  assert(!complete.calls.some(c => /AI|REVISION/.test(c.type)));
  const repeated = await collect({ repeat: true });
  assert.equal(repeated.store.job.state, 'error'); assert.match(repeated.store.job.message, /repeated a submission page/);
  const interrupted = await collect({ failUpload: true });
  assert.equal(interrupted.store.job.problemIndex, 0);
  interrupted.store.job.state = 'running';
  const resumed = await collect({ store: interrupted.store });
  assert.equal(resumed.store.job.state, 'complete', resumed.store.job.message);
  assert.equal(resumed.retained.size, expected);
  assert.equal(resumed.calls.filter(c => c.body?.operationName === 'userProgressQuestionList').length, 0);
  const unavailable = await collect({ unavailableDetails: true });
  assert.equal(unavailable.store.job.state, 'error'); assert.equal(unavailable.retained.size, 0);
  assert.equal(unavailable.calls.filter(c => c.body?.operationName === 'ImportSubmission').length, 1);
  assert.match(unavailable.store.job.message, /submissionDetails/);
  const authFailure = await collect({ detailAuthFailure: true });
  assert.equal(authFailure.store.job.state, 'error');
  assert.equal(authFailure.retained.size, 0, 'authentication loss before completion must upload nothing');
  assert.equal(authFailure.calls.filter(c => c.body?.operationName === 'ImportSubmission').length, 1);
  const recovered = await collect({ transientUpload: true });
  assert.equal(recovered.store.job.state, 'complete'); assert.equal(recovered.retained.size, expected);
  const lost = await collect({ lostAcknowledgement: true });
  assert.equal(lost.store.job.state, 'complete'); assert.equal(lost.retained.size, expected);
  const slow = await collect({ slowBatches: true });
  assert.equal(slow.store.job.state, 'complete'); assert.equal(slow.retained.size, expected);
  const partial = await collect({ partialFailure: true });
  assert.equal(partial.store.job.state, 'error');
  assert.equal(partial.store['catalog:problem:job-1:0'].baseUploaded, 5, 'confirmed batch checkpoint survives later failure');
  partial.store.job.state = 'running';
  const partialResume = await collect({ store: partial.store });
  assert.equal(partialResume.store.job.state, 'complete');
  assert.equal(partial.uploads.length + partialResume.uploads.length, complete.uploads.length, 'resume uploads only unconfirmed batches');
  const readFailed = await collect({ readTimeout: true });
  assert.equal(readFailed.store.job.state, 'error');
  assert.equal(readFailed.retained.size, 0, 'missing code must block every upload');
  assert.equal(readFailed.calls.filter(c => c.body?.operationName === 'ImportSubmission').length, 3, 'an outage cannot produce one timeout per record');
  assert.match(readFailed.store.job.message, /timed out/);
  assert.equal(readFailed.store.job.lastError.source, 'leetcode');
  readFailed.store.job.state = 'running';
  const readResume = await collect({ store: readFailed.store });
  assert.equal(readResume.store.job.state, 'complete');
  assert.equal(readResume.calls.filter(c => /userProgress/.test(c.body?.operationName || '')).length, 0, 'finishing pending details never re-enumerates history');
  assert.equal(readResume.retained.get('65').submissionDetail.code, 'print(42)');
  const restarted = await collect({ restartDuringRead: true });
  assert.equal(restarted.store.job.runId, 'new-run'); assert.equal(restarted.store.job.state, 'running');
  assert.equal(restarted.retained.size, 0, 'old run cannot upload unfinished data after restart');
  const empty = await collect({ count: 0 }); assert.equal(empty.store.job.state, 'complete'); assert.equal(empty.uploads.length, 0);
  const incomplete = await collect({ incomplete: true }); assert.equal(incomplete.store.job.state, 'error'); assert.equal(incomplete.uploads.length, 0);
  console.log('LeetCode import: complete capture before upload, >50 pagination, local-only detail resume, lost acknowledgements, partial checkpoints, schema negotiation and stale-run isolation passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
