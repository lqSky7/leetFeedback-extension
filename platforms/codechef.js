// Traverse — CodeChef adapter.
//
// Verdicts now come from the judge API instead of the page. The endpoints below
// were read off a real recorded session (recon capture
// `recon-codechef-2026-09-12t21-52-35-336z.json`).
//
// ⚠️  Evidence note: that capture's request/response pairing is only partly
// trustworthy — see the `reconSeq` bug fixed in page/net-interceptor.js, which
// let late responses overwrite earlier records. The *endpoints and payload
// shapes* below come from the records that are self-consistent (a submit that
// returned a upid, the matching poll that returned `result_code: "accepted"`,
// and the run that returned `result: 15` with empty `stderr`), and they match
// CodeChef's known IDE API. `domVerdictFallback.codechef` stays `true` until a
// clean capture confirms the whole path.
//
// Judge flow — host `www.codechef.com`:
//
//   GET  /api/ide/run/{problemCode}?timestamp=…&isCodeVisualizer=0
//        response { result, signal, output, stderr, cmpinfo, time, memory }
//        -> the RUN verdict — see runVerdictFromRun()
//
//   POST /api/ide/submit
//        response { status: 'OK', upid }
//        -> a SUBMIT has started; the upid keys the poll below
//
//   GET  /api/ide/submit?solution_id={upid}
//        response { result_code: 'accepted' | 'runtime' | … }
//        -> the SUBMIT verdict — see submitVerdictFromResult()
//
//   GET  /api/user_source_code?contestCode=…&problemCode=…&languageId=…
//        response { result_code, … } or { source_code, … }
//        -> the same poll payload on some flows; used as a fallback verdict
//           source, and ignored when it is returning the saved source instead.
//
// Note that `status` in these payloads is the *envelope* and reads "OK" for a
// failed run as well — the verdict is `signal`/`stderr`/`cmpinfo` (run) and
// `result_code` (submit).
//
// The attempts themselves are recorded from the *request* phase of the run and
// submit calls, not from a button click: the click path looked for `#run_btn`,
// but the recorded page's run control is `#compile_btn`, so run attempts were
// never recorded at all. Button watching is kept only as a fallback.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  /* ── judge endpoints ── */

  const RUN_URL = /\/api\/ide\/run\//;
  const SUBMIT_URL = /\/api\/ide\/submit/;
  const SOURCE_CODE_URL = /\/api\/user_source_code/;

  /** The site can poll the run endpoint; a burst belongs to a single run. */
  const RUN_BURST_MS = 2000;

  /* ── DOM fallback ── */

  // `#compile_btn` is the run control on the recorded page ("Run"); `#submit_btn`
  // is the submit control. The previous `#run_btn` / `[class*="run_btn"]`
  // selectors matched nothing.
  const RUN_BUTTON = '#compile_btn, button[id*="compile_btn"]';
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

  /**
   * `result_code` is the submit verdict. CodeChef returns short slugs rather
   * than prose, so they are mapped here instead of being shown raw.
   */
  const RESULT_CODE_LABELS = {
    accepted: 'Accepted',
    correct: 'Accepted',
    wrong: 'Wrong Answer',
    wrong_answer: 'Wrong Answer',
    partial: 'Partially Correct',
    compile: 'Compilation Error',
    compilation: 'Compilation Error',
    runtime: 'Runtime Error',
    time: 'Time Limit Exceeded',
    time_limit: 'Time Limit Exceeded',
    internal_error: 'Internal Error',
  };

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
        // The recorded session's IDE reported `defaultLanguageID: "116"`, which
        // is Python 3.
        defaultLanguage: 'python',
        extractDelay: 1500,
        netFilters: [
          { url: '/api/ide/run/', methods: ['GET', 'POST'] },
          { url: '/api/ide/submit', methods: ['POST', 'GET'] },
          { url: '/api/user_source_code', methods: ['GET'] },
        ],
      });

      this.topics = [];
      this._lastRunCaptureAt = 0;
      // `upid` of the submission being judged, and whether its verdict has
      // already been applied — the poll fires more than once, and an accepted
      // verdict runs the whole storage pipeline.
      this.submitId = null;
      this.submitSettled = false;
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

    /* ── network events ── */

    async onNetEvent(event) {
      const { phase, url, response } = event;

      if (phase === 'request') {
        if (RUN_URL.test(url)) {
          await this.captureRunOnce();
          return;
        }
        if (SUBMIT_URL.test(url) && !url.includes('solution_id=')) {
          await this.captureSubmit(this.getCurrentCode(), this.getCurrentLanguage());
        }
        return;
      }

      if (phase !== 'response') return;

      if (RUN_URL.test(url)) {
        const verdict = CodeChefAdapter.runVerdictFromRun(response);
        if (verdict) {
          this.logger.log(`run verdict: ${verdict.accepted ? 'SUCCESS' : 'FAILED'} (${verdict.status})`);
          await this.runVerdict(verdict.accepted);
        }
        return;
      }

      if (SUBMIT_URL.test(url) && !url.includes('solution_id=')) {
        this.submitId = (response && response.upid) || null;
        this.submitSettled = false;
        this.logger.log(`submission upid: ${this.submitId}`);
        return;
      }

      if (SUBMIT_URL.test(url) || SOURCE_CODE_URL.test(url)) {
        await this.handleSubmitResult(response);
      }
    }

    /**
     * Record one run attempt per burst.
     *
     * The run endpoint is polled on some flows, and `recordRun()` increments the
     * run counter on every call, so a naive capture-per-request would count a
     * single run several times.
     */
    async captureRunOnce() {
      const now = Date.now();
      if (now - this._lastRunCaptureAt < RUN_BURST_MS) return;
      this._lastRunCaptureAt = now;
      await this.captureRun(this.getCurrentCode(), this.getCurrentLanguage());
    }

    /**
     * The run verdict.
     *
     * A run has no expected output to compare against, so it can only have
     * executed or not: a non-zero `signal`, a non-empty `stderr` or a non-empty
     * `cmpinfo` means it did not. `result` (15 on success, 12 on a runtime
     * error in the recorded session) is reported but not relied on, and
     * `status` is ignored because it reads "OK" either way.
     */
    static runVerdictFromRun(body) {
      if (!body || typeof body !== 'object') return null;
      if (body.result === undefined && body.signal === undefined) return null;

      const stderr = String(body.stderr || '');
      const cmpinfo = String(body.cmpinfo || '');
      const signal = Number(body.signal || 0);

      const failed = signal !== 0 || stderr.length > 0 || cmpinfo.length > 0;
      if (!failed) return { accepted: true, status: 'Ran Successfully' };

      return {
        accepted: false,
        status: cmpinfo ? 'Compilation Error' : 'Runtime Error',
      };
    }

    async handleSubmitResult(body) {
      const verdict = CodeChefAdapter.submitVerdictFromResult(body);
      if (!verdict) return;

      // The poll fires repeatedly; settle once per submission.
      if (this.submitSettled) return;
      this.submitSettled = true;

      this.logger.log(
        `submit verdict: ${verdict.accepted ? 'ACCEPTED' : 'REJECTED'} (${verdict.status})`
      );
      await this.submitVerdict(verdict);
    }

    /** The submit verdict, read from the `result_code` the poll returns. */
    static submitVerdictFromResult(body) {
      if (!body || typeof body !== 'object') return null;

      const code = String(body.result_code || '').toLowerCase();
      if (!code) return null;

      return {
        accepted: code === 'accepted' || code === 'correct',
        status: RESULT_CODE_LABELS[code] || code,
        stats: {
          runtime: body.time !== undefined ? `${body.time}s` : '',
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

    /** `#compile_btn` is the run control; the label is "Run". */
    findRunButton() {
      const byId = document.querySelector(RUN_BUTTON);
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

      // The recorded page used ACE (`.ace_text-input` / `.ace_line`).
      const textInput = document.querySelector('.ace_text-input');
      if (textInput && textInput.value && textInput.value.length > 10) {
        return T.util.sanitizeCode(textInput.value);
      }

      const lines = document.querySelectorAll('.ace_line');
      if (lines.length > 0) {
        const code = Array.from(lines)
          .map((line) => line.textContent)
          .join('\n');
        if (code.length > 10) return T.util.sanitizeCode(code);
      }

      if (window.ace && window.ace.edit) {
        const editors = document.querySelectorAll('.ace_editor');
        for (const el of editors) {
          try {
            const value = window.ace.edit(el).getValue();
            if (value && value.length > 10) return T.util.sanitizeCode(value);
          } catch (_) {
            /* editor not ready on this element */
          }
        }
      }

      const textarea = document.querySelector('textarea');
      if (textarea && textarea.value && textarea.value.length > 10) {
        return T.util.sanitizeCode(textarea.value);
      }
      return '';
    }

    getCurrentLanguage() {
      const el = document.querySelector('#language-select');
      if (el) {
        const text = el.tagName === 'SELECT' ? el.options[el.selectedIndex]?.text : el.textContent;
        const language = (text || '').replace(/\(.*?\)/g, '').trim().toLowerCase();
        if (language) return language;
      }

      // The ACE editor exposes the mode it is bound to.
      const editor = document.querySelector('.ace_editor[data-mode]');
      const mode = editor && editor.getAttribute('data-mode');
      return (mode || '').trim().toLowerCase() || this.defaultLanguage;
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

    /**
     * ⚠️  Not `h1`: the recorded page's first `h1` was "Welcome to the CodeChef
     * AI Tutor" — a banner, not the problem name. The statement container is
     * checked first, then `document.title`, which read "Chef Builds Stack
     * Practice Problem in Stacks and Queues" on the same page.
     */
    getProblemTitle() {
      for (const selector of [
        'div._problem-statement__container_rv6cj_2 h1',
        '[class*="problem-statement"] h1',
        '[class*="problem-statement"] h3',
        'div[class*="_problem__title"] h1',
        'h1[class*="title"]',
      ]) {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) {
          const title = el.textContent.trim().replace(/^\d+\.\s*/, '');
          if (title.length > 2) return title;
        }
      }

      const fromDoc = document.title
        .replace(/\s*Practice Problem in.*$/i, '')
        .replace(/\s*[-|]\s*CodeChef.*$/i, '')
        .trim();
      if (fromDoc.length > 2) return fromDoc;

      const match = window.location.pathname.match(/problems\/([^\/?]+)/);
      return match ? match[1].replace(/-/g, ' ') : 'Unknown CodeChef Problem';
    }

    /** CodeChef exposes a numeric difficulty rating; map it to easy/medium/hard. */
    getDifficulty() {
      const el = document.querySelector(
        '[class*="difficulty"], div[class*="problemBanner"], [class*="problem-statement"]'
      );
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
      const els = document.querySelectorAll(
        '[class*="problem-tag"] a, [class*="tag"] a, [class*="topic"] a'
      );
      for (const el of els) {
        const text = el.textContent.trim();
        if (text && text.length < 40 && !tags.includes(text)) tags.push(text);
      }

      // Practice problems live under /practice/course/{syllabus}/… — on the
      // recorded page that was "stacks-and-queues-new", which is the only topic
      // signal the page itself gave us.
      if (tags.length === 0) {
        const match = window.location.pathname.match(/\/course\/([^/]+)/);
        if (match) {
          const topic = match[1]
            .replace(/-new$/, '')
            .split('-')
            .filter(Boolean)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
          if (topic) tags.push(topic);
        }
      }

      return tags;
    }
  }

  T.CodeChefAdapter = CodeChefAdapter;
  T.startPlatform(CodeChefAdapter);
})();
