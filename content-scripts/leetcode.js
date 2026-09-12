// LeetCode content script for Traverse extension
// Extends PlatformAdapter — delegates state, persistence, timers, and the submission pipeline.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});
  const PLATFORM = typeof DSA_PLATFORMS !== 'undefined' ? DSA_PLATFORMS.LEETCODE : 'leetcode';
  const PlatformAdapter = T.PlatformAdapter || class {};

  class LeetCodeAdapter extends PlatformAdapter {
    constructor() {
      super(PLATFORM, 'LeetCode');

      this.pendingCodeRequests = new Map();
      this.currentSubmissionId = null;
      this.currentRunId = null;
      this.topics = [];
    }

    async initialize() {
      try {
        this.injectMonacoBridge();
        this.injectInterceptor();
        this.setupMessageListener();
        this.setupEventListeners();

        const slug = this.getCurrentProblemSlug();
        await this.loadState(slug);

        if (this.isProblemPage()) {
          this.startTimer(slug);
          setTimeout(() => this.extractMetadata(), 1200);
        }

        this.logger.log('LeetCode adapter initialized successfully');
      } catch (err) {
        this.logger.error('Failed to initialize LeetCode adapter:', err);
      }
    }

    isProblemPage() {
      const url = window.location.href;
      return url.includes('/problems/') && url.includes('leetcode.com');
    }

    getCurrentProblemSlug() {
      const match = window.location.href.match(/\/problems\/([^\/]+)/);
      return match ? match[1] : 'unknown';
    }

    injectMonacoBridge() {
      const id = 'leetfeedback-monaco-bridge';
      if (document.getElementById(id)) return;
      try {
        const script = document.createElement('script');
        script.id = id;
        script.src = chrome.runtime.getURL('utils/monaco-bridge.js');
        (document.head || document.documentElement).appendChild(script);
      } catch (e) {
        this.logger.warn('Failed to inject monaco bridge:', e);
      }
    }

    injectInterceptor() {
      const id = 'leetfeedback-interceptor';
      if (document.getElementById(id)) return;
      try {
        const script = document.createElement('script');
        script.id = id;
        script.src = chrome.runtime.getURL('utils/interceptor.js');
        (document.head || document.documentElement).appendChild(script);
        script.addEventListener('load', () => {
          this.logger.log('Interceptor script injected');
          script.remove();
        });
      } catch (e) {
        this.logger.warn('Failed to inject interceptor:', e);
      }
    }

    setupMessageListener() {
      window.addEventListener('message', async (event) => {
        if (event.source !== window) return;
        const data = event.data || {};

        // Monaco bridge responses
        if (data.source === 'LeetFeedback') {
          if (data.type === 'LEETFEEDBACK_CODE' && data.requestId) {
            const resolver = this.pendingCodeRequests.get(data.requestId);
            if (resolver) {
              this.pendingCodeRequests.delete(data.requestId);
              resolver({ code: this.sanitizeText(data.code), language: data.language });
            }
          }
          return;
        }

        // Network interceptor events
        try {
          if (data.type === 'LEETCODE_CODE_SUBMIT') {
            const payload = data.payload || {};
            this.logger.log('Captured submission attempt:', payload);
            await this.handleSubmissionAttempt(payload.usercode, payload.language);
          } else if (data.type === 'LEETCODE_CODE_RUN') {
            const payload = data.payload || {};
            this.logger.log('Captured run attempt:', payload);
            await this.handleRunAttempt(payload.usercode, payload.language);
          } else if (data.type === 'LEETCODE_SUBMIT_ID') {
            this.currentSubmissionId = data.payload?.submission_id;
            this.logger.log(`Captured submission ID: ${this.currentSubmissionId}`);
          } else if (data.type === 'LEETCODE_RUN_ID') {
            this.currentRunId = data.payload?.interpret_id;
            this.logger.log(`Captured run ID: ${this.currentRunId}`);
          } else if (data.type === 'LEETCODE_CHECK_RESPONSE') {
            const { id, data: checkData } = data.payload || {};
            await this.handleCheckResponse(id, checkData);
          }
        } catch (err) {
          this.logger.error('Error handling interceptor message:', err);
        }
      });
    }

    async handleCheckResponse(id, checkData) {
      if (!id || !checkData) return;
      const runSuccess = Boolean(checkData.run_success);

      // 1. Submission check
      if (this.currentSubmissionId && String(id) === String(this.currentSubmissionId)) {
        const isAccepted =
          checkData.status_code === 10 ||
          checkData.status_msg === 'Accepted' ||
          (runSuccess &&
            checkData.total_correct !== undefined &&
            checkData.total_correct > 0 &&
            checkData.total_correct === checkData.total_testcases);

        const stats = this.extractPerformanceStats(checkData);
        await this.handleSubmissionResult(isAccepted, stats, checkData);
        this.currentSubmissionId = null;
      }

      // 2. Run check
      else if (this.currentRunId && String(id) === String(this.currentRunId)) {
        const isRunSuccess =
          runSuccess &&
          (checkData.correct_answer === true ||
            (checkData.total_correct !== undefined &&
              checkData.total_correct > 0 &&
              checkData.total_correct === checkData.total_testcases));

        await this.handleRunResult(isRunSuccess);
        this.currentRunId = null;
      }
    }

    setupEventListeners() {
      this.observeUrlChanges(async (newUrl) => {
        const slug = this.getCurrentProblemSlug();
        if (this.isProblemPage()) {
          this.resetTimer();
          this.startTimer(slug);
          await this.loadState(slug);
          setTimeout(() => this.extractMetadata(), 1200);
        } else {
          this.hideTimer();
        }
      });
    }

    async getCodeViaBridge(timeoutMs = 1200) {
      try {
        const requestId = Math.random().toString(36).slice(2);
        const p = new Promise((resolve) => {
          this.pendingCodeRequests.set(requestId, resolve);
        });
        window.postMessage({ source: 'LeetFeedback', type: 'LEETFEEDBACK_REQUEST_CODE', requestId }, '*');
        const timer = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
        const result = await Promise.race([p, timer]);
        return result || { code: '', language: 'text' };
      } catch (_) {
        return { code: '', language: 'text' };
      }
    }

    async extractCode() {
      if (this.tracker?.currentSubmissionAttempt?.code) {
        return this.tracker.currentSubmissionAttempt.code;
      }
      const bridge = await this.getCodeViaBridge(1000);
      if (bridge.code && bridge.code.length > 10) return bridge.code;

      if (window.monaco?.editor) {
        const models = window.monaco.editor.getModels();
        if (models.length > 0) {
          const val = this.sanitizeText(models[0].getValue());
          if (val && val.length > 10) return val;
        }
      }
      return '';
    }

    async extractLanguage() {
      const bridge = await this.getCodeViaBridge(500);
      if (bridge.language && bridge.language !== 'text') return bridge.language;

      const editor = document.querySelector('[data-mode-id]');
      if (editor) return editor.getAttribute('data-mode-id');

      const btn = document.querySelector('button[id*="headlessui-listbox-button"]');
      if (btn) return btn.textContent.trim().toLowerCase();

      return 'cpp';
    }

    extractTitle() {
      for (const sel of ['.text-title-large', '[data-cy="question-title"]', 'h1']) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          return el.textContent.trim().replace(/^\d+\.\s*/, '');
        }
      }
      return null;
    }

    extractNumber() {
      const el = document.querySelector('.text-title-large, [data-cy="question-title"], h1');
      const match = el?.textContent.match(/^(\d+)\./);
      return match ? match[1] : null;
    }

    extractDifficulty() {
      for (const sel of [
        '.text-difficulty-easy, .text-difficulty-medium, .text-difficulty-hard',
        '[class*="text-difficulty"]',
        '[class*="difficulty"]',
      ]) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          return el.textContent.trim();
        }
      }
      return 'Easy';
    }

    extractTopics() {
      try {
        const els = document.querySelectorAll('div.mt-2.flex.flex-wrap.gap-1.pl-7 a');
        return Array.from(els)
          .map((el) => el.textContent.trim())
          .filter(Boolean);
      } catch (_) {
        return [];
      }
    }

    extractPerformanceStats(checkData = null) {
      const stats = {};
      if (checkData) {
        stats.runtime = checkData.status_runtime || '';
        stats.memory = checkData.status_memory || '';
        stats.status = checkData.status_msg || '';
        if (checkData.runtime_percentile !== undefined || checkData.memory_percentile !== undefined) {
          const rP = checkData.runtime_percentile ? `${checkData.runtime_percentile.toFixed(1)}%` : '';
          const mP = checkData.memory_percentile ? `${checkData.memory_percentile.toFixed(1)}%` : '';
          if (rP && mP) stats.beats = `Beats ${rP} for runtime, ${mP} for memory`;
          else if (rP) stats.beats = `Beats ${rP} for runtime`;
        }
        return stats;
      }

      const rt = document.querySelector('[class*="runtime"]');
      if (rt) stats.runtime = rt.textContent.trim();
      const mem = document.querySelector('[class*="memory"]');
      if (mem) stats.memory = mem.textContent.trim();
      return stats;
    }

    async extractMetadata() {
      const title = this.extractTitle();
      if (!title) return null;

      const topics = this.extractTopics();
      if (topics.length > 0) this.topics = topics;

      const problemInfo = {
        title,
        number: this.extractNumber(),
        difficulty: this.extractDifficulty(),
        url: window.location.href.split('?')[0],
        language: await this.extractLanguage(),
        code: await this.extractCode(),
        topics: this.topics,
      };

      this.currentProblem = problemInfo;
      await this.storeProblemData(problemInfo, false, 0);
      return problemInfo;
    }
  }

  // Initialize singleton
  let instance = null;
  function start() {
    if (!instance) {
      instance = new LeetCodeAdapter();
      instance.initialize();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
