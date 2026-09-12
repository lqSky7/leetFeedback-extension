// CodeChef content script for Traverse extension
// Extends PlatformAdapter — preserves working button click & verdict checking logic.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});
  const PLATFORM = typeof DSA_PLATFORMS !== 'undefined' ? DSA_PLATFORMS.CODECHEF : 'codechef';
  const PlatformAdapter = T.PlatformAdapter || class {};

  class CodeChefAdapter extends PlatformAdapter {
    constructor() {
      super(PLATFORM, 'CodeChef');

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

        this.logger.log('CodeChef adapter initialized');
      } catch (err) {
        this.logger.error('Failed to initialize CodeChef adapter:', err);
      }
    }

    isProblemPage() {
      const url = window.location.href;
      return url.includes('codechef.com') && url.includes('/problems/');
    }

    getCurrentProblemSlug() {
      const match = window.location.pathname.match(/\/problems\/([^\/\?#]+)/);
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
        const btn = document.querySelector('#submit_btn, button[id*="submit"]');
        if (btn && !btn.hasAttribute('data-traverse-submit-listener')) {
          btn.setAttribute('data-traverse-submit-listener', 'true');
          this.hasAttachedSubmitListener = true;
          this.logger.log('Submit button listener attached');

          btn.addEventListener('click', async () => {
            this.logger.log('Submit button clicked');
            const code = this.getCurrentCode();
            const lang = this.getCurrentLanguage();
            await this.handleSubmissionAttempt(code, lang);
            this.monitorSubmissionResult();
          }, true);
        }
      };

      checkForButton();
      setInterval(checkForButton, 1200);
    }

    observeRunButton() {
      const checkForButton = () => {
        const btn =
          document.querySelector('#run_btn, button[id*="run_btn"], button[class*="run_btn"]') ||
          Array.from(document.querySelectorAll('button')).find(
            (b) => b.textContent && b.textContent.trim().toLowerCase() === 'run'
          );

        if (btn && !btn.hasAttribute('data-traverse-run-listener')) {
          btn.setAttribute('data-traverse-run-listener', 'true');
          btn.addEventListener('click', () => {
            setTimeout(async () => {
              const code = this.getCurrentCode();
              const lang = this.getCurrentLanguage();
              await this.handleRunAttempt(code, lang);
              this.observeRunResult();
            }, 600);
          });
        }
      };

      checkForButton();
      setInterval(checkForButton, 1500);
    }

    async observeRunResult() {
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        const selectors = [
          'div[class*="_run__container"]',
          '[class*="run-result"]',
          '[class*="output"]',
          '.console-output',
        ];

        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent) {
            const txt = el.textContent.toLowerCase();
            if (txt.includes('correct') || txt.includes('passed') || (txt.includes('output:') && !txt.includes('expected:'))) {
              clearInterval(interval);
              await this.handleRunResult(true);
              return;
            }
            if (txt.includes('wrong') || txt.includes('failed') || txt.includes('error') || txt.includes('time limit')) {
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
        const selectors = [
          'div[class*="_run__container"] span',
          'div[class*="_status-success"] span',
          '[class*="success"] span',
          '.submission-result',
          '.status-text',
          '[class*="verdict"]',
        ];

        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent.trim().length > 2) {
            const txt = el.textContent.trim().toLowerCase();

            if (txt.includes('wrong answer') || txt.includes('compilation error') || txt.includes('time limit') || txt.includes('runtime error') || txt.includes('partial') || txt.includes('failed')) {
              clearInterval(interval);
              const stats = this.extractStats();
              stats.status = el.textContent.trim();
              await this.handleSubmissionResult(false, stats);
              return;
            }

            if (txt.includes('correct') || txt.includes('accepted') || txt.includes('success') || txt.includes('100')) {
              clearInterval(interval);
              const stats = this.extractStats();
              await this.handleSubmissionResult(true, stats);
              return;
            }
          }
        }

        if (attempts >= 25) {
          clearInterval(interval);
          this.logger.warn('Submission result monitoring timed out');
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
      if (window.monaco?.editor) {
        const models = window.monaco.editor.getModels();
        if (models.length > 0) {
          const val = models[0].getValue();
          if (val && val.length > 10) return this.sanitizeText(val);
        }
      }
      if (window.ace?.edit) {
        const editors = document.querySelectorAll('.ace_editor');
        if (editors.length > 0) {
          try {
            const val = window.ace.edit(editors[0]).getValue();
            if (val && val.length > 10) return this.sanitizeText(val);
          } catch (_) {}
        }
      }
      const ta = document.querySelector('textarea.ace_text-input, textarea');
      if (ta && ta.value && ta.value.length > 10) {
        return this.sanitizeText(ta.value);
      }
      return '';
    }

    async extractCode() {
      return this.getCurrentCode();
    }

    getCurrentLanguage() {
      const el = document.querySelector('#language-select');
      if (!el) return 'cpp';
      let text = el.tagName === 'SELECT' ? el.options[el.selectedIndex]?.text : el.textContent;
      return (text || 'cpp').replace(/\(.*?\)/, '').trim();
    }

    getProblemTitle() {
      const titleEl = document.querySelector('div[class*="_problem__title"] h1, h1[class*="title"], h1');
      if (titleEl && titleEl.textContent.trim()) {
        const t = titleEl.textContent.trim().replace(/^\d+\.\s*/, '');
        if (t.length > 2) return t;
      }
      const match = window.location.pathname.match(/problems\/([^\/\?]+)/);
      return match ? match[1].replace(/-/g, ' ') : 'Unknown CodeChef Problem';
    }

    getDifficulty() {
      const el = document.querySelector('[class*="difficulty"], div[class*="problemBanner"]');
      const text = el?.textContent?.trim() || '';
      const match = text.match(/Difficulty[:\s]*(\d+)/i);
      if (match && match[1]) {
        const rating = parseInt(match[1], 10);
        if (rating < 1000) return 'Easy';
        if (rating < 1400) return 'Medium';
        return 'Hard';
      }
      return 'Medium';
    }

    getTopicTags() {
      const tags = [];
      const els = document.querySelectorAll('.problems_accordion_tags__JJ2DX .ui.labels a, [class*="tag"] a');
      for (const el of els) {
        const txt = el.textContent.trim();
        if (txt && !tags.includes(txt)) tags.push(txt);
      }
      return tags;
    }

    async extractMetadata() {
      const title = this.getProblemTitle();
      const tags = this.getTopicTags();
      if (tags.length > 0) this.topics = tags;

      const problemInfo = {
        title,
        number: null,
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
      instance = new CodeChefAdapter();
      instance.initialize();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
