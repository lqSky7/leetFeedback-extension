// Traverse — CodeChef adapter.
//
// ⚠️ Capture is still DOM-based. CodeChef's judge endpoints have not been
// verified against a real submit yet, so `netFilters` is intentionally empty and
// the verdict is read from the page.
//
// The pre-refactor run-button selector here was GeeksforGeeks' hashed class
// (`button.problems_compile_button__Lfluz`) copy-pasted in, so CodeChef run
// attempts were never recorded. That is replaced with CodeChef's own run button
// plus a text fallback. The buggy selector is deliberately not carried over.
//
// To move CodeChef onto the network path, see the procedure in
// platforms/geeksforgeeks.js.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  const SUBMIT_BUTTON = '#submit_btn, button[id*="submit"]';

  const SUBMIT_RESULT_SELECTORS = [
    'div[class*="_run__container"] span',
    'div[class*="_status-success"] span',
    '[class*="success"] span',
    '.submission-result',
    '.status-text',
    '[class*="verdict"]',
  ];

  const RUN_RESULT_SELECTORS = [
    'div[class*="_run__container"]',
    '[class*="run-result"]',
    '[class*="output"]',
    '.console-output',
  ];

  const REJECTED_WORDS = [
    'wrong answer', 'compilation error', 'time limit', 'runtime error', 'partial', 'failed',
  ];
  const ACCEPTED_WORDS = ['correct', 'accepted', 'success', '100'];

  const RUN_OK_WORDS = ['correct', 'passed'];
  const RUN_FAIL_WORDS = ['wrong', 'failed', 'error', 'time limit'];

  function readFirstText(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
    }
    return null;
  }

  const containsAny = (haystack, needles) => needles.some((needle) => haystack.includes(needle));

  class CodeChefAdapter extends T.PlatformAdapter {
    static platform = 'codechef';

    constructor() {
      super({
        platform: 'codechef',
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
      return window.location.href.includes('/problems/');
    }

    getCurrentProblemKey() {
      const match = window.location.pathname.match(/\/problems\/([^\/?#]+)/);
      return match ? match[1] : 'unknown';
    }

    /* ── DOM capture ── */

    attachButtons() {
      this.watchButton(
        () => document.querySelector(SUBMIT_BUTTON),
        async () => {
          const code = this.getCurrentCode();
          const language = this.getCurrentLanguage();
          if (await this.captureFromDom('submit', code, language)) {
            await this.awaitSubmitVerdict(() => this.checkSubmitVerdict(), { timeoutMs: 25000 });
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
              await this.awaitRunVerdict(() => this.checkRunVerdict(), { timeoutMs: 15000 });
            }
          }, 600);
        },
        'data-traverse-run-listener'
      );
    }

    findRunButton() {
      const byId = document.querySelector('#run_btn, button[id*="run_btn"], button[class*="run_btn"]');
      if (byId) return byId;

      return (
        Array.from(document.querySelectorAll('button')).find(
          (button) => button.textContent && button.textContent.trim().toLowerCase() === 'run'
        ) || null
      );
    }

    checkSubmitVerdict() {
      const text = readFirstText(SUBMIT_RESULT_SELECTORS);
      if (!text || text.length <= 2) return null;

      const lower = text.toLowerCase();
      // Rejections are matched first: "wrong answer" also contains no accept word,
      // but "partial" verdicts must not be mistaken for a pass.
      if (containsAny(lower, REJECTED_WORDS)) {
        return { accepted: false, status: text, stats: this.extractStats() };
      }
      if (containsAny(lower, ACCEPTED_WORDS)) {
        return { accepted: true, status: text, stats: this.extractStats() };
      }
      return null;
    }

    checkRunVerdict() {
      const text = readFirstText(RUN_RESULT_SELECTORS);
      if (!text) return null;

      const lower = text.toLowerCase();
      const looksLikeOutput = lower.includes('output:') && !lower.includes('expected:');

      if (containsAny(lower, RUN_OK_WORDS) || looksLikeOutput) return { accepted: true, status: text };
      if (containsAny(lower, RUN_FAIL_WORDS)) return { accepted: false, status: text };
      return null;
    }

    extractStats() {
      const stats = {};
      const timeEl = document.querySelector('[class*="time"], [class*="Time"]');
      if (timeEl) stats.runtime = timeEl.textContent.trim();
      const memoryEl = document.querySelector('[class*="memory"], [class*="Memory"]');
      if (memoryEl) stats.memory = memoryEl.textContent.trim();
      return stats;
    }

    /* ── editor access ── */

    getCurrentCode() {
      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models.length > 0) {
          const value = models[0].getValue();
          if (value && value.length > 10) return T.util.sanitizeCode(value);
        }
      }

      if (window.ace && window.ace.edit) {
        const editors = document.querySelectorAll('.ace_editor');
        if (editors.length > 0) {
          try {
            const value = window.ace.edit(editors[0]).getValue();
            if (value && value.length > 10) return T.util.sanitizeCode(value);
          } catch (_) {
            /* editor not ready */
          }
        }
      }

      const textarea = document.querySelector('textarea.ace_text-input, textarea');
      if (textarea && textarea.value && textarea.value.length > 10) {
        return T.util.sanitizeCode(textarea.value);
      }
      return '';
    }

    getCurrentLanguage() {
      const el = document.querySelector('#language-select');
      if (!el) return this.defaultLanguage;

      const text = el.tagName === 'SELECT' ? el.options[el.selectedIndex]?.text : el.textContent;
      return (text || this.defaultLanguage).replace(/\(.*?\)/, '').trim();
    }

    /* ── metadata ── */

    async extractProblemInfo() {
      const topics = this.getTopicTags();
      if (topics.length > 0) this.topics = topics;

      return {
        title: this.getProblemTitle(),
        number: null,
        difficulty: this.getDifficulty(),
        url: window.location.href.split('?')[0],
        language: this.getCurrentLanguage(),
        code: this.getCurrentCode(),
        topics: this.topics.length > 0 ? this.topics : ['General'],
      };
    }

    getProblemTitle() {
      const el = document.querySelector('div[class*="_problem__title"] h1, h1[class*="title"], h1');
      if (el && el.textContent.trim()) {
        const title = el.textContent.trim().replace(/^\d+\.\s*/, '');
        if (title.length > 2) return title;
      }

      const match = window.location.pathname.match(/problems\/([^\/?]+)/);
      return match ? match[1].replace(/-/g, ' ') : 'Unknown CodeChef Problem';
    }

    /** CodeChef exposes a numeric difficulty rating; map it to easy/medium/hard. */
    getDifficulty() {
      const el = document.querySelector('[class*="difficulty"], div[class*="problemBanner"]');
      const match = (el && el.textContent ? el.textContent : '').match(/Difficulty[:\s]*(\d+)/i);

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
        const text = el.textContent.trim();
        if (text && !tags.includes(text)) tags.push(text);
      }
      return tags;
    }
  }

  T.CodeChefAdapter = CodeChefAdapter;
  T.startPlatform(CodeChefAdapter);
})();
