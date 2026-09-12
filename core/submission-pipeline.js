// Traverse — Unified Submission Pipeline.
//
// Coordinates post-solve pipeline:
// 1. Hint Prompt (self-reported assistance level: none / hint / solution)
// 2. Traverse Backend push (via BackendAPI with attempt diffs & retry preservation)
// 3. GitHub repository push (via GitHubAPI if enabled by user)
// 4. Local DSA stats increment & success toast
// 5. Clean reset of attempt counters and problem timer

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});
  const logger = T.createLogger ? T.createLogger('SubmissionPipeline') : console;

  class SubmissionPipeline {
    constructor() {
      this.githubAPI = null;
      this.backendAPI = null;
    }

    async getBackendAPI() {
      if (!this.backendAPI && typeof BackendAPI !== 'undefined') {
        this.backendAPI = new BackendAPI();
      }
      if (this.backendAPI && typeof this.backendAPI.refreshToken === 'function') {
        await this.backendAPI.refreshToken();
      } else if (this.backendAPI) {
        await this.backendAPI.initialize();
      }
      return this.backendAPI;
    }

    async getGitHubAPI() {
      if (!this.githubAPI && typeof GitHubAPI !== 'undefined') {
        this.githubAPI = new GitHubAPI();
        await this.githubAPI.initialize();
      }
      return this.githubAPI;
    }

    /**
     * Executes the post-submission workflow when a solution is accepted.
     * @param {Object} params
     * @param {string} params.platform - 'leetcode', 'geeksforgeeks', 'takeuforward', 'codechef', 'naukri'
     * @param {Object} params.problemInfo - Problem metadata (title, number, difficulty, url, code, language, stats)
     * @param {string} params.problemKey - Storage key / slug identifying the problem
     * @param {Object} params.tracker - AttemptTracker instance
     * @param {Object} [params.submissionTracker] - Toast submission tracker
     * @param {Function} params.onReset - Callback to reset in-memory adapter state
     */
    async execute({
      platform,
      problemInfo,
      problemKey,
      tracker,
      submissionTracker = null,
      onReset = null,
    }) {
      logger.log(`Executing submission pipeline for [${platform}] problem: ${problemInfo.title}`);

      // Step 0: Ask how much help was used
      let assistanceLevel = 'none';
      try {
        if (typeof LeetFeedbackHintPrompt !== 'undefined' && LeetFeedbackHintPrompt.ask) {
          assistanceLevel = await LeetFeedbackHintPrompt.ask();
          logger.log(`Assistance level reported: ${assistanceLevel}`);
        }
      } catch (hintError) {
        logger.warn('Hint prompt failed, defaulting to none:', hintError);
      }

      // Step 1: Push to Traverse Backend
      let backendPushSucceeded = false;
      try {
        if (submissionTracker && submissionTracker.setBackendStarted) {
          submissionTracker.setBackendStarted();
        }

        const backend = await this.getBackendAPI();
        if (backend) {
          const backendResult = await backend.pushCurrentProblemData(problemKey, {
            assistanceLevel,
          });

          if (backendResult && backendResult.success) {
            backendPushSucceeded = true;
            logger.log('Backend push successful:', backendResult.data);
            if (submissionTracker) {
              const msg = backendResult.data?.message || 'Solution synced to Traverse!';
              submissionTracker.succeed(msg);
            }
          } else {
            const errorMsg = backendResult?.error || 'Unknown backend error';
            logger.error('Backend push failed:', errorMsg);
            if (submissionTracker) {
              submissionTracker.fail(`Sync failed: ${errorMsg}`);
            }
          }
        } else {
          logger.warn('BackendAPI not available in current context');
        }
      } catch (error) {
        logger.error('Backend push error:', error);
        if (submissionTracker) {
          submissionTracker.fail(`Sync error: ${error.message}`);
        }
      }

      // If backend push failed, preserve state for retry on next solve
      if (!backendPushSucceeded) {
        logger.warn('Backend push did not succeed — preserving tracking state for retry');
        return false;
      }

      // Step 2: Push to GitHub if enabled
      try {
        const ghSettings = await new Promise((resolve) => {
          chrome.storage.sync.get(['github_push_enabled'], resolve);
        });

        if (ghSettings && ghSettings.github_push_enabled === true) {
          logger.log('Pushing solution to GitHub...');
          const gh = await this.getGitHubAPI();
          if (gh) {
            const ghResult = await gh.pushSolution(problemInfo, platform);
            if (ghResult && ghResult.success) {
              logger.log('Pushed to GitHub successfully');
            } else {
              logger.warn('Failed to push to GitHub:', ghResult?.error);
            }
          }
        }
      } catch (ghError) {
        logger.warn('GitHub push error:', ghError);
      }

      // Step 3: Update local DSA solve statistics
      try {
        if (typeof DSAUtils !== 'undefined' && DSAUtils.updateStats) {
          await DSAUtils.updateStats(platform, 'increment');
        }
      } catch (statsError) {
        logger.warn('Failed to update stats:', statsError);
      }

      // Step 4: Clean reset
      if (tracker) {
        tracker.reset();
      }
      if (typeof onReset === 'function') {
        onReset();
      }

      // Reset problem timer
      if (window.ProblemTimer) {
        try {
          window.ProblemTimer.getInstance().reset();
        } catch (_) {}
      }

      logger.log(`Pipeline completed successfully for [${platform}]`);
      return true;
    }
  }

  T.submissionPipeline = new SubmissionPipeline();
  T.SubmissionPipeline = SubmissionPipeline;
})();
