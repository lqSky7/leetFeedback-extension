// Traverse — unified AttemptTracker.
//
// One implementation of the per-problem attempt tracking that used to be
// copy-pasted across all five platform scripts: run/submit attempts, failure
// counting, and the "flag for server-side AI analysis" threshold
// (Traverse.config.failedRunsBeforeAnalysis — unified, was 2 in most legacy
// paths and 3 in a few).

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});
  const logger = T.createLogger ? T.createLogger('tracker') : console;

  class AttemptTracker {
    constructor() {
      this.reset();
    }

    get threshold() {
      return (T.config && T.config.failedRunsBeforeAnalysis) || 2;
    }

    reset() {
      this.attempts = [];
      this.runCounter = 0;
      this.submitCounter = 0;
      this.incorrectRunCounter = 0;
      this.hasAnalyzedMistakes = false;
      // AI analysis is on by default for every problem — intentional, do not
      // "optimise" this back to false. The failure threshold still counts
      // attempts for reporting; it no longer gates analysis.
      this.shouldAnalyzeWithGemini = true;
      this.submissionInProgress = false;
      this.currentSubmissionAttempt = null;
      this.currentRunAttempt = null;
      this.currentSubmissionId = null;
      this.currentRunId = null;
    }

    /** Restore persisted state (chrome.storage problem_data record). */
    restore(data = {}) {
      this.attempts = data.attempts || [];
      this.runCounter = data.runCounter || 0;
      this.submitCounter = data.submitCounter || 0;
      this.incorrectRunCounter = data.incorrectRunCounter || 0;
      this.hasAnalyzedMistakes = data.hasAnalyzedMistakes || false;
      // Defaults to true; only an explicit persisted false disables analysis.
      this.shouldAnalyzeWithGemini = data.shouldAnalyzeWithGemini !== false;
    }

    /** Persistable slice of tracker state. */
    snapshot() {
      return {
        attempts: this.attempts,
        runCounter: this.runCounter,
        submitCounter: this.submitCounter,
        incorrectRunCounter: this.incorrectRunCounter,
        hasAnalyzedMistakes: this.hasAnalyzedMistakes,
        shouldAnalyzeWithGemini: this.shouldAnalyzeWithGemini,
      };
    }

    /**
     * Record a "Run" attempt. The counter always increments (matches legacy
     * behavior); the attempt is only stored when the code is non-trivial.
     */
    recordRun(code, language) {
      this.runCounter++;
      const attempt = {
        code: T.util ? T.util.sanitizeCode(code) : String(code || ''),
        language: language || 'cpp',
        timestamp: new Date().toISOString(),
        type: 'run',
        runNumber: this.runCounter,
        successful: null,
      };
      if (attempt.code && attempt.code.length > 10) {
        this.attempts.push(attempt);
        this.currentRunAttempt = attempt;
      }
      return attempt;
    }

    /** Apply a verdict to the pending run attempt. Idempotent. */
    recordRunResult(isSuccess) {
      const attempt = this.currentRunAttempt;
      if (!attempt || attempt.successful !== null) return attempt;

      attempt.successful = isSuccess;
      if (!isSuccess) this.onFailedAttempt();

      this.currentRunAttempt = null;
      this.currentRunId = null;
      return attempt;
    }

    recordSubmission(code, language) {
      this.submitCounter++;
      this.submissionInProgress = true;
      const attempt = {
        code: T.util ? T.util.sanitizeCode(code) : String(code || ''),
        language: language || 'cpp',
        timestamp: new Date().toISOString(),
        type: 'submit',
        submissionNumber: this.submitCounter,
        successful: null,
      };
      this.attempts.push(attempt);
      this.currentSubmissionAttempt = attempt;
      return attempt;
    }

    /** Apply a verdict to the pending submit attempt. Idempotent. */
    recordSubmissionResult(isAccepted) {
      const attempt = this.currentSubmissionAttempt;
      if (attempt && attempt.successful === null) {
        attempt.successful = isAccepted;
      }
      if (!isAccepted) this.onFailedAttempt();

      this.submissionInProgress = false;
      this.currentSubmissionAttempt = null;
      this.currentSubmissionId = null;
      return attempt;
    }

    /** Count a failed run/submit and flag for AI analysis at the threshold. */
    onFailedAttempt() {
      this.incorrectRunCounter++;
      if (this.incorrectRunCounter >= this.threshold && !this.hasAnalyzedMistakes) {
        logger.log(
          `${this.incorrectRunCounter} failed attempts — flagging next solve for AI analysis`
        );
        this.hasAnalyzedMistakes = true;
        this.shouldAnalyzeWithGemini = true;
      }
    }

    /** Explicitly request AI analysis for the next accepted solve. */
    flagForAnalysis() {
      this.hasAnalyzedMistakes = true;
      this.shouldAnalyzeWithGemini = true;
    }

    /** Tries reported to the backend: submit count, else runs + 1. */
    getTotalTries() {
      const submits = this.attempts.filter((a) => a.type === 'submit').length;
      return submits > 0 ? submits : this.runCounter + 1;
    }
  }

  T.AttemptTracker = AttemptTracker;
})();
