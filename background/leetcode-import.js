// Import requests are performed in the signed-in tab; session cookies stay there.
(function () {
  'use strict';
  const T = globalThis.Traverse;
  const { jobKey, pageKey, catalogKey } = T.config.leetcodeImport;
  let starting = false;
  async function session() {
    const k = T.config.keys.auth;
    const stored = await chrome.storage.local.get([k.token, k.user]);
    if (!stored[k.token] || !stored[k.user]?.id) throw new Error('Sign in to Traverse before importing.');
    return { token: stored[k.token], userId: String(stored[k.user].id) };
  }
  async function jobFor(sender, runId) {
    const job = (await chrome.storage.local.get([jobKey]))[jobKey];
    if (!job || sender.tab?.id !== job.tabId || new URL(sender.url).origin !== 'https://leetcode.com') {
      throw new Error('This tab does not own the import.');
    }
    if (job.runId && runId !== job.runId) throw new Error('Import was replaced or restarted.');
    const auth = await session();
    if (auth.userId !== job.userId) throw new Error('Traverse account changed. Switch back to resume this import.');
    return { job, auth };
  }
  T.leetcodeImport = {
    async status(request, sender, reply) {
      const job = (await chrome.storage.local.get([jobKey]))[jobKey];
      reply({ owned: !!job && sender.tab?.id === job.tabId && (!job.runId || request.runId === job.runId) });
    },
    async start(request, sender, reply) {
      if (sender.tab || sender.url !== chrome.runtime.getURL('sidepanel/sidepanel.html')) {
        reply({ success: false, error: 'Start the import from extension settings.' }); return;
      }
      if (starting) { reply({ success: false, error: 'Import is already starting.' }); return; }
      starting = true;
      try {
        const auth = await session();
        let job = (await chrome.storage.local.get([jobKey]))[jobKey];
        const resumable = job && job.schemaVersion === 4 && job.userId === auth.userId && job.state !== 'complete';
        if (!resumable) {
          await chrome.storage.local.remove([pageKey, catalogKey]);
          job = { id: crypto.randomUUID(), userId: auth.userId, schemaVersion: 4, phase: 'questions', offset: 0, imported: 0, collected: 0, warnings: 0, seen: {}, startedAt: Date.now() };
        }
        for (const [field, plan] of Object.entries(job.queryPlans || {})) {
          if (plan.unavailable) delete job.queryPlans[field];
        }
        job.runId = crypto.randomUUID();
        job.state = 'checking'; job.message = 'Checking backend…';
        await chrome.storage.local.set({ [jobKey]: job });
        // Verify authentication and the deployed archive API before collecting
        // private LeetCode data. Health alone does not prove import readiness.
        const readiness = await fetch(`${T.config.backendBaseURL}/api/submissions/bulk-import/records?limit=1`, {
          headers: { Authorization: `Bearer ${auth.token}`, 'ngrok-skip-browser-warning': 'true' },
          credentials: 'omit', signal: AbortSignal.timeout(10000),
        });
        if (!readiness.ok) throw new Error(readiness.status === 401 ? 'Sign in to Traverse, then retry.' : `Backend import is unavailable (${readiness.status}).`);
        const probe = await readiness.json();
        if (!Array.isArray(probe.records)) throw new Error('Backend does not support the history archive.');
        let tab;
        if (resumable && job.tabId) {
          try { tab = await chrome.tabs.get(job.tabId); } catch (_) { /* closed tab */ }
        }
        if (tab && new URL(tab.url).origin === 'https://leetcode.com') {
          await chrome.tabs.update(tab.id, { url: T.config.leetcodeImport.startURL, active: true });
        } else {
          tab = await chrome.tabs.create({ url: T.config.leetcodeImport.startURL, active: true });
        }
        job.tabId = tab.id;
        job.state = 'running';
        job.message = 'Opening LeetCode and reading your full submission history…';
        await chrome.storage.local.set({ [jobKey]: job });
        reply({ success: true });
      } catch (error) {
        const job = (await chrome.storage.local.get([jobKey]))[jobKey];
        const message = /timeout|timed out/i.test(error.name + ' ' + error.message) ? 'Backend check timed out. Retry when connected.' : error.message;
        if (job?.state === 'checking') await chrome.storage.local.set({ [jobKey]: { ...job, state: 'error', message } });
        reply({ success: false, error: message });
      } finally { starting = false; }
    },
    async fetch(request, sender, reply) {
      try {
        await jobFor(sender, request.runId);
        if (request.path !== '/graphql/') throw new Error('Unsupported LeetCode import request.');
        const results = await chrome.scripting.executeScript({
          target: { tabId: sender.tab.id }, world: 'MAIN',
          func: async (path, body) => {
            const csrf = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)?.[1];
            try {
              const response = await fetch(path, {
                method: body ? 'POST' : 'GET', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrftoken': decodeURIComponent(csrf) } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {}),
                signal: AbortSignal.timeout(25000),
              });
              let data;
              try { data = await response.json(); }
              catch (error) {
                const timeout = /timeout|abort/i.test(error.name + ' ' + error.message);
                return { success: false, source: 'leetcode', status: response.status,
                  code: timeout ? 'timeout' : 'response', retryable: timeout || response.status >= 500,
                  error: timeout ? 'LeetCode response timed out.' : 'LeetCode returned a non-JSON response. Complete any verification in this tab.' };
              }
              return { success: response.ok, source: 'leetcode', status: response.status, data,
                retryable: response.status === 429 || response.status >= 500 };
            } catch (error) {
              return { success: false, source: 'leetcode', retryable: true,
                code: /timeout|abort/i.test(error.name + ' ' + error.message) ? 'timeout' : 'network', error: error.message };
            }
          }, args: [request.path, request.body || null],
        });
        reply(results[0]?.result || { success: false, source: 'leetcode', retryable: true, error: 'LeetCode tab did not respond.' });
      } catch (error) { reply({ success: false, source: 'leetcode', error: error.message }); }
    },
    async upload(request, sender, reply) {
      try {
        const { job, auth } = await jobFor(sender, request.runId);
        if (job.phase !== 'upload' || job.state !== 'running') throw new Error('LeetCode capture must be complete before upload.');
        if (!job.username || request.username !== job.username) throw new Error('LeetCode account changed during import.');
        if (!Array.isArray(request.submissions) || !request.submissions.length || request.submissions.length > 20) throw new Error('Invalid import batch.');
        try {
          const response = await fetch(`${T.config.backendBaseURL}/api/submissions/bulk-import`, {
            method: 'POST', credentials: 'omit', signal: AbortSignal.timeout(25000),
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}`, 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({ source: 'leetcode', captureComplete: true, username: job.username, submissions: request.submissions }),
          });
          let data;
          try { data = await response.json(); }
          catch (error) {
            const timeout = /timeout|abort/i.test(error.name + ' ' + error.message);
            reply({ success: false, source: 'backend', status: response.status,
              code: timeout ? 'timeout' : 'response', retryable: timeout || response.status >= 500,
              error: timeout ? 'Backend response timed out.' : 'Backend returned an unreadable response.' }); return;
          }
          reply({ success: response.ok, status: response.status, data, source: 'backend',
            retryable: response.status === 429 || response.status >= 500 });
        } catch (error) {
          reply({ success: false, source: 'backend', retryable: true,
            code: /timeout|abort/i.test(error.name + ' ' + error.message) ? 'timeout' : 'network', error: error.message });
        }
      } catch (error) { reply({ success: false, source: 'backend', error: error.message }); }
    },
  };
  // Tab IDs may change after a browser restart. Leave a retryable checkpoint
  // instead of a permanently disabled Settings button.
  const pauseOnRestart = async () => {
    const job = (await chrome.storage.local.get([jobKey]))[jobKey];
    if (job && ['checking', 'running', 'waiting-login'].includes(job.state)) {
      await chrome.storage.local.set({ [jobKey]: { ...job, state: 'error',
        message: 'Import paused after the browser or extension restarted. Click Retry to resume.' } });
    }
  };
  chrome.runtime.onStartup?.addListener(pauseOnRestart);
  chrome.runtime.onInstalled?.addListener(pauseOnRestart);
  chrome.tabs?.onRemoved?.addListener(async (tabId) => {
    const job = (await chrome.storage.local.get([jobKey]))[jobKey];
    if (job?.tabId === tabId && ['checking', 'running', 'waiting-login'].includes(job.state)) {
      await chrome.storage.local.set({ [jobKey]: { ...job, state: 'error', message: 'Import paused because the LeetCode tab closed. Click Retry to resume.' } });
    }
  });
})();
