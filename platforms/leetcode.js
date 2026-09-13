// Traverse — LeetCode adapter.
//
// Verdicts and submitted code come from the network (see page/net-interceptor.js).
// The Monaco bridge is used only to read the editor *before* a submission, so
// the stored record has code attached even for a problem the user has not
// submitted yet.
//
// Network flow:
//   POST /problems/{slug}/submit/            -> request carries typed_code + lang
//                                            -> response carries submission_id
//   POST /problems/{slug}/interpret_solution/ -> request carries typed_code + lang
//                                            -> response carries interpret_id
//   GET  /submissions/detail/{id}/check/     -> response carries the verdict
//
// The check endpoint is polled by the site while the judge runs, so the same
// rule fires repeatedly and the early payloads carry no verdict at all. Only a
// finished run may produce a verdict — see isFinalCheck().

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  const ACCEPTED_STATUS_CODE = 10;

  const SUBMIT_URL = /\/submit\/$/;
  const RUN_URL = /\/interpret_solution\/$/;
  const CHECK_URL = /\/detail\/([^/]+)\/(?:v2\/)?check\/?$/;

  const pathOf = (url) => String(url || '').split('?')[0];

  /**
   * The site polls the check endpoint while the judge is still running, and
   * those intermediate payloads carry no verdict at all (`{"state":"PENDING"}`,
   * `{"state":"STARTED"}`). `state` flips to `SUCCESS` once the run finishes —
   * including for compile errors, so `SUCCESS` means "judged", not "accepted".
   *
   * Reading a pending poll as a rejection is what recorded solved problems as
   * failures: it produced a verdict with no status (`REJECTED (unknown)`) and
   * consumed the pending submission id, so the real verdict that arrived on the
   * next poll was discarded.
   */
  const isFinalCheck = (data) =>
    String(data.state || '').toUpperCase() === 'SUCCESS' ||
    // Defensive: older/other payload shapes omit `state` but carry the verdict.
    (!data.state && (data.status_code !== undefined || data.status_msg !== undefined));

  class LeetCodeAdapter extends T.PlatformAdapter {
    static platform = 'leetcode';

    constructor() {
      super({
        platform: 'leetcode',
        defaultDifficulty: 0,
        defaultTopics: [],
        defaultLanguage: 'cpp',
        extractDelay: 1200,
        netFilters: [
          { url: '/submit/$', methods: ['POST'] },
          { url: '/interpret_solution/$', methods: ['POST'] },
          { url: '/detail/[^/]+/(?:v2/)?check/?$', methods: ['GET'] },
        ],
      });

      this.pendingCodeRequests = new Map();
      this.currentSubmissionId = null;
      this.currentRunId = null;
      this.topics = [];
    }

    async init() {
      this.listenForBridgeResponses();
      await super.init();
    }

    /* ── site-specific contract ── */

    isProblemPage() {
      // `includes` (not startsWith) so contest problem URLs still match.
      return window.location.href.includes('/problems/');
    }

    getCurrentProblemKey() {
      const match = window.location.href.match(/\/problems\/([^/]+)/);
      return match ? match[1] : 'unknown';
    }

    /* ── network events ── */

    async onNetEvent(event) {
      const { phase, url, method, requestBody, response } = event;
      const path = pathOf(url);

      if (phase === 'request') {
        if (method === 'POST' && SUBMIT_URL.test(path)) {
          const code = requestBody && requestBody.typed_code;
          if (code) await this.captureSubmit(code, (requestBody && requestBody.lang) || this.defaultLanguage);
          return;
        }
        if (method === 'POST' && RUN_URL.test(path)) {
          const code = requestBody && requestBody.typed_code;
          if (code) await this.captureRun(code, (requestBody && requestBody.lang) || this.defaultLanguage);
        }
        return;
      }

      if (phase !== 'response') return;

      const checkMatch = path.match(CHECK_URL);
      if (checkMatch) {
        await this.handleCheckResponse(checkMatch[1], response);
        return;
      }

      // Remember which submission/run the following check request belongs to.
      if (SUBMIT_URL.test(path)) {
        this.currentSubmissionId = (response && response.submission_id) || null;
        this.logger.log(`submission id: ${this.currentSubmissionId}`);
      } else if (RUN_URL.test(path)) {
        this.currentRunId = (response && response.interpret_id) || null;
        this.logger.log(`run id: ${this.currentRunId}`);
      }
    }

    async handleCheckResponse(id, data) {
      if (!id || !data) return;

      // A pending poll must not be turned into a verdict, and must not consume
      // the pending id — the real verdict arrives on a later poll.
      if (!isFinalCheck(data)) {
        this.logger.log(`check ${id} still judging (${data.state || 'no state'})`);
        return;
      }

      const runSuccess = Boolean(data.run_success);

      if (this.currentSubmissionId && String(id) === String(this.currentSubmissionId)) {
        this.currentSubmissionId = null;

        const accepted =
          data.status_code === ACCEPTED_STATUS_CODE ||
          data.status_msg === 'Accepted' ||
          (runSuccess &&
            data.total_correct !== undefined &&
            data.total_correct > 0 &&
            data.total_correct === data.total_testcases);

        await this.submitVerdict({
          accepted,
          status: data.status_msg || '',
          stats: LeetCodeAdapter.extractPerformanceStats(data),
        });
        return;
      }

      if (this.currentRunId && String(id) === String(this.currentRunId)) {
        this.currentRunId = null;

        const success =
          runSuccess &&
          (data.correct_answer === true ||
            (data.total_correct !== undefined &&
              data.total_correct > 0 &&
              data.total_correct === data.total_testcases));

        await this.runVerdict(success);
      }
    }

    /** LeetCode reports runtime/memory plus percentile "beats" figures. */
    static extractPerformanceStats(checkData) {
      const stats = {
        runtime: checkData.status_runtime || '',
        memory: checkData.status_memory || '',
        status: checkData.status_msg || '',
      };

      const runtimePercentile = checkData.runtime_percentile
        ? `${checkData.runtime_percentile.toFixed(1)}%`
        : '';
      const memoryPercentile = checkData.memory_percentile
        ? `${checkData.memory_percentile.toFixed(1)}%`
        : '';

      if (runtimePercentile && memoryPercentile) {
        stats.beats = `Beats ${runtimePercentile} for runtime, ${memoryPercentile} for memory`;
      } else if (runtimePercentile) {
        stats.beats = `Beats ${runtimePercentile} for runtime`;
      }
      return stats;
    }

    /* ── Monaco bridge (page-world code reader) ── */

    listenForBridgeResponses() {
      window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const data = event.data || {};
        if (data.source !== 'LeetFeedback' || data.type !== 'LEETFEEDBACK_CODE') return;

        const resolver = this.pendingCodeRequests.get(data.requestId);
        if (!resolver) return;

        this.pendingCodeRequests.delete(data.requestId);
        resolver({ code: T.util.sanitizeCode(data.code), language: data.language });
      });
    }

    async getCodeViaBridge(timeoutMs = 1200) {
      const requestId = Math.random().toString(36).slice(2);
      const answer = new Promise((resolve) => this.pendingCodeRequests.set(requestId, resolve));
      const timeout = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));

      window.postMessage({ source: 'LeetFeedback', type: 'LEETFEEDBACK_REQUEST_CODE', requestId }, '*');

      return (await Promise.race([answer, timeout])) || { code: '', language: 'text' };
    }

    /* ── metadata ── */

    async extractProblemInfo() {
      const title = this.extractTitle();
      if (!title) return null;

      const topics = this.extractTopics();
      if (topics.length > 0) this.topics = topics;

      return {
        title,
        number: this.extractNumber(),
        difficulty: this.extractDifficulty(),
        url: window.location.href.split('?')[0],
        language: await this.extractLanguage(),
        code: await this.extractCode(),
        topics: this.topics,
      };
    }

    extractTitle() {
      for (const selector of ['.text-title-large', '[data-cy="question-title"]', 'h1']) {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) {
          return el.textContent.trim().replace(/^\d+\.\s*/, '');
        }
      }
      return null;
    }

    extractNumber() {
      const el = document.querySelector('.text-title-large, [data-cy="question-title"], h1');
      const match = el && el.textContent.match(/^(\d+)\./);
      return match ? match[1] : null;
    }

    extractDifficulty() {
      for (const selector of [
        '.text-difficulty-easy, .text-difficulty-medium, .text-difficulty-hard',
        '[class*="text-difficulty"]',
        '[class*="difficulty"]',
      ]) {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) return el.textContent.trim();
      }
      return 'Easy';
    }

    extractTopics() {
      const els = document.querySelectorAll('div.mt-2.flex.flex-wrap.gap-1.pl-7 a');
      return Array.from(els)
        .map((el) => el.textContent.trim())
        .filter(Boolean);
    }

    /** Prefer the code the user actually submitted, then the live editor. */
    async extractCode() {
      const submitted = this.tracker.currentSubmissionAttempt;
      if (submitted && submitted.code) return submitted.code;

      const bridge = await this.getCodeViaBridge(1000);
      if (bridge.code && bridge.code.length > 10) return bridge.code;

      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models.length > 0) {
          const value = T.util.sanitizeCode(models[0].getValue());
          if (value && value.length > 10) return value;
        }
      }
      return '';
    }

    async extractLanguage() {
      const bridge = await this.getCodeViaBridge(500);
      if (bridge.language && bridge.language !== 'text') return bridge.language;

      const editor = document.querySelector('[data-mode-id]');
      if (editor) return editor.getAttribute('data-mode-id');

      const button = document.querySelector('button[id*="headlessui-listbox-button"]');
      if (button) return button.textContent.trim().toLowerCase();

      return this.defaultLanguage;
    }
  }

  T.LeetCodeAdapter = LeetCodeAdapter;
  T.startPlatform(LeetCodeAdapter);
})();
