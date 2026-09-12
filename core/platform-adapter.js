// Traverse — Base PlatformAdapter class.
//
// Encapsulates state tracking, persistence caching, problem timers,
// toasts, and the submission pipeline for all platform content scripts.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  class PlatformAdapter {
    constructor(platformId, platformName) {
      this.platformId = platformId;
      this.platformName = platformName;
      this.logger = T.createLogger ? T.createLogger(platformName) : console;

      this.tracker = T.AttemptTracker ? new T.AttemptTracker() : null;
      this.store = T.sessionStore || null;
      this.pipeline = T.submissionPipeline || null;

      this.currentProblem = null;
      this.currentProblemKey = null;
      this.submissionTracker = null;
      this.submissionInProgress = false;
    }

    // Abstract methods to implement in subclasses
    isProblemPage() {
      throw new Error('PlatformAdapter.isProblemPage() must be implemented');
    }

    getCurrentProblemSlug() {
      throw new Error('PlatformAdapter.getCurrentProblemSlug() must be implemented');
    }

    async extractMetadata() {
      throw new Error('PlatformAdapter.extractMetadata() must be implemented');
    }

    async extractCode() {
      return '';
    }

    // Common difficulty normalizer (0: easy, 1: medium, 2: hard)
    normalizeDifficulty(difficulty) {
      if (!difficulty) return 0;
      const diff = String(difficulty).toLowerCase();
      if (diff.includes('easy') || diff.includes('school') || diff.includes('basic')) return 0;
      if (diff.includes('medium') || diff.includes('moderate')) return 1;
      if (diff.includes('hard') || diff.includes('ninja')) return 2;
      return 0;
    }

    sanitizeText(text) {
      if (!text) return '';
      return String(text)
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\u00A0/g, ' ')
        .trim();
    }

    // State persistence
    async loadState(problemKey) {
      if (!this.store || !problemKey) return null;
      try {
        const data = await this.store.getProblemData(problemKey);
        if (data && this.tracker) {
          this.tracker.reset({
            attempts: data.attempts || [],
            runCounter: data.runCounter || 0,
            incorrectRunCounter: data.incorrectRunCounter || 0,
            submitCounter: data.submitCounter || 0,
            hasAnalyzedMistakes: data.hasAnalyzedMistakes || false,
            shouldAnalyzeWithGemini: data.shouldAnalyzeWithGemini || false,
          });
        }
        return data;
      } catch (err) {
        this.logger.error('Failed to load state:', err);
        return null;
      }
    }

    async saveState(problemKey, overrides = {}) {
      if (!this.store || !problemKey) return null;
      try {
        const trackerState = this.tracker ? this.tracker.getState() : {};
        const timer = window.ProblemTimer ? window.ProblemTimer.getInstance() : null;

        const payload = {
          ...trackerState,
          problemStartTime: timer?.getStartTime() || Date.now(),
          pausedTime: timer?.getPausedTime() || 0,
          ...overrides,
        };

        return await this.store.setProblemData(problemKey, payload);
      } catch (err) {
        this.logger.error('Failed to save state:', err);
        return null;
      }
    }

    async storeProblemData(problemInfo, solved = false, tries = 0) {
      if (!this.store) return null;
      try {
        const problemKey = this.getCurrentProblemSlug();
        const existingData = (await this.store.getProblemData(problemKey)) || {};
        const previousSolved = existingData.solved || { value: false, date: 0, tries: 0 };
        const timer = window.ProblemTimer ? window.ProblemTimer.getInstance() : null;

        let solvedData;
        if (solved) {
          solvedData = {
            value: true,
            date: Date.now(),
            tries: typeof tries === 'number' ? tries : previousSolved.tries || 1,
          };
        } else if (previousSolved.value) {
          solvedData = previousSolved;
        } else {
          solvedData = {
            value: false,
            date: 0,
            tries: typeof tries === 'number' ? tries : previousSolved.tries || 0,
          };
        }

        const dataToSave = {
          ...existingData,
          name: problemInfo.title || existingData.name || 'Unknown Problem',
          platform: this.platformId,
          difficulty: this.normalizeDifficulty(problemInfo.difficulty),
          solved: solvedData,
          ignored: existingData.ignored ?? false,
          parent_topic: problemInfo.topics || existingData.parent_topic || [],
          problem_link: problemInfo.url || existingData.problem_link || window.location.href.split('?')[0],
          code: problemInfo.code || existingData.code || '',
          language: problemInfo.language || existingData.language || 'cpp',
          attempts: this.tracker ? this.tracker.attempts : existingData.attempts || [],
          runCounter: this.tracker ? this.tracker.runCounter : existingData.runCounter || 0,
          incorrectRunCounter: this.tracker ? this.tracker.incorrectRunCounter : existingData.incorrectRunCounter || 0,
          hasAnalyzedMistakes: this.tracker ? this.tracker.hasAnalyzedMistakes : existingData.hasAnalyzedMistakes || false,
          shouldAnalyzeWithGemini: this.tracker ? this.tracker.shouldAnalyzeWithGemini : existingData.shouldAnalyzeWithGemini || false,
          problemStartTime: timer?.getStartTime() || existingData.problemStartTime || Date.now(),
          pausedTime: timer?.getPausedTime() || existingData.pausedTime || 0,
        };

        await this.store.setProblemData(problemKey, dataToSave);
        return dataToSave;
      } catch (err) {
        this.logger.error('Error in storeProblemData:', err);
        return null;
      }
    }

    // Run and submission handlers
    async handleRunAttempt(code, language) {
      this.logger.log(`Recording run attempt for [${this.platformName}]`);
      if (this.tracker) {
        this.tracker.recordRun(code, language);
        await this.saveState(this.getCurrentProblemSlug());
      }
    }

    async handleRunResult(isSuccess) {
      this.logger.log(`Run result: ${isSuccess ? 'SUCCESS' : 'FAILED'}`);
      if (this.tracker) {
        this.tracker.recordRunResult(isSuccess);
        await this.saveState(this.getCurrentProblemSlug());
      }
    }

    async handleSubmissionAttempt(code, language) {
      if (this.submissionInProgress) {
        this.logger.log('Submission already in progress — skipping duplicate trigger');
        return;
      }
      this.submissionInProgress = true;

      if (window.LeetFeedbackToast && window.LeetFeedbackToast.createSubmission) {
        this.submissionTracker = window.LeetFeedbackToast.createSubmission();
      }

      if (this.tracker) {
        this.tracker.recordSubmission(code, language);
        await this.saveState(this.getCurrentProblemSlug());
      }
    }

    async handleSubmissionResult(isAccepted, stats = {}, checkData = null) {
      const statusLower = (stats.status || checkData?.status_msg || '').toLowerCase().trim();
      const pendingStatuses = [
        '', 'null', 'undefined', 'judging', 'running', 'compiling',
        'pending', 'processing', 'queued', 'in progress', 'in-progress',
        'testing', 'evaluating', 'executing', 'submitted'
      ];
      if (!isAccepted && (!statusLower || pendingStatuses.includes(statusLower))) {
        this.logger.log(`Submission in intermediate state (${statusLower || 'empty'}) — waiting for final verdict...`);
        return;
      }

      this.logger.log(`Submission verdict: ${isAccepted ? 'ACCEPTED' : 'REJECTED'}`);

      if (isAccepted) {
        if (this.tracker) {
          this.tracker.recordSubmissionResult(true);
        }

        const problemInfo = await this.extractMetadata();
        if (problemInfo) {
          problemInfo.stats = stats;
          if (!problemInfo.code) {
            problemInfo.code = await this.extractCode();
          }

          const totalTries = this.tracker ? this.tracker.getTotalTries() : 1;
          await this.storeProblemData(problemInfo, true, totalTries);

          if (this.pipeline) {
            await this.pipeline.execute({
              platform: this.platformId,
              problemInfo,
              problemKey: this.getCurrentProblemSlug(),
              tracker: this.tracker,
              submissionTracker: this.submissionTracker,
              onReset: () => {
                this.submissionInProgress = false;
                this.submissionTracker = null;
              },
            });
          }
        }
      } else {
        if (this.tracker) {
          this.tracker.recordSubmissionResult(false);
          await this.saveState(this.getCurrentProblemSlug());
        }

        if (this.submissionTracker) {
          const failMsg = stats.status || checkData?.status_msg || 'Submission failed';
          this.submissionTracker.fail(failMsg);
          this.submissionTracker = null;
        }
        this.submissionInProgress = false;
      }
    }

    // Timer helpers
    startTimer(problemKey) {
      if (window.ProblemTimer && problemKey) {
        window.ProblemTimer.getInstance().startTimer(problemKey);
      }
    }

    resetTimer() {
      if (window.ProblemTimer) {
        window.ProblemTimer.getInstance().reset();
      }
    }

    hideTimer() {
      if (window.ProblemTimer) {
        window.ProblemTimer.getInstance().hideOverlay();
      }
    }

    observeUrlChanges(onUrlChange) {
      let currentHref = location.href;

      const observer = new MutationObserver(() => {
        if (location.href !== currentHref) {
          const oldHref = currentHref;
          currentHref = location.href;
          this.logger.log(`URL changed to ${currentHref}`);
          if (typeof onUrlChange === 'function') {
            onUrlChange(currentHref, oldHref);
          }
        }
      });

      observer.observe(document, { subtree: true, childList: true });
      return observer;
    }
  }

  T.PlatformAdapter = PlatformAdapter;
})();
