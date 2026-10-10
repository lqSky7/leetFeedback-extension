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
      const pathname = window.location.pathname;
      return (
        pathname.includes('/practice/') &&
        slug !== '' &&
        slug !== 'practice' &&
        slug !== 'dsa'
      );
    }

    /** Last path segment — identifies the problem within /practice/dsa/<slug>. */
    getProblemSlugFromUrl() {
      const pathname = window.location.pathname;
      const match = pathname.match(/\/practice\/(?:[^\/]+\/)?([^\/\?]+)/);
      if (match && match[1]) return match[1];
      const parts = pathname.split('/').filter((part) => part.length > 0);
      return parts[parts.length - 1] || '';
    }

    /** TUF keys storage by the full problem URL. */
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

      const status = String(data.status || '').trim().toLowerCase();
      if (isPending(status)) {
        this.logger.log(`run still judging (${status || 'waiting'})`);
        return;
      }

      const isAccepted =
        status === 'accepted' ||
        status === 'passed' ||
        status === 'success' ||
        (Boolean(data.total_test_cases) && data.passed_test_cases === data.total_test_cases);

      await this.runVerdict(Boolean(isAccepted));
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

    /** Title / description / difficulty are extracted from ProblemPanel. */
    fetchQuestionDetails() {
      const heading = document.querySelector(
        'h1[class*="ProblemPanel"], [class*="ProblemPanel"][class*="title"], h1'
      );
      if (heading) {
        const clone = heading.cloneNode(true);
        const badge = clone.querySelector('[class*="Badge"], [class*="badge"]');
        if (badge) badge.remove();
        this.title = (clone.textContent || '').trim();
      }
      if (!this.title && typeof document !== 'undefined' && document.title) {
        this.title = document.title.split(' - ')[0].trim();
      }

      const paragraph = document.querySelector(
        '[class*="ProblemPanel"][class*="richText"], [class*="ProblemPanel"][class*="content"] p'
      );
      if (paragraph) {
        this.description = (paragraph.textContent || '').trim();
      } else if (typeof document !== 'undefined') {
        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc && metaDesc.content) {
          this.description = metaDesc.content.trim();
        }
      }

      const difficultyEl = document.querySelector('[class*="difficulty"], [class*="Difficulty"]');
      if (difficultyEl && difficultyEl.textContent) {
        this.difficulty = difficultyEl.textContent.trim() || 'Medium';
      } else {
        this.difficulty = 'Medium';
      }
    }

    async extractCode() {
      if (this.publicCode) return this.publicCode;

      const stored = await chrome.storage.local.get([CODE_CACHE_KEY]);
      const cached = stored && stored[CODE_CACHE_KEY];
      return (cached && cached.PUBLIC_CODE) || '';
    }

    /** Category / source from URL search params. */
    extractTopicsFromUrl() {
      const topics = [];
      const params = new URLSearchParams(window.location.search);
      const categoryParam = params.get('category');
      const sourceParam = params.get('source');

      const titleCase = (value) =>
        value.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

      if (categoryParam) topics.push(titleCase(categoryParam));
      if (sourceParam) topics.push(titleCase(sourceParam));

      if (topics.length === 0) topics.push('General');
      return topics;
    }
  }

  T.TakeUforwardAdapter = TakeUforwardAdapter;
  T.startPlatform(TakeUforwardAdapter);
})();
