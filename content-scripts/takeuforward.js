// TakeUforward content script for Traverse extension
// Extends PlatformAdapter — delegates state, persistence, timers, and submission pipeline.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});
  const PLATFORM = typeof DSA_PLATFORMS !== 'undefined' ? DSA_PLATFORMS.TAKEUFORWARD : 'takeuforward';
  const PlatformAdapter = T.PlatformAdapter || class {};

  class TakeUforwardAdapter extends PlatformAdapter {
    constructor() {
      super(PLATFORM, 'TakeUforward');

      this.ques = '';
      this.description = '';
      this.difficulty = 'Medium';
      this.selectedLanguage = '';
      this.publicCode = '';
      this.problemSlug = '';
      this.currentPathname = window.location.pathname;
    }

    async initialize() {
      try {
        this.setupEventListeners();
        this.injectInterceptor();

        const slug = this.getCurrentProblemSlug();
        await this.loadState(slug);

        if (this.isProblemPage()) {
          this.pollForQuestionDetails();
          this.startTimer(slug);
        }

        this.logger.log('TakeUforward adapter initialized');
      } catch (err) {
        this.logger.error('Failed to initialize TakeUforward adapter:', err);
      }
    }

    isProblemPage() {
      const url = window.location.href;
      const pathname = window.location.pathname;
      const slug = this.getProblemSlugFromUrl();
      return (
        url.includes('takeuforward.org') &&
        pathname.includes('/plus/') &&
        pathname.includes('/problems/') &&
        slug !== '' &&
        slug !== 'problems'
      );
    }

    getProblemSlugFromUrl() {
      const parts = window.location.pathname.split('/').filter((p) => p.length > 0);
      return parts[parts.length - 1] || '';
    }

    getCurrentProblemSlug() {
      // TUF uses full problem page URL for storage & backend push
      return window.location.href.split('?')[0];
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

    setupEventListeners() {
      // URL change watcher (TUF is SPA)
      const detector = setInterval(() => {
        if (this.currentPathname !== window.location.pathname) {
          this.currentPathname = window.location.pathname;
          const slug = this.getCurrentProblemSlug();

          if (this.isProblemPage()) {
            this.resetTimer();
            this.startTimer(slug);
            setTimeout(() => this.fetchQuestionDetails(), 2500);
          } else {
            this.hideTimer();
          }
        }
      }, 3000);

      window.addEventListener('beforeunload', () => clearInterval(detector));

      // Network message listeners from interceptor
      window.addEventListener('message', async (event) => {
        if (event.source !== window) return;
        const data = event.data || {};

        try {
          if (data.type === 'CODE_SUBMIT') {
            const p = data.payload || {};
            this.selectedLanguage = p.language || this.selectedLanguage;
            this.publicCode = p.usercode || this.publicCode;
            this.problemSlug = p.problem_id || this.problemSlug;

            await chrome.storage.local.set({
              tuf_code_data: {
                SELECTED_LANGUAGE: this.selectedLanguage,
                PUBLIC_CODE: this.publicCode,
                PROBLEM_SLUG: this.problemSlug,
                timestamp: Date.now(),
              },
            });

            await this.handleSubmissionAttempt(this.publicCode, this.selectedLanguage);
          } else if (data.type === 'CODE_RUN') {
            const p = data.payload || {};
            this.selectedLanguage = p.language || this.selectedLanguage;
            this.publicCode = p.usercode || this.publicCode;
            await this.handleRunAttempt(this.publicCode, this.selectedLanguage);
          } else if (data.type === 'SUBMISSION_RESPONSE') {
            const res = data.payload || {};
            const isSuccess = Boolean(res.success);
            await this.handleSubmissionResult(isSuccess, res);
          } else if (data.type === 'RUN_RESPONSE') {
            const res = data.payload || {};
            await this.handleRunResult(Boolean(res.success));
          }
        } catch (err) {
          this.logger.error('Error handling TUF message:', err);
        }
      });
    }

    pollForQuestionDetails(maxAttempts = 10) {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        this.fetchQuestionDetails();
        if (this.ques || attempts >= maxAttempts) {
          clearInterval(interval);
        }
      }, 1500);
    }

    fetchQuestionDetails() {
      const heading = document.querySelector('h1.text-xl.font-bold');
      const paragraph = document.querySelector('.tuf-text-14');

      if (heading && paragraph) {
        this.ques = heading.textContent?.trim() || '';
        this.description = paragraph.textContent?.trim() || '';
      }

      const diffEl = document.querySelector('[class*="difficulty"], [class*="Difficulty"]');
      if (diffEl) {
        this.difficulty = diffEl.textContent?.trim() || 'Medium';
      }
    }

    extractTopicsFromUrl() {
      const topics = [];
      const urlParams = new URLSearchParams(window.location.search);
      const categoryParam = urlParams.get('category');
      const subcategoryParam = urlParams.get('subcategory');

      let category = categoryParam ? categoryParam.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()) : null;
      let subcategory = subcategoryParam ? subcategoryParam.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()) : null;

      if (!category) {
        const el = document.querySelector('.category-root-trigger--active-path');
        if (el) category = el.textContent.trim();
      }

      topics.push(category || 'General');
      if (subcategory) topics.push(subcategory);
      return topics;
    }

    async extractCode() {
      if (this.publicCode) return this.publicCode;
      const stored = await chrome.storage.local.get(['tuf_code_data']);
      if (stored?.tuf_code_data?.PUBLIC_CODE) {
        return stored.tuf_code_data.PUBLIC_CODE;
      }
      return '';
    }

    async extractMetadata() {
      this.fetchQuestionDetails();

      const code = await this.extractCode();
      const problemInfo = {
        title: this.ques || 'Unknown TakeUforward Problem',
        description: this.description,
        difficulty: this.normalizeDifficulty(this.difficulty),
        url: window.location.href.split('?')[0],
        language: this.selectedLanguage || 'python',
        code: code,
        slug: this.problemSlug || this.getProblemSlugFromUrl(),
        topics: this.extractTopicsFromUrl(),
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
      instance = new TakeUforwardAdapter();
      instance.initialize();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();