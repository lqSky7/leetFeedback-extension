// Traverse — unified submission pipeline.
//
// The post-accept flow that used to be copy-pasted into all five platform
// scripts. Contract: the adapter has ALREADY stored the solved problem data
// (storeProblemData(problemInfo, solved=true, tries)) before calling
// execute() — the backend push reads that record from storage.
//
// Flow: toast state -> hint prompt -> backend push -> optional GitHub push
// -> reset tracking state. On backend failure nothing is reset, so the next
// accepted solve retries the push.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});
  const logger = T.createLogger ? T.createLogger('pipeline') : console;

  class SubmissionPipeline {
    constructor() {
      this._backendAPI = null;
      this._githubAPI = null;
    }

    async _getBackendAPI() {
      if (!this._backendAPI && T.BackendAPI) {
        this._backendAPI = new T.BackendAPI();
      }
      if (this._backendAPI) {
        await this._backendAPI.initialize();
      }
      return this._backendAPI;
    }

    async _getGitHubAPI() {
      if (!this._githubAPI && T.GitHubAPI) {
        this._githubAPI = new T.GitHubAPI();
        await this._githubAPI.initialize();
      }
      return this._githubAPI;
    }

    /**
     * @param {Object} params
     * @param {string} params.platform - platform id ('leetcode', ...)
     * @param {Object} params.problemInfo - problem metadata (title, difficulty, url, code, language, stats)
     * @param {string} params.problemKey - storage key suffix for this problem
     * @param {Object} params.tracker - AttemptTracker instance
     * @param {Object|null} [params.submissionTracker] - toast tracker
     * @param {Function} [params.onReset] - called with the final attempts list after success
     * @returns {Promise<boolean>} true if the backend push succeeded
     */
    async execute({ platform, problemInfo, problemKey, tracker, submissionTracker = null, onReset = null }) {
      logger.log(`[${platform}] accepted submission — running pipeline for "${problemInfo.title}"`);

      // AI analysis is server-side now; move the toast to the syncing state.
      if (submissionTracker) submissionTracker.setAISkipped();

      // Step 0: self-reported assistance level — asked before the backend
      // push so the answer rides along in the same request.
      let assistanceLevel = 'none';
      try {
        if (window.LeetFeedbackHintPrompt && window.LeetFeedbackHintPrompt.ask) {
          assistanceLevel = await window.LeetFeedbackHintPrompt.ask();
          logger.log(`[${platform}] assistance level: ${assistanceLevel}`);
        }
      } catch (hintError) {
        logger.warn(`[${platform}] hint prompt failed, defaulting to none:`, hintError);
      }

      // Step 1: push to the Traverse backend.
      if (submissionTracker) submissionTracker.setBackendStarted();

      let backendPushSucceeded = false;
      try {
        const backend = await this._getBackendAPI();
        if (!backend) {
          logger.warn(`[${platform}] BackendAPI unavailable`);
        } else {
          const result = await backend.pushCurrentProblemData(problemKey, { assistanceLevel });
          if (result && result.success) {
            backendPushSucceeded = true;
            logger.log(`[${platform}] backend push successful`);
            if (submissionTracker) {
              submissionTracker.succeed(result.data?.message || 'Solution synced to Traverse!');
            }
          } else {
            const error = result?.error || 'unknown error';
            logger.error(`[${platform}] backend push failed: ${error}`);
            if (submissionTracker) submissionTracker.fail(`Sync failed: ${error}`);
          }
        }
      } catch (error) {
        logger.error(`[${platform}] backend push error:`, error);
        if (submissionTracker) submissionTracker.fail(`Sync error: ${error.message}`);
      }

      // Preserve all tracking state for a retry on the next accepted solve.
      if (!backendPushSucceeded) {
        logger.warn(`[${platform}] backend push did not succeed — preserving state for retry`);
        return false;
      }

      // Step 2: optional GitHub push (user opt-in via settings).
      try {
        const settings = await chrome.storage.sync.get([T.config.keys.github.pushEnabled]);
        if (settings[T.config.keys.github.pushEnabled] === true) {
          const github = await this._getGitHubAPI();
          if (github) {
            const result = await github.pushSolution(problemInfo, platform);
            if (result && result.success) {
              logger.log(`[${platform}] GitHub push successful`);
            } else {
              logger.warn(`[${platform}] GitHub push failed: ${result?.error}`);
            }
          }
        } else {
          logger.log(`[${platform}] GitHub push disabled by user — skipping`);
        }
      } catch (githubError) {
        logger.warn(`[${platform}] GitHub push error:`, githubError);
      }

      // Step 3: reset tracking state, persisting the final attempt history.
      const attemptsToPersist = tracker ? [...tracker.attempts] : [];
      if (tracker) tracker.reset();
      if (typeof onReset === 'function') onReset(attemptsToPersist);

      logger.log(`[${platform}] pipeline completed`);
      return true;
    }
  }

  T.submissionPipeline = new SubmissionPipeline();
  T.SubmissionPipeline = SubmissionPipeline;
})();
