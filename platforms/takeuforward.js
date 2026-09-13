// Traverse — TakeUforward adapter.
//
// Fully network-driven. Verdicts come from the judge's check-* polling
// endpoints; the submitted code comes from the submit/run request bodies, so
// nothing is scraped except the title, description and difficulty.
//
// Network flow:
//   POST backend-go.takeuforward.org/api/v1/plus/judge/submit
//        -> request { language, usercode, problem_id }
//   POST .../judge/run                     -> request { language, usercode, problem_id }
//   GET  .../judge/check-submit            -> response { success, data: { status, ... } }
//   GET  .../judge/check-run               -> response { success, data: { status, ... } }
//
// The check-* endpoints are polled by the site while judging, so the same rule
// fires repeatedly. Statuses that mean "not decided yet" are ignored here.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  // Statuses the judge reports while the submission is still in flight.
  const PENDING_STATUSES = [
    '', 'null', 'undefined', 'judging', 'running', 'compiling',
    'pending', 'processing', 'queued', 'in progress', 'in-progress',
    'testing', 'evaluating', 'executing', 'submitted',
  ];

  // Cross-page cache of the last code the user submitted. Lets a fresh page
  // load attach code to the problem record before the user submits again.
  const CODE_CACHE_KEY = 'tuf_code_data';

  const isPending = (status) =>
    !status || PENDING_STATUSES.includes(String(status).toLowerCase().trim());

  class TakeUforwardAdapter extends T.PlatformAdapter {
    static platform = 'takeuforward';

    constructor() {
      super({
        platform: 'takeuforward',
        defaultDifficulty: 1, // TUF's problem list is medium-heavy; matches pre-refactor default
        defaultTopics: ['General'],
        defaultLanguage: 'python',
        extractDelay: 2500,
        netFilters: [
          { url: 'judge/submit', methods: ['POST'] },
          { url: 'judge/run', methods: ['POST'] },
          { url: 'judge/check-submit', methods: ['GET'] },
          { url: 'judge/check-run', methods: ['GET'] },
        ],
      });

      this.title = '';
      this.description = '';
      this.difficulty = 'Medium';
      this.selectedLanguage = '';
      this.publicCode = '';
      this.problemId = '';
    }

    /* ── site-specific contract ── */

    isProblemPage() {
      const slug = this.getProblemSlugFromUrl();
      return (
        window.location.pathname.includes('/plus/') &&
        window.location.pathname.includes('/problems/') &&
        slug !== '' &&
        slug !== 'problems'
      );
    }

    /** Last path segment — identifies the problem within the SPA. */
    getProblemSlugFromUrl() {
      const parts = window.location.pathname.split('/').filter((part) => part.length > 0);
      return parts[parts.length - 1] || '';
    }

    /** TUF keys storage by the full problem URL (pre-refactor behavior). */
    getCurrentProblemKey() {
      return window.location.href.split('?')[0];
    }

    /**
     * TUF renders the problem header well after navigation, so the first
     * extraction attempts usually find nothing. Retry instead of giving up.
     */
    async extractAndStore() {
      for (let attempt = 0; attempt < 10; attempt++) {
        const info = await super.extractAndStore();
        if (info) return info;
        await T.util.sleep(1500);
      }
      return null;
    }

    /* ── network events ── */

    async onNetEvent(event) {
      const { phase, url, method, requestBody, response } = event;

      if (phase === 'request') {
        if (method === 'POST' && url.includes('judge/submit')) {
          await this.onSubmitRequest(requestBody || {});
          return;
        }
        if (method === 'POST' && url.includes('judge/run')) {
          await this.onRunRequest(requestBody || {});
        }
        return;
      }

      if (phase !== 'response') return;

      if (url.includes('judge/check-submit')) {
        await this.onSubmitCheck(response);
      } else if (url.includes('judge/check-run')) {
        await this.onRunCheck(response);
      }
    }

    async onSubmitRequest(payload) {
      this.selectedLanguage = payload.language || this.selectedLanguage;
      this.publicCode = payload.usercode || this.publicCode;
      this.problemId = payload.problem_id || this.problemId;

      await chrome.storage.local.set({
        [CODE_CACHE_KEY]: {
          SELECTED_LANGUAGE: this.selectedLanguage,
          PUBLIC_CODE: this.publicCode,
          PROBLEM_SLUG: this.problemId,
          timestamp: Date.now(),
        },
      });

      await this.captureSubmit(this.publicCode, this.selectedLanguage);
    }

    async onRunRequest(payload) {
      this.selectedLanguage = payload.language || this.selectedLanguage;
      this.publicCode = payload.usercode || this.publicCode;

      await this.captureRun(this.publicCode, this.selectedLanguage);
    }

    async onSubmitCheck(response) {
      const data = response && response.data;
      if (!data) return;

      const status = String(data.status || '').trim();
      if (isPending(status)) {
        this.logger.log(`submit still judging (${status || 'waiting'})`);
        return;
      }

      await this.submitVerdict({
        accepted: status.toLowerCase() === 'accepted',
        status,
        stats: {
          status,
          totalTestCases: data.total_test_cases,
          passedTestCases: data.passed_test_cases,
          averageTime: `${data.time}s`,
          averageMemory: data.memory,
        },
      });
    }

    async onRunCheck(response) {
      const data = response && response.data;
      if (!data) return;

      const status = String(data.status || '').trim();
      if (isPending(status)) {
        this.logger.log(`run still judging (${status || 'waiting'})`);
        return;
      }

      await this.runVerdict(status.toLowerCase() === 'accepted');
    }

    /* ── metadata ── */

    async extractProblemInfo() {
      this.fetchQuestionDetails();

      return {
        title: this.title || 'Unknown TakeUforward Problem',
        description: this.description,
        difficulty: this.difficulty,
        url: window.location.href.split('?')[0],
        language: this.selectedLanguage || this.defaultLanguage,
        code: await this.extractCode(),
        topics: this.extractTopicsFromUrl(),
      };
    }

    /** Title / description / difficulty are the only scraped values. */
    fetchQuestionDetails() {
      const heading = document.querySelector('h1.text-xl.font-bold');
      const paragraph = document.querySelector('.tuf-text-14');
      if (heading && paragraph) {
        this.title = heading.textContent ? heading.textContent.trim() : '';
        this.description = paragraph.textContent ? paragraph.textContent.trim() : '';
      }

      const difficultyEl = document.querySelector('[class*="difficulty"], [class*="Difficulty"]');
      if (difficultyEl && difficultyEl.textContent) {
        this.difficulty = difficultyEl.textContent.trim() || 'Medium';
      }
    }

    async extractCode() {
      if (this.publicCode) return this.publicCode;

      const stored = await chrome.storage.local.get([CODE_CACHE_KEY]);
      const cached = stored && stored[CODE_CACHE_KEY];
      return (cached && cached.PUBLIC_CODE) || '';
    }

    /** Category / subcategory come from the URL, or the active sidebar path. */
    extractTopicsFromUrl() {
      const topics = [];
      const params = new URLSearchParams(window.location.search);
      const categoryParam = params.get('category');
      const subcategoryParam = params.get('subcategory');

      const titleCase = (value) =>
        value.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

      let category = categoryParam ? titleCase(categoryParam) : null;
      const subcategory = subcategoryParam ? titleCase(subcategoryParam) : null;

      if (!category) {
        const active = document.querySelector('.category-root-trigger--active-path');
        if (active) category = active.textContent.trim();
      }

      topics.push(category || 'General');
      if (subcategory) topics.push(subcategory);
      return topics;
    }
  }

  T.TakeUforwardAdapter = TakeUforwardAdapter;
  T.startPlatform(TakeUforwardAdapter);
})();
