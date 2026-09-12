// GeeksforGeeks content script for Traverse extension
// Extends PlatformAdapter — preserves working DOM verdict and button monitoring.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});
  const PLATFORM = typeof DSA_PLATFORMS !== 'undefined' ? DSA_PLATFORMS.GEEKSFORGEEKS : 'geeksforgeeks';
  const PlatformAdapter = T.PlatformAdapter || class {};

  class GeeksforGeeksAdapter extends PlatformAdapter {
    constructor() {
      super(PLATFORM, 'GeeksforGeeks');

      this.topics = [];
      this.hasAttachedSubmitListener = false;
    }

    async initialize() {
      try {
        this.setupEventListeners();

        const slug = this.getCurrentProblemSlug();
        await this.loadState(slug);

        if (this.isProblemPage()) {
          this.startTimer(slug);
          setTimeout(() => this.extractMetadata(), 1500);
        }

        this.logger.log('GeeksforGeeks adapter initialized');
      } catch (err) {
        this.logger.error('Failed to initialize GFG adapter:', err);
      }
    }

    isProblemPage() {
      const url = window.location.href;
      return (
        url.includes('geeksforgeeks.org') &&
        (url.includes('/problems/') || url.includes('/batch/'))
      );
    }

    getCurrentProblemSlug() {
      const url = window.location.href;
      const match = url.match(/\/problems\/([^\/\?#]+)/);
      return match ? match[1] : 'unknown';
    }

    setupEventListeners() {
      this.observeUrlChanges(async () => {
        const slug = this.getCurrentProblemSlug();
        if (this.isProblemPage()) {
          this.resetTimer();
          this.startTimer(slug);
          await this.loadState(slug);
          setTimeout(() => this.extractMetadata(), 1500);
        } else {
          this.hideTimer();
        }
      });

      this.attachSubmitButtonListener();
      this.observeRunButton();
    }

    attachSubmitButtonListener() {
      if (this.hasAttachedSubmitListener) return;

      const checkForButton = () => {
        const btn = document.querySelector('button.problems_submit_button__6QoNQ, [class*="problems_submit_button"]');
        if (btn && !btn.hasAttribute('data-traverse-listener')) {
          btn.setAttribute('data-traverse-listener', 'true');
          this.hasAttachedSubmitListener = true;
          this.logger.log('Submit button listener attached');

          btn.addEventListener('click', async () => {
            this.logger.log('Submit button clicked');
            const code = this.getCurrentCode();
            const lang = this.getCurrentLanguage();
            await this.handleSubmissionAttempt(code, lang);
            this.monitorSubmissionResult();
          });
        }
      };

      checkForButton();
      const observer = new MutationObserver(() => checkForButton());
      observer.observe(document.body, { childList: true, subtree: true });
    }

    observeRunButton() {
      const checkForButton = () => {
        const btn = document.querySelector('button.problems_compile_button__Lfluz, [class*="compile_button"]');
        if (btn && !btn.hasAttribute('data-traverse-run-listener')) {
          btn.setAttribute('data-traverse-run-listener', 'true');
          btn.addEventListener('click', () => {
            setTimeout(async () => {
              const code = this.getCurrentCode();
              const lang = this.getCurrentLanguage();
              await this.handleRunAttempt(code, lang);
              this.observeRunResult();
            }, 500);
          });
        }
      };

      checkForButton();
      const observer = new MutationObserver(() => checkForButton());
      observer.observe(document.body, { childList: true, subtree: true });
    }

    async observeRunResult() {
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        const resultSelectors = [
          '.problems_content__kWANg',
          '[class*="result"]',
          '[class*="output"]',
          '.compile_and_run',
          '[class*="console"]',
        ];

        for (const sel of resultSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent) {
            const txt = el.textContent.toLowerCase();
            if (txt.includes('correct') || txt.includes('passed') || (txt.includes('output:') && !txt.includes('expected:'))) {
              clearInterval(interval);
              await this.handleRunResult(true);
              return;
            }
            if (txt.includes('wrong') || txt.includes('failed') || txt.includes('error') || txt.includes('expected:')) {
              clearInterval(interval);
              await this.handleRunResult(false);
              return;
            }
          }
        }

        if (attempts >= 15) {
          clearInterval(interval);
          await this.handleRunResult(false);
        }
      }, 1000);
    }

    monitorSubmissionResult() {
      this.logger.log('Monitoring submission result...');
      let attempts = 0;

      const interval = setInterval(async () => {
        attempts++;
        const resultSelectors = [
          '[class*="problems_content"]',
          '.submission-result',
          '.result',
          '[class*="result"]',
          '[class*="status"]',
          '[class*="verdict"]',
          '.ui.message',
        ];

        for (const sel of resultSelectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent) {
            const txt = el.textContent.toLowerCase();
            if (txt.includes('problem solved successfully') || txt.includes('correct answer') || txt.includes('accepted')) {
              clearInterval(interval);
              const stats = this.extractStats();
              await this.handleSubmissionResult(true, stats);
              return;
            }
            if (txt.includes('wrong answer') || txt.includes('compilation error') || txt.includes('runtime error') || txt.includes('time limit exceeded')) {
              clearInterval(interval);
              const stats = this.extractStats();
              stats.status = el.textContent.trim();
              await this.handleSubmissionResult(false, stats);
              return;
            }
          }
        }

        if (attempts >= 20) {
          clearInterval(interval);
          this.logger.warn('Submission monitoring timed out');
          await this.handleSubmissionResult(false, { status: 'Timeout' });
        }
      }, 1000);
    }

    extractStats() {
      const stats = {};
      const timeEl = document.querySelector('[class*="time"], [class*="Time"]');
      if (timeEl) stats.runtime = timeEl.textContent.trim();
      const memEl = document.querySelector('[class*="memory"], [class*="Memory"]');
      if (memEl) stats.memory = memEl.textContent.trim();
      return stats;
    }

    getCurrentCode() {
      if (window.ace?.edit) {
        const editors = document.querySelectorAll('.ace_editor');
        if (editors.length > 0) {
          try {
            const val = window.ace.edit(editors[0]).getValue();
            if (val && val.length > 10) return this.sanitizeText(val);
          } catch (_) {}
        }
      }
      if (window.monaco?.editor) {
        const models = window.monaco.editor.getModels();
        if (models.length > 0) {
          const val = models[0].getValue();
          if (val && val.length > 10) return this.sanitizeText(val);
        }
      }
      const ta = document.querySelector('textarea');
      if (ta && ta.value && ta.value.length > 10) {
        return this.sanitizeText(ta.value);
      }
      return '';
    }

    async extractCode() {
      return this.getCurrentCode();
    }

    getCurrentLanguage() {
      const el = document.querySelector('div.problems_language_dropdown__DgjFb .menu [role="option"].active.selected') ||
        document.querySelector('[class*="language_dropdown"] .selected, [class*="language"]');
      return el?.textContent?.trim().toLowerCase() || 'cpp';
    }

    getProblemTitle() {
      for (const sel of [
        '.problems_header_content__title h3',
        '[class*="problems_header_content__title"] h3',
        '.problem-title',
        'h1',
        'h2',
        'h3',
      ]) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          const t = el.textContent.trim().replace(/^\d+\.\s*/, '');
          if (t.length > 3 && !t.toLowerCase().includes('geeksforgeeks')) return t;
        }
      }
      return document.title.replace(/\s*-\s*GeeksforGeeks$/, '').trim() || null;
    }

    getProblemNumber() {
      const el = document.querySelector('.problems_header_content__title h3, h1');
      const match = el?.textContent.match(/^(\d+)\./);
      return match ? match[1] : null;
    }

    getDifficulty() {
      const el = document.querySelector('[class*="problems_header_description"] span:first-child, .difficulty-tag, [class*="difficulty"]');
      return el?.textContent.trim() || 'Medium';
    }

    getTopicTags() {
      const tags = [];
      const els = document.querySelectorAll('.problems_tag_container__kWANg + .content a, [class*="topic"] a');
      for (const el of els) {
        const txt = el.textContent.trim();
        if (txt && !tags.includes(txt)) tags.push(txt);
      }
      return tags;
    }

    async extractMetadata() {
      const title = this.getProblemTitle();
      if (!title) return null;

      const topics = this.getTopicTags();
      if (topics.length > 0) this.topics = topics;

      const problemInfo = {
        title,
        number: this.getProblemNumber(),
        difficulty: this.normalizeDifficulty(this.getDifficulty()),
        url: window.location.href.split('?')[0],
        language: this.getCurrentLanguage(),
        code: this.getCurrentCode(),
        topics: this.topics.length > 0 ? this.topics : ['General'],
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
      instance = new GeeksforGeeksAdapter();
      instance.initialize();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
