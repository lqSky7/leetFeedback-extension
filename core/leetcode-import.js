// Full-history collector. Runs only in the tab explicitly opened by Settings.
(function () {
  'use strict';
  const T = globalThis.Traverse;
  const { jobKey, pageKey, catalogKey } = T.config.leetcodeImport;
  let running = false;
  let queryPlans = {};
  let activeJob;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const message = request => chrome.runtime.sendMessage({ ...request, runId: activeJob?.runId });
  const load = async () => (await chrome.storage.local.get([jobKey]))[jobKey];
  async function assertCurrent() {
    const current = await load();
    if (current?.id !== activeJob?.id || current?.runId !== activeJob?.runId) throw new Error('Import was replaced or restarted.');
    if (!['running', 'waiting-login'].includes(current.state)) throw new Error('Import paused. Retry to resume.');
  }
  async function save(job) {
    const current = await load();
    if (current?.id !== job.id || current?.runId !== job.runId) throw new Error('Import was replaced or restarted.');
    await chrome.storage.local.set({ [jobKey]: job });
  }
  async function requestWithRetry(request, source, operation) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await load();
      if (current?.id !== activeJob.id || current?.runId !== activeJob.runId) throw new Error('Import was replaced or restarted.');
      if (!['running', 'waiting-login'].includes(current.state)) throw new Error('Import paused. Retry to resume.');
      activeJob.message = `${source === 'backend' ? 'Saving' : 'Reading'} ${operation}${attempt ? ` · retry ${attempt + 1}/3` : ''}…`;
      await save(activeJob);
      await sleep(attempt ? 1500 * 2 ** (attempt - 1) : 300);
      let reply;
      try { reply = await message(request); }
      catch (error) { reply = { success: false, retryable: !/context invalidated/i.test(error.message), code: 'connection', error: error.message }; }
      if (reply?.success || (source === 'leetcode' && reply?.status === 400 && reply.data?.errors?.length)) return reply;
      const retryable = reply?.retryable === true || reply?.status === 429 || reply?.status >= 500;
      activeJob.lastError = { source, operation, code: reply?.code || 'http', status: reply?.status,
        attempt: attempt + 1, detail: reply?.error || reply?.data?.error, at: Date.now() };
      await save(activeJob);
      if (retryable && attempt < 2) continue;
      const detail = reply?.error || reply?.data?.error || `Request failed (${reply?.status || 'connection'}).`;
      const timeout = reply?.code === 'timeout' || /timed? ?out|timeout/i.test(detail);
      const failure = new Error(timeout ? `${source === 'backend' ? 'Backend upload' : 'LeetCode ' + operation} timed out after 3 attempts. Progress saved; retry to resume.`
        : `${source === 'backend' ? 'Backend' : 'LeetCode'}: ${detail} Progress saved; retry to resume.`);
      failure.status = reply?.status; failure.transport = true;
      failure.retryable = retryable; failure.source = source; failure.operation = operation;
      throw failure;
    }
  }
  async function fetchJSON(path, body) {
    return (await requestWithRetry({ type: 'LEETCODE_IMPORT_FETCH', path, body }, 'leetcode', ({ ImportUser: 'account', userProgressQuestionList: 'problem list', userProgressSubmissionList: 'attempts', ImportQuestion: 'problem details', ImportSubmission: 'submission code' })[body.operationName] || 'history')).data;
  }
  // Optional schema fields sometimes change. Drop only fields explicitly rejected
  // by GraphQL validation; never hide auth/rate-limit/errors as successful data.
  function removeField(query, name) {
    const match = new RegExp(`(?<![$\\w])${name}\\b`).exec(query);
    if (!match) return query;
    let end = match.index + name.length;
    while (/\s/.test(query[end] || '') && end < query.length) end++;
    if (query[end] === '{') {
      let depth = 0;
      do {
        if (query[end] === '{') depth++;
        if (query[end] === '}') depth--;
        end++;
      } while (depth && end < query.length);
    }
    return query.slice(0, match.index) + query.slice(end);
  }
  async function graphql(query, variables, field, optional = false) {
    const plan = optional && queryPlans[field];
    if (plan?.unavailable) throw new Error(plan.unavailable);
    query = plan?.query || query;
    // Negotiate optional fields once per import, not once per submission.
    // LeetCode returns all validation errors together; remove them together.
    for (let i = 0; i < 3; i++) {
      const reply = await fetchJSON('/graphql/', { query, variables, operationName: query.match(/query\s+(\w+)/)?.[1] });
      if (!reply.errors?.length && reply.data?.[field] != null) {
        if (optional) queryPlans[field] = { query };
        return reply.data[field];
      }
      const errors = reply.errors?.map(error => error.message) || [`LeetCode did not return ${field}`];
      const error = errors.join('; ');
      const transport = /rate|too many|throttl|unauth|forbidden|login|sign.?in|internal server|temporar/i.test(error);
      let next = query;
      if (optional && !transport && errors.every(error => /Cannot query field "(\w+)"/.test(error))) {
        for (const message of errors) {
          const name = message.match(/Cannot query field "(\w+)"/)[1];
          if (name === field) { next = query; break; }
          next = removeField(next, name);
        }
        if (next !== query && i < 2) { query = next; continue; }
      }
      const failure = new Error(error);
      failure.transport = transport;
      // Schema rejection applies to the query, not to one old submission.
      // Cache it so an unavailable optional API cannot flood the console.
      if (optional && !transport && /Cannot query field|Unknown argument|Unknown type|Syntax Error|used in position|must have a selection|argument .* required/i.test(error)) {
        queryPlans[field] = { unavailable: error };
      }
      throw failure;
    }
  }
  async function question(slug) {
    return graphql(`query ImportQuestion($slug: String!) { question(titleSlug: $slug) {
      questionId questionFrontendId title titleSlug content difficulty isPaidOnly
      stats hints exampleTestcases sampleTestCase metaData similarQuestions
      topicTags { name slug } codeSnippets { lang langSlug code }
    } }`, { slug }, 'question', true);
  }
  async function detail(id) {
    return graphql(`query ImportSubmission($id: Int!) { submissionDetails(submissionId: $id) {
      id code timestamp statusCode runtime runtimeDisplay runtimePercentile
      memory memoryDisplay memoryPercentile totalCorrect totalTestcases
      lang { name verboseName } question { questionId title titleSlug }
      outputDetail { codeOutput expectedOutput input compileError runtimeError lastTestcase }
    } }`, { id: Number(id) }, 'submissionDetails', true);
  }
  const progressQuery = `query userProgressQuestionList($filters: UserProgressQuestionListInput) {
    userProgressQuestionList(filters: $filters) { totalNum questions {
      translatedTitle frontendId title titleSlug difficulty lastSubmittedAt
      numSubmitted questionStatus lastResult topicTags { name nameTranslated slug }
    } }
  }`;
  const submissionsQuery = `query userProgressSubmissionList($offset: Int!, $limit: Int!, $questionSlug: String!) {
    userProgressSubmissionList(offset: $offset, limit: $limit, questionSlug: $questionSlug) {
      submissions { id status langName runtime timestamp memory } totalNum
    }
  }`;
  const statuses = { 10: 'Accepted', 11: 'Wrong Answer', 12: 'Memory Limit Exceeded',
    13: 'Output Limit Exceeded', 14: 'Time Limit Exceeded', 15: 'Runtime Error',
    16: 'Internal Error', 20: 'Compile Error', 30: 'Timeout' };
  function validatePage(data, field, offset, expectedTotal) {
    if (!Array.isArray(data[field]) || !Number.isInteger(data.totalNum) || data.totalNum < 0 ||
        (expectedTotal != null && expectedTotal !== data.totalNum) ||
        offset + data[field].length > data.totalNum || (!data[field].length && offset < data.totalNum)) {
      throw new Error('LeetCode history changed or returned an incomplete page. Retry to continue.');
    }
  }
  async function identity(job) {
    const user = await graphql('query ImportUser { userStatus { isSignedIn username } }', {}, 'userStatus');
    if (!user.isSignedIn || !user.username) {
      job.state = 'waiting-login';
      job.message = 'Sign in to LeetCode in this tab. Your import will start automatically.';
      await save(job);
      return false;
    }
    if (job.username && job.username !== user.username) throw new Error('LeetCode account changed. Sign back into the original account to resume.');
    job.username = user.username;
    job.state = 'running';
    await save(job);
    return true;
  }
  async function upload(job, records, onConfirmed) {
    let cursor = 0;
    async function send(batch) {
      let reply;
      try {
        reply = await requestWithRetry({ type: 'LEETCODE_IMPORT_UPLOAD', username: job.username, submissions: batch }, 'backend', `${batch.length} records`);
      } catch (error) {
        // Timeout may mean a committed response was lost. Imports are idempotent;
        // retry smaller batches and checkpoint only confirmed records.
        if (!error.retryable || error.status === 429 || batch.length === 1) throw error;
        const middle = Math.ceil(batch.length / 2);
        await send(batch.slice(0, middle));
        await send(batch.slice(middle));
        return;
      }
      const result = reply.data?.import;
      if (result?.skippedInvalid > 0 || result?.archivedRecords !== batch.length || result?.aiAnalysis !== false || result?.revisionScheduling !== false) {
        throw new Error('The backend did not retain every record in this batch. Import paused for retry.');
      }
      cursor += batch.length;
      if (onConfirmed) await onConfirmed(batch.length);
    }
    while (cursor < records.length) {
      const batch = []; let bytes = 0;
      for (const record of records.slice(cursor)) {
        const size = new TextEncoder().encode(JSON.stringify(record)).length;
        if (batch.length && (bytes + size > 200000 || batch.length >= 5)) break;
        batch.push(record); bytes += size;
      }
      await send(batch);
    }
  }
  const datasetKey = index => `${catalogKey}:problem:${activeJob.id}:${index}`;
  async function persistDataset(index, dataset) {
    await assertCurrent();
    await chrome.storage.local.set({ [datasetKey(index)]: dataset });
  }
  async function datasetAt(index, problem) {
    return (await chrome.storage.local.get([datasetKey(index)]))[datasetKey(index)] || {
      problem, records: [], offset: 0, baseUploaded: 0, historyDone: false,
      snapshotUploaded: false, metadataState: 'pending', snapshotEnriched: false,
    };
  }
  function wire(record, dataset) {
    const { detailState, enrichmentUploaded, ...source } = record;
    return { ...source, titleSlug: dataset.problem.titleSlug, title: dataset.problem.title,
      difficulty: dataset.problem.difficulty, topicTags: dataset.problem.topicTags,
      language: source.langName || source.submissionDetail?.lang?.name,
      recordKind: 'submission', captureComplete: true, statusDisplay: statuses[source.status] || 'Unknown', sourceProblem: dataset.problem,
      ...(record.detailState === 'done' ? { detailError: null } : {}),
      ...(dataset.metadata ? { problem: dataset.metadata } : {}),
    };
  }
  function snapshot(dataset) {
    return { ...dataset.problem, recordKind: 'problem', captureComplete: true, submissionCount: dataset.total, externalId: `problem:${dataset.problem.titleSlug}`, dateUnknown: true,
      statusDisplay: dataset.problem.questionStatus === 'SOLVED' ? 'Accepted' : 'Tried',
      ...(dataset.metadata ? { problem: dataset.metadata } : {}),
      metadataError: dataset.metadataError || null,
    };
  }
  async function collectQuestions(job, catalog) {
    while (job.phase === 'questions') {
      const data = await graphql(progressQuery, { filters: { skip: job.offset, limit: 50 } }, 'userProgressQuestionList');
      validatePage(data, 'questions', job.offset, job.problemTotal);
      const slugs = new Set(catalog.records.slice(0, job.offset).map(q => q.titleSlug));
      for (const q of data.questions) {
        if (!q.titleSlug || slugs.has(q.titleSlug)) throw new Error('LeetCode repeated a problem page. Retry to continue.');
        slugs.add(q.titleSlug);
      }
      catalog.records.splice(job.offset, catalog.records.length, ...data.questions);
      await assertCurrent();
      await chrome.storage.local.set({ [catalogKey]: catalog });
      job.problemTotal = data.totalNum; job.offset += data.questions.length;
      if (job.offset === data.totalNum) { job.phase = 'history'; job.problemIndex = 0; job.offset = 0; }
      await save(job);
    }
  }
  async function collectHistory(job, catalog) {
    while (job.problemIndex < catalog.records.length) {
      if (!await identity(job)) return false;
      const index = job.problemIndex;
      const dataset = await datasetAt(index, catalog.records[index]);
      while (!dataset.historyDone) {
        const data = await graphql(submissionsQuery, { offset: dataset.offset, limit: 10,
          questionSlug: dataset.problem.titleSlug }, 'userProgressSubmissionList');
        validatePage(data, 'submissions', dataset.offset, dataset.total);
        const ids = new Set(dataset.records.map(record => record.externalId));
        const records = data.submissions.map(record => ({ ...record, externalId: String(record.id) }));
        for (const record of records) {
          if (!record.id || ids.has(record.externalId)) throw new Error('LeetCode repeated a submission page or omitted an ID. Retry to continue.');
          ids.add(record.externalId);
        }
        dataset.records.push(...records); dataset.offset += records.length; dataset.total = data.totalNum;
        dataset.historyDone = dataset.offset === data.totalNum;
        await persistDataset(index, dataset);
      }
      job.collected += dataset.records.length; job.problemIndex++; await save(job);
    }
    job.phase = 'enrichment'; job.problemIndex = 0; await save(job);
    return true;
  }
  function validTimestamp(value) {
    if (value == null || String(value).trim() === '') return false;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return Math.abs(numeric < 1e10 ? numeric * 1000 : numeric) <= 8.64e15;
    return Number.isFinite(Date.parse(value));
  }
  function validateDataset(dataset) {
    const p = dataset.metadata;
    if (!dataset.historyDone || dataset.total !== dataset.records.length ||
        !['SOLVED', 'ATTEMPTED'].includes(dataset.problem.questionStatus) || !p || p.titleSlug !== dataset.problem.titleSlug || !p.title?.trim() ||
        !p.content?.trim() || !['easy', 'medium', 'hard'].includes(p.difficulty?.toLowerCase())) {
      throw new Error(`Incomplete problem details for ${dataset.problem.titleSlug}. Nothing unfinished will be uploaded.`);
    }
    for (const record of dataset.records) {
      if (record.detailState !== 'done' || typeof record.submissionDetail?.code !== 'string' ||
          !record.submissionDetail.code.trim() || !statuses[record.status] ||
          !record.langName?.trim() || !validTimestamp(record.timestamp) || !record.id || record.externalId !== String(record.id)) {
        throw new Error(`Incomplete submission ${record.id} for ${dataset.problem.titleSlug}. Nothing unfinished will be uploaded.`);
      }
    }
  }
  async function enrichHistory(job, catalog) {
    for (let index = job.problemIndex; index < catalog.records.length; index++) {
      if (!await identity(job)) return false;
      const dataset = await datasetAt(index, catalog.records[index]);
      if (dataset.metadataState !== 'done') {
        dataset.metadata = await question(dataset.problem.titleSlug);
        dataset.metadataState = 'done'; await persistDataset(index, dataset);
      }
      for (let row = 0; row < dataset.records.length; row++) {
        const record = dataset.records[row];
        if (record.detailState !== 'done') {
          job.message = `Collecting ${index + 1}/${job.problemTotal} · attempt ${row + 1}/${dataset.records.length}…`;
          await save(job);
          record.submissionDetail = await detail(record.id);
          if (typeof record.submissionDetail?.code !== 'string' || !record.submissionDetail.code.trim()) {
            throw new Error(`LeetCode returned no code for submission ${record.id}. Import stopped before upload.`);
          }
          record.detailState = 'done'; await persistDataset(index, dataset);
        }
      }
      validateDataset(dataset);
      job.problemIndex = index + 1; await save(job);
    }
    // Validate the entire collection before the first backend mutation.
    for (let index = 0; index < catalog.records.length; index++) {
      validateDataset(await datasetAt(index, catalog.records[index]));
    }
    job.phase = 'upload'; job.problemIndex = 0; await save(job);
    return true;
  }
  async function uploadHistory(job, catalog) {
    for (let index = job.problemIndex; index < catalog.records.length; index++) {
      const dataset = await datasetAt(index, catalog.records[index]);
      validateDataset(dataset);
      await upload(job, dataset.records.slice(dataset.baseUploaded).map(record => wire(record, dataset)), async count => {
        dataset.baseUploaded += count; await persistDataset(index, dataset);
      });
      if (!dataset.snapshotUploaded) {
        await upload(job, [snapshot(dataset)]);
        dataset.snapshotUploaded = true; await persistDataset(index, dataset);
      }
      job.imported += dataset.records.length; job.problemIndex = index + 1; await save(job);
    }
    job.phase = 'done'; job.state = 'complete';
    job.message = `Imported ${job.problemTotal} problems and ${job.imported} submissions.`;
    await save(job);
    await chrome.storage.local.remove(Array.from({ length: job.problemTotal }, (_, i) => datasetKey(i)));
    await chrome.storage.local.remove([catalogKey, pageKey]);
  }
  async function run() {
    if (running) return;
    const job = await load();
    if (running || !job || job.schemaVersion !== 4 || !['running', 'waiting-login'].includes(job.state)) return;
    running = true; activeJob = job;
    try {
      if (!(await message({ type: 'LEETCODE_IMPORT_STATUS' }))?.owned) return;
      queryPlans = job.queryPlans ||= {};
      if (!await identity(job)) return;
      let catalog = (await chrome.storage.local.get([catalogKey]))[catalogKey];
      if (catalog?.jobId !== job.id) {
        if (job.offset || job.phase !== 'questions') throw new Error('Import checkpoint is missing. Start a new import.');
        catalog = { jobId: job.id, records: [] };
      }
      await collectQuestions(job, catalog);
      if (job.phase === 'history' && !await collectHistory(job, catalog)) return;
      if (job.phase === 'enrichment' && !await enrichHistory(job, catalog)) return;
      if (job.phase === 'upload') await uploadHistory(job, catalog);
    } catch (error) {
      job.state = 'error'; job.message = error.message;
      await save(job).catch(() => {});
    } finally { running = false; activeJob = null; }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[jobKey] && !running) run().catch(() => {});
  });
  // Login may complete without a document navigation.
  setInterval(() => { if (!running) run().catch(() => {}); }, 5000);
  run().catch(() => {});
})();
