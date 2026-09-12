// Traverse — PlatformAdapter base class.
//
// Owns the lifecycle and cross-platform behavior that used to be copy-pasted
// into every platform script: tracker + persistence wiring, SPA URL watching,
// problem-change resets, the timer overlay, network-event dispatch, and the
// DOM-verdict fallback helpers. A platform adapter only implements the
// site-specific parts (see platforms/index.md).
//
// Lifecycle: Traverse.startPlatform(XAdapter) -> adapter.init() once per page
// load. The instance survives SPA navigation (content scripts are not
// re-injected on pushState navigations), so URL changes are handled via
// MutationObserver instead of re-initialization.

(function () {
  'use strict';

  const T = globalThis.Traverse = globalThis.Traverse || {};

  class PlatformAdapter {
    /**
     * @param {Object} def
     * @param {string} def.platform - platform id ('leetcode', 'geeksforgeeks', ...)
     * @param {number} [def.defaultDifficulty] - fallback difficulty level (takeuforward: 1)
     * @param {string[]} [def.defaultTopics] - topics fallback (e.g. ['General'])
     * @param {string} [def.defaultLanguage] - language fallback ('cpp', 'python')
     * @param {Array<{url: string, methods?: string[]}>} [def.netFilters] - interceptor URL filters
     * @param {number} [def.extractDelay] - ms to wait before extracting after navigation
     */
    constructor(def) {
      this.platform = def.platform;
      this.defaultDifficulty = def.defaultDifficulty || 0;
      this.defaultTopics = def.defaultTopics || [];
      this.defaultLanguage = def.defaultLanguage || 'cpp';
      this.netFilters = def.netFilters || [];
      this.extractDelay = def.extractDelay != null ? def.extractDelay : 1000;

      this.logger = T.createLogger ? T.createLogger(this.platform) : console;
      this.tracker = new T.AttemptTracker();
      this.store = T.sessionStore;
      this.pipeline = T.submissionPipeline;

      this.currentProblem = null;
      this.currentProblemKey = null;
      this.submissionTracker = null;

      // Capture-lock: network captures stamp these timestamps so the DOM
      // fallback (still active on platforms with unverified network rules)
      // does not double-record the same submit/run.
      this._netCaptureAt = { submit: 0, run: 0 };

      this._netBridge = null;
      this._urlObserver = null;
    }

    /* ── Site-specific API (subclasses MUST implement) ── */

    isProblemPage() {
      throw new Error('isProblemPage() must be implemented');
    }

    /** Stable storage key for the current problem (slug or URL — see platforms/index.md). */
    getCurrentProblemKey() {
      throw new Error('getCurrentProblemKey() must be implemented');
    }

    /**
     * Extract problem metadata from the page. Returns the problemInfo object
     * ({title, description?, difficulty, url, language, code, topics, ...})
     * or null when the page is not ready yet.
     */
    async extractProblemInfo() {
      throw new Error('extractProblemInfo() must be implemented');
    }

    /** Optional: interpret a captured network event (see core/net-protocol.js). */
    async onNetEvent(_event) {}

    /* ── Lifecycle ── */

    async init() {
      // Only problem pages get a tracking record — a page load elsewhere must
      // not create a `problem_data_unknown` entry.
      if (this.isProblemPage()) {
        const key = this.getCurrentProblemKey();
        const stored = await this.store.getProblemData(key);
        if (stored) {
          this.tracker.restore(stored);
          this.logger.log(
            `restored state — runs: ${this.tracker.runCounter}, failed: ${this.tracker.incorrectRunCounter}`
          );
        }
        this.currentProblemKey = key;
        await this.saveTrackingState(key);
      }

      // Connect to the MAIN-world interceptor and dispatch captured traffic.
      this._netBridge = new T.NetBridge({
        onEvent: (event) => {
          Promise.resolve(this.onNetEvent(event)).catch((err) =>
            this.logger.error('net event error:', err)
          );
        },
      });
      this._netBridge.connect(this.netFilters);

      // Watch SPA navigations.
      this._urlObserver = this.observeUrlChanges(() => this.handleUrlChange());

      this.checkPageType();
      this.logger.log('adapter initialized');
    }

    checkPageType() {
      if (this.isProblemPage()) {
        const key = this.getCurrentProblemKey();
        this.startTimer(key);
        setTimeout(() => this.extractAndStore(), this.extractDelay + 500);
      } else {
        this.hideTimer();
      }
    }

    handleUrlChange() {
      if (!this.isProblemPage()) {
        this.hideTimer();
        return;
      }

      const key = this.getCurrentProblemKey();
      if (this.currentProblemKey !== key) {
        this.handleProblemChange();
        this.currentProblemKey = key;
        this.resetTimer();
        this.startTimer(key);
      }

      setTimeout(() => this.extractAndStore(), this.extractDelay);
    }

    /**
     * Drop the in-memory state of the problem we just left. The stored record
     * is deliberately NOT deleted: an unsolved record is harmless, and a solved
     * record that has not reached the backend yet must survive so the next
     * accepted solve can still push it.
     */
    handleProblemChange() {
      this.logger.log('problem changed — resetting tracking state');
      this.tracker.reset();
      this.currentProblem = null;
      this.submissionTracker = null;
      this._netCaptureAt = { submit: 0, run: 0 };
    }

    /** Extract metadata and store the problem as seen-but-unsolved. */
    async extractAndStore() {
      const problemInfo = await this.extractProblemInfo();
      if (!problemInfo) return null;
      this.currentProblem = problemInfo;
      await this.storeProblemData(problemInfo, false, 0);
      return problemInfo;
    }

    /* ── Persistence ── */

    /** Merge tracker state + timer values into the stored problem record. */
    async saveTrackingState(key, overrides = {}) {
      const problemKey = key || this.getCurrentProblemKey();
      if (!problemKey) return null;

      const timer = window.ProblemTimer ? window.ProblemTimer.getInstance() : null;
      const existing = (await this.store.getProblemData(problemKey)) || {};

      const payload = {
        ...existing,
        ...this.tracker.snapshot(),
        ...overrides,
        currentProblemKey: problemKey,
        problemStartTime: timer?.getStartTime() || existing.problemStartTime || Date.now(),
        pausedTime: timer?.getPausedTime() || existing.pausedTime || 0,
        timestamp: new Date().toISOString(),
      };

      return this.store.setProblemData(problemKey, payload);
    }

    /**
     * Build/merge the canonical problem_data record (the storeProblemData
     * that used to exist in five copies).
     */
    async storeProblemData(problemInfo, solved = false, tries = 0) {
      const problemKey = this.getCurrentProblemKey();
      if (!problemKey) return null;

      const existing = (await this.store.getProblemData(problemKey)) || {};
      const previousSolved = existing.solved || { value: false, date: 0, tries: 0 };
      const timer = window.ProblemTimer ? window.ProblemTimer.getInstance() : null;

      const triesValue = typeof tries === 'number' ? tries : previousSolved.tries ?? 0;

      let solvedData;
      if (solved) {
        // New solve/revision: fresh timestamp doubles as the idempotency key seed.
        solvedData = { value: true, date: Date.now(), tries: triesValue };
      } else if (previousSolved.value) {
        solvedData = previousSolved; // already solved on an earlier visit
      } else {
        solvedData = { value: false, date: 0, tries: triesValue };
      }

      const record = {
        ...existing,
        name: problemInfo.title || existing.name || 'Unknown Problem',
        platform: this.platform,
        difficulty: T.util.normalizeDifficulty(problemInfo.difficulty, this.defaultDifficulty),
        solved: solvedData,
        ignored: existing.ignored ?? false,
        parent_topic: problemInfo.topics || existing.parent_topic || this.defaultTopics,
        problem_link: problemInfo.url || existing.problem_link || window.location.href.split('?')[0],
        code: problemInfo.code || existing.code || '',
        language: problemInfo.language || existing.language || this.defaultLanguage,
        ...this.tracker.snapshot(),
        currentProblemKey: problemKey,
        problemStartTime: timer?.getStartTime() || existing.problemStartTime || Date.now(),
        pausedTime: timer?.getPausedTime() || existing.pausedTime || 0,
        timestamp: new Date().toISOString(),
      };

      await this.store.setProblemData(problemKey, record);
      return record;
    }

    /* ── Capture entry points (network events and DOM fallbacks both land here) ── */

    /** Record a submit attempt. Returns false when a duplicate was skipped. */
    async captureSubmit(code, language) {
      if (this.tracker.submissionInProgress) {
        this.logger.log('submission already in progress — ignoring duplicate trigger');
        return false;
      }

      this._netCaptureAt.submit = Date.now();

      if (window.LeetFeedbackToast) {
        this.submissionTracker = window.LeetFeedbackToast.createSubmission();
      }

      this.tracker.recordSubmission(code, language);
      this.logger.log(`recorded submit attempt #${this.tracker.submitCounter}`);
      await this.saveTrackingState();
      return true;
    }

    /** Record a run attempt. */
    async captureRun(code, language) {
      this._netCaptureAt.run = Date.now();
      const attempt = this.tracker.recordRun(code, language);
      if (attempt.code && attempt.code.length > 10) {
        this.logger.log(`recorded run attempt #${this.tracker.runCounter}`);
        await this.saveTrackingState();
      }
      return attempt;
    }

    /** A network capture was recorded recently (DOM fallbacks check this). */
    netCapturedRecently(kind, windowMs = 5000) {
      return Date.now() - (this._netCaptureAt[kind] || 0) < windowMs;
    }

    /**
     * Record an attempt triggered by a DOM click, unless the network
     * interceptor already captured the same request.
     *
     * The delay matters: our click listener runs in the capture phase, i.e.
     * before the site's own handler sends the request, so an immediate check
     * would always miss the network capture and double-record. Waiting lets the
     * configured intercept rule win the race (see REFACTOR_PLAN §3.3).
     */
    async captureFromDom(kind, code, language) {
      if (T.config.domVerdictFallback[this.platform] === false) {
        this.logger.log(`DOM capture disabled for ${this.platform} — network capture is authoritative`);
        return false;
      }

      await T.util.sleep(300);
      if (this.netCapturedRecently(kind)) {
        this.logger.log(`network capture already recorded this ${kind} — skipping DOM path`);
        return false;
      }
      if (kind === 'submit') {
        await this.captureSubmit(code, language);
      } else {
        await this.captureRun(code, language);
      }
      return true;
    }

    /**
     * Poll the DOM for a submit verdict. `check` returns
     * `{ accepted, status, stats }` once readable, or null while judging.
     * A timeout is reported as a rejection, matching pre-refactor behavior.
     */
    async awaitSubmitVerdict(check, { intervalMs = 1000, timeoutMs = 20000, timeoutStatus = 'Timeout' } = {}) {
      const verdict = await this.pollUntil(check, { intervalMs, timeoutMs });
      if (verdict) {
        await this.submitVerdict({
          accepted: verdict.accepted,
          status: verdict.status || '',
          stats: verdict.stats || null,
        });
        return;
      }
      this.logger.warn('submit verdict poll timed out');
      await this.submitVerdict({ accepted: false, status: timeoutStatus, stats: null });
    }

    /**
     * Poll the DOM for a run verdict. `recordTimeout: false` leaves the attempt
     * unresolved on timeout instead of recording a failure — some sites simply
     * never render a verdict for a run.
     */
    async awaitRunVerdict(check, { intervalMs = 1000, timeoutMs = 15000, recordTimeout = true } = {}) {
      const verdict = await this.pollUntil(check, { intervalMs, timeoutMs });
      if (verdict) {
        await this.runVerdict(verdict.accepted);
        return;
      }
      if (recordTimeout) {
        this.logger.warn('run verdict poll timed out');
        await this.runVerdict(false);
      } else {
        this.logger.log('run verdict never appeared — leaving attempt unresolved');
      }
    }

    /** Apply a submit verdict. Accepted verdicts run the submission pipeline. */
    async submitVerdict({ accepted, status = '', stats = null }) {
      if (accepted) {
        await this.completeSubmission({ stats });
        return;
      }

      this.logger.log(`submit verdict: REJECTED (${status || 'unknown'})`);
      this.tracker.recordSubmissionResult(false);
      await this.saveTrackingState();
      if (this.submissionTracker) {
        this.submissionTracker.fail(status || 'Submission failed');
        this.submissionTracker = null;
      }
    }

    /** Apply a run verdict to the pending run attempt. */
    async runVerdict(success) {
      const attempt = this.tracker.recordRunResult(success);
      if (attempt) {
        this.logger.log(`run #${attempt.runNumber} — ${success ? 'SUCCESS' : 'FAILED'} (${this.tracker.incorrectRunCounter} failed total)`);
        await this.saveTrackingState();
      }
      return attempt;
    }

    /**
     * Shared accepted-submission flow (was handleSuccessfulSubmission in five
     * copies): wait for the UI, re-extract metadata, store the solved record,
     * then hand off to the pipeline.
     */
    async completeSubmission({ stats = null } = {}) {
      try {
        this.logger.log('accepted submission detected');

        // Give the site a moment to render performance stats before extraction.
        await T.util.sleep(2000);

        const problemInfo = await this.extractProblemInfo();
        if (!problemInfo) {
          this.logger.error('could not extract problem info — aborting pipeline');
          if (this.submissionTracker) {
            this.submissionTracker.fail('Could not read problem info');
            this.submissionTracker = null;
          }
          return;
        }

        problemInfo.stats = stats || problemInfo.stats || null;
        this.currentProblem = problemInfo;
        this.tracker.recordSubmissionResult(true);

        const tries = this.tracker.getTotalTries();
        await this.storeProblemData(problemInfo, true, tries);
        this.logger.log(`stored problem as solved with ${tries} tries`);

        await this.pipeline.execute({
          platform: this.platform,
          problemInfo,
          problemKey: this.getCurrentProblemKey(),
          tracker: this.tracker,
          submissionTracker: this.submissionTracker,
          onReset: (attemptsToPersist) => {
            this.submissionTracker = null;
            this.saveTrackingState(this.getCurrentProblemKey(), { attempts: attemptsToPersist });
          },
        });
      } catch (error) {
        this.logger.error('error handling accepted submission:', error);
      }
    }

    /* ── Timer helpers ── */

    startTimer(key) {
      if (window.ProblemTimer && key) {
        window.ProblemTimer.getInstance().startTimer(key);
      }
    }

    resetTimer() {
      if (window.ProblemTimer) window.ProblemTimer.getInstance().reset();
    }

    hideTimer() {
      if (window.ProblemTimer) window.ProblemTimer.getInstance().hideOverlay();
    }

    /* ── SPA navigation ── */

    observeUrlChanges(onUrlChange) {
      let currentHref = location.href;
      const observer = new MutationObserver(() => {
        if (location.href !== currentHref) {
          const previousHref = currentHref;
          currentHref = location.href;
          this.logger.log(`navigation: ${previousHref} -> ${currentHref}`);
          if (typeof onUrlChange === 'function') onUrlChange(currentHref, previousHref);
        }
      });
      observer.observe(document, { subtree: true, childList: true });
      return observer;
    }

    /* ── DOM fallback helpers (platforms with unverified network rules) ── */

    /**
     * Attach guarded click listeners to buttons. `finder` returns an element
     * (or null); listeners are idempotent via a data attribute.
     */
    watchButton(finder, onClick, attrName) {
      const attr = attrName || 'data-traverse-listener';

      const attach = () => {
        let button = finder();
        if (!button) return;
        if (Array.isArray(button)) {
          button.forEach((b) => this._attachIfNew(b, attr, onClick));
        } else {
          this._attachIfNew(button, attr, onClick);
        }
      };

      attach();
      setInterval(attach, 5000);
      const observer = new MutationObserver(attach);
      observer.observe(document.body, { childList: true, subtree: true });
    }

    _attachIfNew(button, attr, onClick) {
      if (!button || button.hasAttribute(attr)) return;
      button.setAttribute(attr, 'true');
      button.addEventListener('click', () => onClick(), true);
      this.logger.log('button listener attached');
    }

    /**
     * Poll `check` every `intervalMs` until it returns a non-null verdict or
     * `timeoutMs` elapses. Resolves the verdict, or null on timeout.
     */
    pollUntil(check, { intervalMs = 1000, timeoutMs = 30000 } = {}) {
      return new Promise((resolve) => {
        let elapsed = 0;
        const timer = setInterval(async () => {
          elapsed += intervalMs;
          let verdict = null;
          try {
            verdict = await check();
          } catch (_) {
            verdict = null;
          }
          if (verdict !== null && verdict !== undefined && verdict !== false) {
            clearInterval(timer);
            resolve(verdict);
          } else if (elapsed >= timeoutMs) {
            clearInterval(timer);
            resolve(null);
          }
        }, intervalMs);
      });
    }
  }

  T.PlatformAdapter = PlatformAdapter;

  /**
   * Bootstrap a platform adapter: wait for the DOM and every shared module,
   * then create (or reuse) the singleton instance. Called at the bottom of
   * every platforms/*.js file. The adapter class must declare
   * `static platform = '<id>'`.
   */
  T.startPlatform = function startPlatform(AdapterClass) {
    const ready = () =>
      T.PlatformAdapter &&
      T.AttemptTracker &&
      T.sessionStore &&
      T.submissionPipeline &&
      T.NetBridge &&
      T.ProblemTimer &&
      T.BackendAPI &&
      T.GitHubAPI &&
      window.LeetFeedbackToast &&
      window.LeetFeedbackHintPrompt;

    const boot = async () => {
      if (!ready()) {
        setTimeout(boot, 200);
        return;
      }

      const globalKey = '__traverseAdapter_' + AdapterClass.platform;
      if (!window[globalKey]) {
        window[globalKey] = new AdapterClass();
        await window[globalKey].init();
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  };
})();
