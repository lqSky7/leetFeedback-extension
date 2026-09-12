// Traverse — Unified AttemptTracker.
//
// Tracks attempts, run counts, failure thresholds, and mistake flags.
// Failure threshold is unified across platforms via Traverse.config.failedRunsBeforeAnalysis (default: 2).

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});
  const logger = T.createLogger ? T.createLogger('AttemptTracker') : console;

  class AttemptTracker {
    constructor(initialState = {}) {
      this.reset(initialState);
    }

    get threshold() {
      return (
        (T.config && T.config.failedRunsBeforeAnalysis) ||
        2
      );
    }

    reset(state = {}) {
      this.attempts = state.attempts || [];
      this.runCounter = state.runCounter || 0;
      this.incorrectRunCounter = state.incorrectRunCounter || 0;
      this.submitCounter = state.submitCounter || 0;
      this.hasAnalyzedMistakes = state.hasAnalyzedMistakes || false;
      this.shouldAnalyzeWithGemini = state.shouldAnalyzeWithGemini || false;
      this.currentSubmissionAttempt = null;
      this.currentRunAttempt = null;
      this.currentSubmissionId = null;
      this.currentRunId = null;
      this.submissionInProgress = false;
    }

    recordRun(code, language) {
      this.runCounter++;
      const attempt = {
        code: (code || '').trim(),
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

    recordRunResult(isSuccess) {
      if (!this.currentRunAttempt) return;

      this.currentRunAttempt.successful = isSuccess;
      if (!isSuccess) {
        this.incorrectRunCounter++;
        this.checkFailureThreshold();
      }
      const attempt = this.currentRunAttempt;
      this.currentRunAttempt = null;
      this.currentRunId = null;
      return attempt;
    }

    recordSubmission(code, language) {
      this.submitCounter++;
      this.submissionInProgress = true;

      const attempt = {
        code: (code || '').trim(),
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

    recordSubmissionResult(isSuccess) {
      const attempt = this.currentSubmissionAttempt;
      if (attempt) {
        attempt.successful = isSuccess;
      }

      if (!isSuccess) {
        this.incorrectRunCounter++;
        this.checkFailureThreshold();
      }

      this.submissionInProgress = false;
      this.currentSubmissionAttempt = null;
      this.currentSubmissionId = null;
      return attempt;
    }

    checkFailureThreshold() {
      if (this.incorrectRunCounter >= this.threshold && !this.hasAnalyzedMistakes) {
        logger.log(`Threshold reached (${this.incorrectRunCounter}/${this.threshold} failures) - flagging for AI analysis`);
        this.hasAnalyzedMistakes = true;
        this.shouldAnalyzeWithGemini = true;
        return true;
      }
      return false;
    }

    getTotalTries() {
      const submissionCount = this.attempts.filter((a) => a.type === 'submit').length;
      return submissionCount > 0 ? submissionCount : this.runCounter + 1;
    }

    getState() {
      return {
        attempts: this.attempts,
        runCounter: this.runCounter,
        incorrectRunCounter: this.incorrectRunCounter,
        submitCounter: this.submitCounter,
        hasAnalyzedMistakes: this.hasAnalyzedMistakes,
        shouldAnalyzeWithGemini: this.shouldAnalyzeWithGemini,
      };
    }
  }

  T.AttemptTracker = AttemptTracker;
})();
