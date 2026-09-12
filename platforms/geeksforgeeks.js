// Traverse — GeeksforGeeks adapter.
//
// ⚠️ Capture is still DOM-based. GFG's judge endpoints have not been verified
// against a real submit yet, so `netFilters` is intentionally empty and the
// verdict is read from the page (button click -> poll the result container).
//
// To move GFG onto the network path:
//   1. Record a HAR of Run + Submit (accepted and rejected) on
//      practice.geeksforgeeks.org — see REFACTOR_PLAN §3.2 for the procedure.
//   2. Add the submit/result-poll URLs to `netFilters` and handle them in
//      `onNetEvent`, mirroring platforms/leetcode.js.
//   3. Flip `config.domVerdictFallback.geeksforgeeks` to false, confirm nothing
//      regresses, then delete the DOM code below.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  const SUBMIT_BUTTON = 'button.problems_submit_button__6QoNQ, [class*="problems_submit_button"]';
  const RUN_BUTTON = 'button.problems_compile_button__Lfluz, [class*="compile_button"]';

  const SUBMIT_RESULT_SELECTORS = [
    '[class*="problems_content"]',
    '.submission-result',
    '.result',
    '[class*="result"]',
    '[class*="status"]',
    '[class*="verdict"]',
    '.ui.message',
  ];

  const RUN_RESULT_SELECTORS = [
    '.problems_content__kWANg',
    '[class*="result"]',
    '[class*="output"]',
    '.compile_and_run',
    '[class*="console"]',
  ];

  const ACCEPTED_WORDS = ['problem solved successfully', 'correct answer', 'accepted'];
  const REJECTED_WORDS = ['wrong answer', 'compilation error', 'runtime error', 'time limit exceeded'];

  const RUN_OK_WORDS = ['correct', 'passed'];
  const RUN_FAIL_WORDS = ['wrong', 'failed', 'error', 'expected:'];

  /** First non-empty text among `selectors`, or null. */
  function readFirstText(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
    }
    return null;
  }

  const containsAny = (haystack, needles) => needles.some((needle) => haystack.includes(needle));

  class GeeksforGeeksAdapter extends T.PlatformAdapter {
    static platform = 'geeksforgeeks';

    constructor() {
      super({
        platform: 'geeksforgeeks',
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
      return url.includes('/problems/') || url.includes('/batch/');
    }

    getCurrentProblemKey() {
      const match = window.location.href.match(/\/problems\/([^\/?#]+)/);
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
            await this.awaitSubmitVerdict(() => this.checkSubmitVerdict(), { timeoutMs: 20000 });
          }
        },
        'data-traverse-submit-listener'
      );

      this.watchButton(
        () => document.querySelector(RUN_BUTTON),
        () => {
          // The site sends the run request after its own handler runs.
          setTimeout(async () => {
            const code = this.getCurrentCode();
            const language = this.getCurrentLanguage();
            if (await this.captureFromDom('run', code, language)) {
              await this.awaitRunVerdict(() => this.checkRunVerdict(), { timeoutMs: 15000 });
            }
          }, 500);
        },
        'data-traverse-run-listener'
      );
    }

    checkSubmitVerdict() {
      const text = readFirstText(SUBMIT_RESULT_SELECTORS);
      if (!text) return null;

      const lower = text.toLowerCase();
      if (containsAny(lower, ACCEPTED_WORDS)) {
        return { accepted: true, status: text, stats: this.extractStats() };
      }
      if (containsAny(lower, REJECTED_WORDS)) {
        return { accepted: false, status: text, stats: this.extractStats() };
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
      // ⚠️  This file runs in the isolated content-script world, so window.ace
      // is NOT the page's ACE instance.  Only DOM elements are visible across
      // the boundary.  Strategies that touch JS globals (ace, monaco) are
      // unreachable here; they are kept as last-resort fallbacks in case GFG
      // ever switches to a MAIN-world injection like LeetCode's monaco-bridge.

      // Strategy 1 — ACE hidden text-input.  ACE renders a textarea for
      // clipboard integration; its value mirrors the editor content and is
      // reachable from the isolated world because it is a DOM element.
      const textInput = document.querySelector('.ace_text-input');
      if (textInput && textInput.value && textInput.value.length > 10) {
        return T.util.sanitizeCode(textInput.value);
      }

      // Strategy 2 — read rendered ACE lines from the DOM.  Each line is a
      // .ace_line div; concatenating them recovers the full source.
      const lines = document.querySelectorAll('.ace_line');
      if (lines.length > 0) {
        const code = Array.from(lines)
          .map((line) => line.textContent)
          .join('\n');
        if (code.length > 10) return T.util.sanitizeCode(code);
      }

      // Strategy 3 — plain textarea fallback (some sites keep a hidden textarea
      // that is updated on every keystroke).
      const textarea = document.querySelector('textarea');
      if (textarea && textarea.value && textarea.value.length > 10) {
        return T.util.sanitizeCode(textarea.value);
      }

      // Strategy 4 — ACE API.  Only works if this adapter is ever moved to the
      // MAIN world or if a bridge script (like page/monaco-bridge.js) is added
      // for GFG.  In the isolated world window.ace is undefined.
      if (window.ace && window.ace.edit) {
        const candidates = document.querySelectorAll('.ace_editor');
        for (const el of candidates) {
          try {
            const editor = window.ace.edit(el);
            const value = editor && editor.getValue ? editor.getValue() : '';
            if (value && value.length > 10) return T.util.sanitizeCode(value);
          } catch (_) {
            /* editor not ready on this element */
          }
        }
      }

      // Strategy 5 — Monaco (unlikely on GFG, but harmless).
      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models.length > 0) {
          const value = models[0].getValue();
          if (value && value.length > 10) return T.util.sanitizeCode(value);
        }
      }

      return '';
    }

    getCurrentLanguage() {
      const el =
        document.querySelector('div.problems_language_dropdown__DgjFb .menu [role="option"].active.selected') ||
        document.querySelector('[class*="language_dropdown"] .selected, [class*="language"]');
      const text = el && el.textContent ? el.textContent.trim().toLowerCase() : '';
      return text || this.defaultLanguage;
    }

    /* ── metadata ── */

    async extractProblemInfo() {
      const title = this.getProblemTitle();
      if (!title) return null;

      const topics = this.getTopicTags();
      if (topics.length > 0) this.topics = topics;

      return {
        title,
        number: this.getProblemNumber(),
        difficulty: this.getDifficulty(),
        url: window.location.href.split('?')[0],
        language: this.getCurrentLanguage(),
        code: this.getCurrentCode(),
        topics: this.topics.length > 0 ? this.topics : ['General'],
      };
    }

    getProblemTitle() {
      for (const selector of [
        '.problems_header_content__title h3',
        '[class*="problems_header_content__title"] h3',
        '.problem-title',
        'h1',
        'h2',
        'h3',
      ]) {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) {
          const title = el.textContent.trim().replace(/^\d+\.\s*/, '');
          if (title.length > 3 && !title.toLowerCase().includes('geeksforgeeks')) return title;
        }
      }
      return document.title.replace(/\s*-\s*GeeksforGeeks$/, '').trim() || null;
    }

    getProblemNumber() {
      const el = document.querySelector('.problems_header_content__title h3, h1');
      const match = el && el.textContent.match(/^(\d+)\./);
      return match ? match[1] : null;
    }

    getDifficulty() {
      const el = document.querySelector(
        '[class*="problems_header_description"] span:first-child, .difficulty-tag, [class*="difficulty"]'
      );
      return (el && el.textContent.trim()) || 'Medium';
    }

    getTopicTags() {
      const tags = [];
      const els = document.querySelectorAll('.problems_tag_container__kWANg + .content a, [class*="topic"] a');
      for (const el of els) {
        const text = el.textContent.trim();
        if (text && !tags.includes(text)) tags.push(text);
      }
      return tags;
    }
  }

  T.GeeksforGeeksAdapter = GeeksforGeeksAdapter;
  T.startPlatform(GeeksforGeeksAdapter);
})();
