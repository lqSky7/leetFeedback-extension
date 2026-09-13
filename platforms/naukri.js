// Traverse — Naukri Code360 adapter.
//
// ⚠️ Capture is still DOM-based. Code360's judge endpoints have not been
// verified against a real submit yet, so `netFilters` is intentionally empty and
// the verdict is read from the page. To move it onto the network path, see the
// procedure in platforms/geeksforgeeks.js.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  const LANGUAGE_MAP = {
    'C++': 'cpp',
    cpp: 'cpp',
    C: 'c',
    Java: 'java',
    Python: 'py',
    Python3: 'py',
    python: 'py',
    JavaScript: 'js',
    Javascript: 'js',
    TypeScript: 'ts',
  };

  const SUBMIT_ACCEPTED = ['all test cases passed', 'accepted', 'correct answer'];
  const SUBMIT_REJECTED = ['wrong answer', 'compilation error', 'time limit exceeded', 'runtime error'];

  const RUN_ACCEPTED = ['all test cases passed', 'sample test cases passed', 'accepted'];
  const RUN_REJECTED = [
    'wrong answer', 'compilation error', 'time limit exceeded', 'runtime error', 'failed',
  ];

  const containsAny = (haystack, needles) => needles.some((needle) => haystack.includes(needle));

  class NaukriAdapter extends T.PlatformAdapter {
    static platform = 'naukri';

    constructor() {
      super({
        platform: 'naukri',
        defaultDifficulty: 0,
        defaultTopics: ['General'],
        defaultLanguage: 'cpp',
        extractDelay: 1500,
        netFilters: [],
      });

      this.topics = [];
    }

    async init() {
      this.attachButtons();
      await super.init();
    }

    /* ── site-specific contract ── */

    isProblemPage() {
      const url = window.location.href;
      return url.includes('naukri.com/code360') && (url.includes('/problem-details/') || url.includes('/problems/'));
    }

    getCurrentProblemKey() {
      const match = window.location.href.match(/(?:problem-details|problems)\/([^\/?#]+)/);
      return match ? match[1] : window.location.pathname.split('/').pop() || 'unknown';
    }

    /* ── DOM capture ── */

    attachButtons() {
      this.watchButton(
        () => this.findSubmitButton(),
        async () => {
          const code = this.getCurrentCode();
          const language = this.getCurrentLanguage();
          if (await this.captureFromDom('submit', code, language)) {
            await this.awaitSubmitVerdict(() => this.checkSubmitVerdict(), { timeoutMs: 30000 });
          }
        },
        'data-traverse-submit-listener'
      );

      this.watchButton(
        () => this.findRunButton(),
        () => {
          setTimeout(async () => {
            const code = this.getCurrentCode();
            const language = this.getCurrentLanguage();
            if (await this.captureFromDom('run', code, language)) {
              // Code360 sometimes never renders a run verdict; leave the attempt
              // unresolved rather than recording a false failure.
              await this.awaitRunVerdict(() => this.checkRunVerdict(), {
                timeoutMs: 20000,
                recordTimeout: false,
              });
            }
          }, 800);
        },
        'data-traverse-run-listener'
      );
    }

    findSubmitButton() {
      return (
        Array.from(document.querySelectorAll('button')).find((button) =>
          button.textContent.toLowerCase().includes('submit')
        ) || null
      );
    }

    findRunButton() {
      return (
        Array.from(document.querySelectorAll('button')).find((button) => {
          const text = button.textContent.toLowerCase();
          return (text.includes('run') || text.includes('test')) && !text.includes('submit');
        }) || null
      );
    }

    checkSubmitVerdict() {
      const text = document.body.innerText.toLowerCase();
      if (containsAny(text, SUBMIT_ACCEPTED)) return { accepted: true, status: 'Accepted' };
      if (containsAny(text, SUBMIT_REJECTED)) return { accepted: false, status: 'Wrong Answer' };
      return null;
    }

    checkRunVerdict() {
      const text = document.body.innerText.toLowerCase();
      if (containsAny(text, RUN_ACCEPTED)) return { accepted: true, status: 'Accepted' };
      if (containsAny(text, RUN_REJECTED)) return { accepted: false, status: 'Failed' };
      return null;
    }

    /* ── editor access ── */

    getCurrentCode() {
      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models && models.length > 0) return T.util.sanitizeCode(models[0].getValue());
      }

      const viewLines = document.querySelectorAll('.view-line');
      if (viewLines.length > 0) {
        return Array.from(viewLines)
          .map((line) => line.textContent)
          .join('\n');
      }

      const textarea = document.querySelector('.monaco-editor textarea, textarea.inputarea, textarea');
      return textarea && textarea.value ? T.util.sanitizeCode(textarea.value) : '';
    }

    getCurrentLanguage() {
      const el = document.querySelector('[class*="language"], [class*="Language"], select, button[class*="select"]');
      const text = el ? el.textContent.trim() : '';
      return LANGUAGE_MAP[text] || this.defaultLanguage;
    }

    /* ── metadata ── */

    async extractProblemInfo() {
      const topics = this.extractTopics();
      if (topics.length > 0) this.topics = topics;

      return {
        title: this.extractTitle(),
        difficulty: this.extractDifficulty(),
        topics: this.topics.length > 0 ? this.topics : ['General'],
        code: this.getCurrentCode(),
        language: this.getCurrentLanguage(),
        url: window.location.href.split('?')[0],
      };
    }

    extractTitle() {
      const el = document.querySelector(
        'h1, .problem-title, [class*="problem-title"], [class*="ProblemTitle"], [class*="title"]'
      );
      if (el && el.textContent.trim()) return el.textContent.trim();

      return document.title
        .replace(/[-|].*Code360.*/i, '')
        .replace(/Coding Ninjas.*/i, '')
        .trim();
    }

    extractDifficulty() {
      const el = document.querySelector('[class*="difficulty"], [class*="Difficulty"], .badge');
      return (el && el.textContent && el.textContent.trim()) || 'Easy';
    }

    extractTopics() {
      const els = document.querySelectorAll('[class*="topic"], [class*="tag"], [class*="category"]');
      return Array.from(els)
        .map((el) => el.textContent.trim())
        .filter(Boolean);
    }
  }

  T.NaukriAdapter = NaukriAdapter;
  T.startPlatform(NaukriAdapter);
})();
