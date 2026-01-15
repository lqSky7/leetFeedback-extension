// TakeUforward content script for DSA to GitHub extension

(function () {
  'use strict';

  const PLATFORM = DSA_PLATFORMS.TAKEUFORWARD;
  let githubAPI = null;
  let backendAPI = null;
  let isInitialized = false;

  // State variables for code and problem tracking
  let QUES = "";
  let DESCRIPTION = "";
  let DIFFICULTY = "";
  let PROBLEM_SLUG = "";
  let SELECTED_LANGUAGE = "";
  let PUBLIC_CODE = "";
  let TRIES = 0;
  let currentPathname = window.location.pathname;

  class TakeUforwardExtractor {
    constructor() {
      this.currentProblem = null;
      this.sessionStartTime = null;
      this.lastActivityTime = Date.now();
      this.currentPathname = window.location.pathname;
      // Note: problemStartTime and pausedTime are now managed by ProblemTimer utility

      // Run tracking for Gemini analysis
      this.attempts = [];
      this.runCounter = 0;
      this.incorrectRunCounter = 0;
      this.hasAnalyzedMistakes = false;
      this.shouldAnalyzeWithGemini = false;
      this.aiAnalysis = null;
      this.aiTags = [];
    }

    async initialize() {
      try {
        // Initialize GitHub API
        githubAPI = new GitHubAPI();
        await githubAPI.initialize();

        // Initialize Backend API
        backendAPI = new BackendAPI();
        await backendAPI.initialize();

        this.setupEventListeners();
        this.injectInterceptor();
        this.checkPageType();
        this.pollForQuestionDetails();

        // Start the unified problem timer
        const problemSlug = this.getProblemSlugFromUrl();
        if (window.ProblemTimer && problemSlug) {
          window.ProblemTimer.getInstance().startTimer(problemSlug);
        }

        DSAUtils.logDebug(PLATFORM, 'TakeUforward extractor initialized');
        console.log('[TakeUforward] Extension fully initialized');
        isInitialized = true;
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Failed to initialize', error);
      }
    }

    setupEventListeners() {
      // Listen for URL changes
      this.observeUrlChanges();

      // Listen for intercepted events
      this.setupMessageListener();

      // Track user activity
      this.setupActivityTracking();
    }

    observeUrlChanges() {
      const urlChangeDetector = setInterval(() => {
        if (this.currentPathname !== window.location.pathname) {
          DSAUtils.logDebug(PLATFORM, `Path changed from ${this.currentPathname} to ${window.location.pathname}`);
          this.currentPathname = window.location.pathname;
          currentPathname = window.location.pathname;

          // Reset tries and run tracking on problem change
          TRIES = 0;
          this.attempts = [];
          this.runCounter = 0;
          this.incorrectRunCounter = 0;
          this.hasAnalyzedMistakes = false;
          this.shouldAnalyzeWithGemini = false;
          this.aiAnalysis = null;
          this.aiTags = [];

          // Reset the unified problem timer
          if (window.ProblemTimer) {
            window.ProblemTimer.getInstance().reset();
            window.ProblemTimer.getInstance().startTimer(this.getProblemSlugFromUrl());
          }

          setTimeout(() => {
            this.fetchQuestionDetails();
          }, 4000);
        }
      }, 4000);

      // Clean up on page unload
      window.addEventListener('beforeunload', () => {
        clearInterval(urlChangeDetector);
      });
    }

    setupMessageListener() {
      window.addEventListener('message', async (event) => {
        // CODE_SUBMIT: Capture code when user submits
        if (event.data.type === 'CODE_SUBMIT') {
          const submitData = event.data.payload;
          console.log('[TakeUforward] Captured code submission:', submitData);

          SELECTED_LANGUAGE = submitData.language || '';
          PUBLIC_CODE = submitData.usercode || '';
          PROBLEM_SLUG = submitData.problem_id || '';

          // Store code data in chrome storage for persistence
          await chrome.storage.local.set({
            tuf_code_data: {
              SELECTED_LANGUAGE,
              PUBLIC_CODE,
              PROBLEM_SLUG,
              timestamp: Date.now()
            }
          });

          console.log('[TakeUforward] Stored code data:', {
            language: SELECTED_LANGUAGE,
            codeLength: PUBLIC_CODE.length,
            problemSlug: PROBLEM_SLUG
          });

          TRIES++;
          console.log('[TakeUforward] Tries now:', TRIES);
        }

        // CODE_RUN: Track run attempts and capture code
        else if (event.data.type === 'CODE_RUN') {
          this.runCounter++;
          console.log(`[TakeUforward] Run button clicked - attempt #${this.runCounter}`);

          // Capture the code at this run attempt
          const runData = event.data.payload || {};
          const code = runData.usercode || PUBLIC_CODE;
          const language = runData.language || SELECTED_LANGUAGE;

          if (code && code.length > 10) {
            const attempt = {
              code,
              language,
              timestamp: new Date().toISOString(),
              type: 'run',
              runNumber: this.runCounter,
              successful: null // Will be determined by RUN_RESPONSE
            };
            this.attempts.push(attempt);
            console.log(`[TakeUforward] Stored run attempt #${this.runCounter}`);
          }
        }

        // RUN_RESPONSE: Track run results (success/failure)
        else if (event.data.type === 'RUN_RESPONSE') {
          const runResult = event.data.payload;
          console.log('[TakeUforward] Run response received:', runResult);

          // Find the most recent run attempt and mark it
          const lastAttempt = this.attempts.filter(a => a.type === 'run').pop();
          if (lastAttempt && lastAttempt.successful === null) {
            if (runResult.success === true || runResult.status === 'Accepted') {
              lastAttempt.successful = true;
              console.log(`[TakeUforward] Run #${lastAttempt.runNumber} - SUCCESS`);
            } else {
              lastAttempt.successful = false;
              this.incorrectRunCounter++;
              console.log(`[TakeUforward] Run #${lastAttempt.runNumber} - FAILED`);
              console.log(`[TakeUforward] Total failed runs: ${this.incorrectRunCounter}/3`);

              // Check if we've reached 3 failed runs
              if (this.incorrectRunCounter >= 2 && !this.hasAnalyzedMistakes) {
                this.handleThreeIncorrectRuns();
              }
            }
          }
        }

        // SUBMISSION_RESPONSE: Handle submission results
        else if (event.data.type === 'SUBMISSION_RESPONSE') {
          const submissionData = event.data.payload;
          console.log('[TakeUforward] Received submission response:', submissionData);

          if (submissionData.success === true) {
            console.log('[TakeUforward] Submission successful! Processing...');
            await this.handleSuccessfulSubmission(submissionData);
          } else {
            console.log('[TakeUforward] Submission was not successful. Status:', submissionData.status);
            // Count failed submissions as failed runs too
            this.incorrectRunCounter++;
            console.log(`[TakeUforward] Total failed attempts: ${this.incorrectRunCounter}/3`);

            if (this.incorrectRunCounter >= 3 && !this.hasAnalyzedMistakes) {
              this.handleThreeIncorrectRuns();
            }
          }
        }
      });
    }

    setupActivityTracking() {
      const handleUserActivity = () => {
        this.lastActivityTime = Date.now();
      };

      document.addEventListener('click', handleUserActivity);
      document.addEventListener('keypress', handleUserActivity);
      document.addEventListener('scroll', handleUserActivity);
      document.addEventListener('mousemove', handleUserActivity);

      // Note: visibility tracking is now handled by ProblemTimer utility
    }

    pollForQuestionDetails() {
      const pollInterval = setInterval(() => {
        console.log('[TakeUforward] Polling for question details...');
        this.fetchQuestionDetails();

        if (QUES && DESCRIPTION) {
          console.log('[TakeUforward] Question details found, stopping poll');
          clearInterval(pollInterval);
        }
      }, 1000);

      // Stop polling after 30 seconds
      setTimeout(() => clearInterval(pollInterval), 30000);
    }

    checkPageType() {
      const url = window.location.href;
      if (url.includes('takeuforward.org') && url.includes('/plus/')) {
        setTimeout(() => {
          this.fetchQuestionDetails();
        }, 2000);
      }
    }

    fetchQuestionDetails() {
      console.log('📖 [TakeUforward] Fetching question details...');

      const headingElem = document.querySelector('h1.text-xl.font-bold');
      const paragraphElem = document.querySelector('.tuf-text-14');

      if (headingElem && paragraphElem) {
        QUES = headingElem.textContent?.trim() || "";
        DESCRIPTION = paragraphElem.textContent?.trim() || "";
        console.log('[TakeUforward] Question details fetched:', QUES);
      } else {
        console.log('[TakeUforward] Question elements not found:', {
          hasHeading: !!headingElem,
          hasParagraph: !!paragraphElem
        });
      }

      // Extract difficulty
      const difficultyElement = document.querySelector('[class*="difficulty"], [class*="Difficulty"]');
      DIFFICULTY = difficultyElement?.textContent?.trim() || "Medium";
      console.log('[TakeUforward] Extracted difficulty:', DIFFICULTY);
    }

    async extractProblemInfo() {
      try {
        // Make sure we have latest question details
        this.fetchQuestionDetails();

        // Try to get stored code data if not in memory
        if (!PUBLIC_CODE || !SELECTED_LANGUAGE || !PROBLEM_SLUG) {
          console.log('[TakeUforward] Code data missing in memory, checking storage...');
          const storedData = await chrome.storage.local.get(['tuf_code_data']);

          if (storedData.tuf_code_data && storedData.tuf_code_data.timestamp) {
            const dataAge = Date.now() - storedData.tuf_code_data.timestamp;
            if (dataAge < 60000) { // Within 60 seconds
              SELECTED_LANGUAGE = storedData.tuf_code_data.SELECTED_LANGUAGE || SELECTED_LANGUAGE;
              PUBLIC_CODE = storedData.tuf_code_data.PUBLIC_CODE || PUBLIC_CODE;
              PROBLEM_SLUG = storedData.tuf_code_data.PROBLEM_SLUG || PROBLEM_SLUG;
              console.log('[TakeUforward] Retrieved code data from storage (age:', Math.round(dataAge / 1000), 'seconds)');
            }
          }
        }

        const problemInfo = {
          title: QUES,
          description: DESCRIPTION,
          difficulty: this.normalizeDifficulty(DIFFICULTY),
          url: window.location.href.split('?')[0],
          language: SELECTED_LANGUAGE,
          code: PUBLIC_CODE,
          slug: PROBLEM_SLUG || this.getProblemSlugFromUrl(),
          topics: this.extractTopicsFromUrl()
        };

        // Validate required fields
        if (!problemInfo.title) {
          DSAUtils.logDebug(PLATFORM, 'Could not extract problem title');
          return null;
        }

        if (!problemInfo.code) {
          DSAUtils.logDebug(PLATFORM, 'Could not extract problem code');
          return null;
        }

        this.currentProblem = problemInfo;
        DSAUtils.logDebug(PLATFORM, 'Problem info extracted', problemInfo);

        return problemInfo;
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error extracting problem info', error);
        return null;
      }
    }

    normalizeDifficulty(difficulty) {
      const normalized = difficulty.toLowerCase();
      if (normalized.includes('easy')) return 0;
      if (normalized.includes('medium')) return 1;
      if (normalized.includes('hard')) return 2;
      return 1; // default to medium
    }

    getProblemSlugFromUrl() {
      const urlPath = window.location.pathname;
      const parts = urlPath.split('/').filter(p => p.length > 0);
      return parts[parts.length - 1] || '';
    }

    extractTopicsFromUrl() {
      // Extract topic from URL query parameters
      // URL format: /plus/dsa/problems/3-sum?category=arrays&subcategory=faqs-medium
      const urlParams = new URLSearchParams(window.location.search);
      const categoryParam = urlParams.get('category');

      if (categoryParam) {
        // Clean up the category: "arrays" -> "Arrays"
        const topic = categoryParam
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (l) => l.toUpperCase());
        return [topic];
      }

      return ['General'];
    }

    async storeProblemData(problemInfo, solved = false) {
      try {
        const currentUrl = problemInfo.url;
        const storageKey = `problem_data_${currentUrl}`;

        const existingResult = await chrome.storage.local.get([storageKey]);
        const existingData = existingResult[storageKey] || {};

        const previousSolved = existingData.solved || { value: false, date: 0, tries: 0 };

        let solvedData;
        if (previousSolved.value) {
          // Already solved, keep previous data
          solvedData = previousSolved;
        } else if (solved) {
          // Just solved
          solvedData = {
            value: true,
            date: Date.now(),
            tries: TRIES || 1
          };
        } else {
          // Not solved
          solvedData = {
            value: false,
            date: 0,
            tries: TRIES || 0
          };
        }

        // Get time values from ProblemTimer utility
        const timer = window.ProblemTimer ? window.ProblemTimer.getInstance() : null;

        const problemData = {
          ...existingData,
          name: problemInfo.title,
          platform: 'takeuforward',
          difficulty: problemInfo.difficulty,
          solved: solvedData,
          ignored: existingData.ignored ?? false,
          parent_topic: problemInfo.topics || existingData.parent_topic || ['General'],
          problem_link: problemInfo.url,
          language: problemInfo.language || existingData.language || 'python',  // Store language
          // Time values from ProblemTimer utility
          problemStartTime: timer?.getStartTime() || existingData.problemStartTime || Date.now(),
          pausedTime: timer?.getPausedTime() || existingData.pausedTime || 0,
          // Gemini analysis data
          aiAnalysis: this.aiAnalysis || null,
          aiTags: this.aiTags || [],
          shouldAnalyzeWithGemini: this.shouldAnalyzeWithGemini || false,
          // Run tracking
          runCounter: this.runCounter || 0,
          incorrectRunCounter: this.incorrectRunCounter || 0,
          timestamp: new Date().toISOString()
        };

        await chrome.storage.local.set({ [storageKey]: problemData });
        console.log('[TakeUforward] Saved problem data for:', currentUrl);

        return problemData;
      } catch (error) {
        console.error('[TakeUforward] Error saving problem data:', error);
        return null;
      }
    }

    async handleThreeIncorrectRuns() {
      // Just set flag - Gemini analysis will run on successful submit before backend push
      console.log(`[TakeUforward] 3 failed runs detected - flagging for Gemini analysis on submit`);
      this.hasAnalyzedMistakes = true;
      this.shouldAnalyzeWithGemini = true;
    }

    async handleSuccessfulSubmission(submissionData) {
      try {
        console.log('[TakeUforward] SUCCESSFUL SUBMISSION DETECTED');

        // Wait a bit for UI to update
        await DSAUtils.sleep(2000);

        // Extract latest problem info
        const problemInfo = await this.extractProblemInfo();

        if (!problemInfo) {
          console.error('[TakeUforward] Could not extract problem information');
          return;
        }

        // Validate we have code
        if (!problemInfo.code || problemInfo.code.length < 10) {
          console.error('[TakeUforward] Missing or invalid code. Code length:', problemInfo.code?.length);
          return;
        }

        // Update problem info with submission stats
        problemInfo.stats = {
          success: submissionData.success,
          status: submissionData.status,
          totalTestCases: submissionData.totalTestCases,
          passedTestCases: submissionData.passedTestCases,
          runtime: submissionData.averageTime,
          memory: submissionData.averageMemory
        };

        console.log('[TakeUforward] Problem info ready for push:', {
          title: problemInfo.title,
          difficulty: problemInfo.difficulty,
          codeLength: problemInfo.code.length,
          language: problemInfo.language,
          topics: problemInfo.topics
        });

        // Store problem as solved BEFORE pushing to backend
        await this.storeProblemData(problemInfo, true);
        console.log('[TakeUforward] Stored problem as solved');

        // Step 0: Run Gemini analysis if flagged (before backend push)
        if (this.shouldAnalyzeWithGemini) {
          console.log(`[TakeUforward] Step 0: Running Gemini analysis before backend push...`);
          try {
            const geminiAPI = new GeminiAPI();
            const geminiConfigured = await geminiAPI.initialize();

            if (geminiConfigured) {
              // Send ALL attempts (not just failed) to Gemini for full context
              const allAttempts = this.attempts.filter(a => a.code && a.code.length > 10);
              console.log(`[TakeUforward] Sending ${allAttempts.length} code iterations to Gemini`);

              const geminiResult = await geminiAPI.analyzeMistakes(allAttempts, problemInfo);

              if (geminiResult.success) {
                this.aiAnalysis = geminiResult.analysis;
                this.aiTags = geminiResult.tags || [];
                console.log(`[TakeUforward] Gemini analysis complete. Tags: ${this.aiTags.join(', ')}`);

                // Update stored problem data with AI analysis
                await this.storeProblemData(problemInfo, true);
              } else {
                console.log(`[TakeUforward] Gemini analysis failed: ${geminiResult.error}`);
              }
            } else {
              console.log(`[TakeUforward] Gemini API key not configured - skipping analysis`);
            }
          } catch (error) {
            console.error(`[TakeUforward] Gemini analysis error:`, error);
            // Continue with submission even if Gemini fails
          }
        }

        // Step 1: Push to Backend API
        console.log('[TakeUforward] Step 1: Pushing to backend...');
        try {
          if (!backendAPI) {
            console.log('[TakeUforward] Initializing BackendAPI...');
            backendAPI = new BackendAPI();
            await backendAPI.initialize();
          }

          const backendResult = await backendAPI.pushCurrentProblemData(problemInfo.url);

          if (backendResult.success) {
            console.log('[TakeUforward] Backend push successful!', backendResult.data);
            // Show success toast
            if (window.LeetFeedbackToast) {
              const message = backendResult.data?.message || 'Solution synced to Traverse!';
              window.LeetFeedbackToast.success(message);
            }
          } else {
            console.log('[TakeUforward] Backend push failed:', backendResult.error);
            // Show error toast
            if (window.LeetFeedbackToast) {
              window.LeetFeedbackToast.error(`Sync failed: ${backendResult.error}`);
            }
          }
        } catch (error) {
          console.error('[TakeUforward] Backend push error:', error);
          // Show error toast
          if (window.LeetFeedbackToast) {
            window.LeetFeedbackToast.error(`Sync error: ${error.message}`);
          }
        }

        // Step 2: Check if GitHub push is enabled
        const githubSettings = await chrome.storage.sync.get(['github_push_enabled']);
        const githubPushEnabled = githubSettings.github_push_enabled !== false; // Default to true

        if (githubPushEnabled) {
          // Step 2: Push to GitHub
          console.log('[TakeUforward] Step 2: Pushing to GitHub...');
          const githubResult = await githubAPI.pushSolution(problemInfo, PLATFORM);

          if (githubResult.success) {
            console.log('[TakeUforward] GitHub push successful!');

            // Clear stored code data after successful push
            await chrome.storage.local.remove(['tuf_code_data']);

            // Reset state
            TRIES = 0;
            PUBLIC_CODE = '';
            SELECTED_LANGUAGE = '';
            PROBLEM_SLUG = '';
            this.attempts = [];
            this.runCounter = 0;
            this.incorrectRunCounter = 0;
            this.hasAnalyzedMistakes = false;
            this.shouldAnalyzeWithGemini = false;
            this.aiAnalysis = null;
            this.aiTags = [];
          } else {
            console.error('[TakeUforward] GitHub push failed:', githubResult.error);
          }
        } else {
          console.log('[TakeUforward] GitHub push disabled by user - skipping');
          // Still reset state
          TRIES = 0;
          PUBLIC_CODE = '';
          SELECTED_LANGUAGE = '';
          PROBLEM_SLUG = '';
          this.attempts = [];
          this.runCounter = 0;
          this.incorrectRunCounter = 0;
          this.hasAnalyzedMistakes = false;
          this.shouldAnalyzeWithGemini = false;
          this.aiAnalysis = null;
          this.aiTags = [];
        }

      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error handling submission', error);
      }
    }

    injectInterceptor() {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('utils/interceptor.js');
      (document.head || document.documentElement).appendChild(script);
      script.onload = () => {
        console.log('[TakeUforward] Interceptor script injected');
        script.remove();
      };
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeTakeUforward);
  } else {
    initializeTakeUforward();
  }

  async function initializeTakeUforward() {
    // Wait for required utilities to be available
    if (typeof DSAUtils === 'undefined' || typeof GitHubAPI === 'undefined' || typeof BackendAPI === 'undefined') {
      console.log('[TakeUforward] Waiting for utilities...');
      setTimeout(initializeTakeUforward, 500);
      return;
    }

    console.log('[TakeUforward] Starting initialization...');
    const extractor = new TakeUforwardExtractor();
    await extractor.initialize();
  }

})();