// Traverse — GeeksforGeeks adapter.
//
// Verdicts now come from the judge API. The endpoints below were read off a
// real recorded session (recon capture
// `recon-geeksforgeeks-2026-09-12t21-50-25-253z.json`, 16 requests, run and
// submit both accepted) rather than guessed, so `netFilters` is no longer
// empty. The DOM is still used for the problem's title/difficulty/topics and as
// a fallback for recording an attempt if a filter ever misses.
//
// Judge flow — host `practiceapiorigin.geeksforgeeks.org`, every request is
// `multipart/form-data`:
//
//   POST /api/latest/problems/{slug}/compile-sub-id/
//        request  { request_type: 'compileOutput', userCode, language, input }
//        response { results: { expected_submission_id, testSolution_submission_id } }
//        -> a RUN has started
//
//   POST /api/latest/problems/submission/compile-output          (polled)
//        request  { sub_id, testSolution_sub_id, sub_type: 'compileOutput', pid, ... }
//        response { results: { expectedOutput, testSolution } }
//        -> the RUN verdict — see runVerdictFromCompileOutput()
//
//   POST /api/latest/problems/{slug}/submit/compile/
//        request  { request_type: 'solutionCheck', userCode, language }
//        response { results: { submission_id } }
//        -> a SUBMIT has started
//
//   POST /api/latest/problems/submission/submit/result/          (polled)
//        response { status: 'QUEUED', ... }            -> still judging, ignored
//        response { view_mode: 'correct', ... }        -> the SUBMIT verdict
//
// Both result endpoints are polled by the site, so the same rule fires several
// times and the early payloads carry no verdict at all. A pending poll must not
// be read as a rejection, and must not consume the attempt — both verdict
// extractors below return null until the payload is terminal.
//
// The attempts themselves are recorded from the *request* phase of the two
// "start" calls, not from a button click: the click path depended on a hashed
// CSS class that had gone stale, which is why run attempts stopped being
// recorded at all. Button watching is kept only as a fallback.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  /* ── judge endpoints ── */

  const RUN_START_URL = /\/problems\/[^/]+\/compile-sub-id\/?$/;
  const RUN_RESULT_URL = /\/problems\/submission\/compile-output\/?$/;
  const SUBMIT_START_URL = /\/problems\/[^/]+\/submit\/compile\/?$/;
  const SUBMIT_RESULT_URL = /\/problems\/submission\/submit\/result\/?$/;

  /* ── DOM fallback ── */

  // `button.ui.mini.button` matched 7 elements on the recorded page, so the
  // finder below narrows by label instead of trusting the class alone.
  const RUN_BUTTON_LABELS = ['compile & run', 'compile and run', 'run'];
  const RUN_BUTTON_HINT = 'button.ui.mini.button, [class*="compile_button"], [class*="compile_btn"]';

  const SUBMIT_BUTTON =
    'button.submit_btn.btn.green, button.problems_submit_button__6QoNQ, [class*="problems_submit_button"]';

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

  /**
   * `view_mode` is the field that actually carries the judge's conclusion —
   * `results.testSolution.status` reads "SUCCESS" even for a compile error,
   * because it describes the request envelope, not the verdict.
   */
  const VIEW_MODE_LABELS = {
    correct: 'Accepted',
    wrong: 'Wrong Answer',
    compilation: 'Compilation Error',
    runtime: 'Runtime Error',
    time_limit: 'Time Limit Exceeded',
    test_results: 'Failed Test Case',
  };

  /** First non-empty text among `selectors`, or null. */
  function readFirstText(selectors) {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
    }
    return null;
  }

  const containsAny = (haystack, needles) => needles.some((needle) => haystack.includes(needle));

  const pathOf = (url) => String(url || '').split('?')[0];

  class GeeksforGeeksAdapter extends T.PlatformAdapter {
    static platform = 'geeksforgeeks';

    constructor() {
      super({
        platform: 'geeksforgeeks',
        defaultDifficulty: 0,
        defaultTopics: ['General'],
        defaultLanguage: 'cpp',
        extractDelay: 1500,
        netFilters: [
          { url: '/problems/[^/]+/compile-sub-id/', methods: ['POST'] },
          { url: '/problems/submission/compile-output', methods: ['POST'] },
          { url: '/problems/[^/]+/submit/compile/', methods: ['POST'] },
          { url: '/problems/submission/submit/result', methods: ['POST'] },
        ],
      });

      this.topics = [];
      // Guards against applying one submission's verdict twice: the site polls
      // submit/result until the judge finishes, and an accepted verdict runs the
      // whole storage pipeline.
      this.submissionSettled = false;
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

    /* ── network events ── */

    async onNetEvent(event) {
      const { phase, url, method, response } = event;
      const path = pathOf(url);

      if (phase === 'request') {
        if (method !== 'POST') return;

        // Record the attempt when the judge flow starts, so it is counted even
        // if the verdict payload never arrives. captureFromDom() checks
        // netCapturedRecently() and skips, so the click path cannot double-count.
        if (RUN_START_URL.test(path)) {
          await this.captureRun(this.getCurrentCode(), this.getCurrentLanguage());
          return;
        }
        if (SUBMIT_START_URL.test(path)) {
          await this.captureSubmit(this.getCurrentCode(), this.getCurrentLanguage());
        }
        return;
      }

      if (phase !== 'response') return;

      if (RUN_RESULT_URL.test(path)) {
        const verdict = GeeksforGeeksAdapter.runVerdictFromCompileOutput(response);
        if (verdict) {
          this.logger.log(`run verdict: ${verdict.accepted ? 'SUCCESS' : 'FAILED'} (${verdict.status})`);
          await this.runVerdict(verdict.accepted);
        }
        return;
      }

      if (SUBMIT_RESULT_URL.test(path)) {
        await this.handleSubmitResult(response);
      }
    }

    /**
     * The run verdict, read from a `compile-output` poll.
     *
     * `results.expectedOutput` is the *reference* solution's side and finishing
     * says nothing about the user's code — in the recorded session it was
     * populated while the user's side was still empty. Only
     * `results.testSolution` (the user's own compile) can decide the run, and it
     * is absent until that side is done, so it doubles as the "still running"
     * signal.
     */
    static runVerdictFromCompileOutput(body) {
      const results = body && body.results;
      if (!results) return null;

      const solution = results.testSolution;
      if (!solution || !solution.view_mode) return null;

      const message = solution.message || {};
      const viewMode = String(solution.view_mode);
      const failed =
        Boolean(message.error) ||
        viewMode === 'compilation' ||
        viewMode === 'runtime' ||
        viewMode === 'time_limit';

      return {
        accepted: !failed,
        status: failed ? VIEW_MODE_LABELS[viewMode] || 'Run Failed' : 'Ran Successfully',
      };
    }

    async handleSubmitResult(body) {
      const verdict = GeeksforGeeksAdapter.submitVerdictFromResult(body);
      if (!verdict) return;

      // The endpoint is polled; apply the verdict once per submission.
      if (this.submissionSettled) return;
      this.submissionSettled = true;

      this.logger.log(
        `submit verdict: ${verdict.accepted ? 'ACCEPTED' : 'REJECTED'} (${verdict.status})`
      );
      await this.submitVerdict(verdict);
    }

    /**
     * The submit verdict, read from a `submit/result` poll.
     *
     * Every poll before the judge finishes comes back as
     * `{"message":"Request Queued.","status":"QUEUED"}` with no `view_mode` at
     * all, so the presence of `view_mode` is what marks the payload as final.
     */
    static submitVerdictFromResult(body) {
      if (!body || typeof body !== 'object') return null;

      const viewMode = String(body.view_mode || '');
      if (!viewMode) return null;

      const message = body.message || {};
      const accepted = viewMode === 'correct';

      return {
        accepted,
        status: accepted ? 'Accepted' : VIEW_MODE_LABELS[viewMode] || `Failed (${viewMode})`,
        stats: {
          runtime: body.time !== undefined ? `${body.time}s` : '',
          testcases:
            body.total_test_cases !== undefined
              ? `${body.test_cases_processed}/${body.total_test_cases}`
              : '',
          accuracy: message.accuracy !== undefined ? `${message.accuracy}%` : '',
        },
      };
    }

    /* ── DOM fallback ── */

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
        () => this.findRunButton(),
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

    /**
     * The recorded page rendered the run control as `button.ui.mini.button`
     * labelled "Compile & Run" — the class alone matched 7 elements, and the
     * hashed `problems_compile_button__*` class this adapter used to look for
     * was no longer present at all.
     */
    findRunButton() {
      const candidates = Array.from(document.querySelectorAll(RUN_BUTTON_HINT));
      const labelled = candidates.filter((button) =>
        RUN_BUTTON_LABELS.includes((button.textContent || '').trim().toLowerCase())
      );
      if (labelled.length > 0) return labelled;

      const byLabel = Array.from(document.querySelectorAll('button')).find((button) =>
        RUN_BUTTON_LABELS.includes((button.textContent || '').trim().toLowerCase())
      );
      return byLabel || null;
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
      // The recorded page showed the language in a `div.item` reading
      // "C (gcc 5.4)". The parenthetical is the compiler build, not part of the
      // language name, so it is stripped.
      const el =
        document.querySelector('div.problems_language_dropdown__DgjFb .menu [role="option"].active.selected') ||
        document.querySelector('[class*="language_dropdown"] .selected, [class*="language"]') ||
        document.querySelector('.ace_editor[data-mode]');
      if (!el) return this.defaultLanguage;

      const raw =
        el.tagName === 'SELECT'
          ? (el.options[el.selectedIndex] && el.options[el.selectedIndex].text) || ''
          : el.getAttribute('data-mode') || el.textContent || '';

      const language = raw.replace(/\(.*?\)/g, '').trim().toLowerCase();
      return language || this.defaultLanguage;
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

    /**
     * The recorded page put everything in one header block:
     * "Difficulty: EasyAccuracy: 32.46%Submissions: 418K+Points: 2Average Time: 20m".
     * Reading the labelled value is far steadier than the old
     * `span:first-child` guess, which picked up whatever happened to be first.
     */
    getDifficulty() {
      const el = document.querySelector(
        'div.problems_header_description__t_8PB, [class*="problems_header_description"], [class*="difficulty"]'
      );
      const text = (el && el.textContent) || '';
      const match = text.match(/Difficulty\s*:\s*(Easy|Medium|Hard|Basic|School)/i);
      return match ? match[1] : 'Medium';
    }

    getTopicTags() {
      const tags = [];
      // `a.ui.label.problems_tag_label__A4Ism` is what the recorded page used
      // (it held company tags such as "Microsoft"); the older container-based
      // selector is kept as a fallback.
      const els = document.querySelectorAll(
        'a.ui.label.problems_tag_label__A4Ism, [class*="problems_tag_label"], .problems_tag_container__kWANg + .content a, [class*="topic"] a'
      );
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
