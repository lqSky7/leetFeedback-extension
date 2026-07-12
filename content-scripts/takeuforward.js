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

        // Start the unified problem timer and details polling only if on a problem page
        if (this.isProblemPage()) {
          this.pollForQuestionDetails();
          const problemSlug = this.getProblemSlugFromUrl();
          if (window.ProblemTimer && problemSlug) {
            window.ProblemTimer.getInstance().startTimer(problemSlug);
          }
        } else {
          if (window.ProblemTimer) {
            window.ProblemTimer.getInstance().hideOverlay();
          }
        }

        DSAUtils.logDebug(PLATFORM, 'TakeUforward extractor initialized');
        debugLog('[TakeUforward] Extension fully initialized');
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

          // Reset the unified problem timer based on page type
          if (window.ProblemTimer) {
            if (this.isProblemPage()) {
              window.ProblemTimer.getInstance().reset();
              window.ProblemTimer.getInstance().startTimer(this.getProblemSlugFromUrl());
            } else {
              window.ProblemTimer.getInstance().hideOverlay();
            }
          }

          if (this.isProblemPage()) {
            setTimeout(() => {
              this.fetchQuestionDetails();
            }, 4000);
          }
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
          debugLog('[TakeUforward] Captured code submission:', submitData);

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

          debugLog('[TakeUforward] Stored code data:', {
            language: SELECTED_LANGUAGE,
            codeLength: PUBLIC_CODE.length,
            problemSlug: PROBLEM_SLUG
          });

          TRIES++;
          debugLog('[TakeUforward] Tries now:', TRIES);
        }

        // CODE_RUN: Track run attempts and capture code
        else if (event.data.type === 'CODE_RUN') {
          this.runCounter++;
          debugLog(`[TakeUforward] Run button clicked - attempt #${this.runCounter}`);

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
            debugLog(`[TakeUforward] Stored run attempt #${this.runCounter}`);
          }
        }

        // RUN_RESPONSE: Track run results (success/failure)
        else if (event.data.type === 'RUN_RESPONSE') {
          const runResult = event.data.payload;
          debugLog('[TakeUforward] Run response received:', runResult);

          // Find the most recent run attempt and mark it
          const lastAttempt = this.attempts.filter(a => a.type === 'run').pop();
          if (lastAttempt && lastAttempt.successful === null) {
            if (runResult.success === true || runResult.status === 'Accepted') {
              lastAttempt.successful = true;
              debugLog(`[TakeUforward] Run #${lastAttempt.runNumber} - SUCCESS`);
            } else {
              lastAttempt.successful = false;
              this.incorrectRunCounter++;
              debugLog(`[TakeUforward] Run #${lastAttempt.runNumber} - FAILED`);
              debugLog(`[TakeUforward] Total failed runs: ${this.incorrectRunCounter}/3`);

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
          debugLog('[TakeUforward] Received submission response:', submissionData);

          if (submissionData.success === true) {
            debugLog('[TakeUforward] Submission successful! Processing...');
            await this.handleSuccessfulSubmission(submissionData);
          } else {
            debugLog('[TakeUforward] Submission was not successful. Status:', submissionData.status);
            // Count failed submissions as failed runs too
            this.incorrectRunCounter++;
            debugLog(`[TakeUforward] Total failed attempts: ${this.incorrectRunCounter}/3`);

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
        debugLog('[TakeUforward] Polling for question details...');
        this.fetchQuestionDetails();

        if (QUES && DESCRIPTION) {
          debugLog('[TakeUforward] Question details found, stopping poll');
          clearInterval(pollInterval);
        }
      }, 1000);

      // Stop polling after 30 seconds
      setTimeout(() => clearInterval(pollInterval), 30000);
    }

    checkPageType() {
      if (this.isProblemPage()) {
        setTimeout(() => {
          this.fetchQuestionDetails();
        }, 2000);
      }
    }

    fetchQuestionDetails() {
      debugLog('📖 [TakeUforward] Fetching question details...');

      const headingElem = document.querySelector('h1.text-xl.font-bold');
      const paragraphElem = document.querySelector('.tuf-text-14');

      if (headingElem && paragraphElem) {
        QUES = headingElem.textContent?.trim() || "";
        DESCRIPTION = paragraphElem.textContent?.trim() || "";
        debugLog('[TakeUforward] Question details fetched:', QUES);
      } else {
        debugLog('[TakeUforward] Question elements not found:', {
          hasHeading: !!headingElem,
          hasParagraph: !!paragraphElem
        });
      }

      // Extract difficulty
      const difficultyElement = document.querySelector('[class*="difficulty"], [class*="Difficulty"]');
      DIFFICULTY = difficultyElement?.textContent?.trim() || "Medium";
      debugLog('[TakeUforward] Extracted difficulty:', DIFFICULTY);
    }

    async extractProblemInfo() {
      try {
        // Make sure we have latest question details
        this.fetchQuestionDetails();

        // Try to get stored code data if not in memory
        if (!PUBLIC_CODE || !SELECTED_LANGUAGE || !PROBLEM_SLUG) {
          debugLog('[TakeUforward] Code data missing in memory, checking storage...');
          const storedData = await chrome.storage.local.get(['tuf_code_data']);

          if (storedData.tuf_code_data && storedData.tuf_code_data.timestamp) {
            const dataAge = Date.now() - storedData.tuf_code_data.timestamp;
            if (dataAge < 60000) { // Within 60 seconds
              SELECTED_LANGUAGE = storedData.tuf_code_data.SELECTED_LANGUAGE || SELECTED_LANGUAGE;
              PUBLIC_CODE = storedData.tuf_code_data.PUBLIC_CODE || PUBLIC_CODE;
              PROBLEM_SLUG = storedData.tuf_code_data.PROBLEM_SLUG || PROBLEM_SLUG;
              debugLog('[TakeUforward] Retrieved code data from storage (age:', Math.round(dataAge / 1000), 'seconds)');
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

    isProblemPage() {
      const url = window.location.href;
      const pathname = window.location.pathname;
      const problemSlug = this.getProblemSlugFromUrl();
      
      // Must contain takeuforward.org, /plus/, /problems/ and a valid slug
      return url.includes('takeuforward.org') && 
             pathname.includes('/plus/') && 
             pathname.includes('/problems/') && 
             problemSlug !== '' && 
             problemSlug !== 'problems';
    }

    getProblemSlugFromUrl() {
      const urlPath = window.location.pathname;
      const parts = urlPath.split('/').filter(p => p.length > 0);
      return parts[parts.length - 1] || '';
    }

    extractTopicsFromUrl() {
      const topics = [];
      const urlParams = new URLSearchParams(window.location.search);
      const categoryParam = urlParams.get('category');
      const subcategoryParam = urlParams.get('subcategory');

      let category = null;
      let subcategory = null;

      if (categoryParam) {
        category = categoryParam
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (l) => l.toUpperCase());
      }
      if (subcategoryParam) {
        subcategory = subcategoryParam
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (l) => l.toUpperCase());
      }

      // Fallback to Script Tag JSON Parsing (Highly robust Next.js RSC chunk parsing)
      if (!category || !subcategory) {
        try {
          const currentSlug = this.getProblemSlugFromUrl();
          let accumulatedText = "";
          const scripts = document.querySelectorAll('script');
          for (const script of scripts) {
            if (script.textContent) {
              accumulatedText += script.textContent.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            }
          }

          const targetPattern = `"problem_slug":"${currentSlug}"`;
          const slugIdx = accumulatedText.indexOf(targetPattern);

          if (slugIdx !== -1) {
            const precedingText = accumulatedText.substring(0, slugIdx);
            
            const categoryMatches = [...precedingText.matchAll(/"category_name"\s*:\s*"([^"]+)"/g)];
            const subcategoryMatches = [...precedingText.matchAll(/"subcategory_name"\s*:\s*"([^"]+)"/g)];
            
            if (!category && categoryMatches.length > 0) {
              category = categoryMatches[categoryMatches.length - 1][1];
            }
            if (!subcategory && subcategoryMatches.length > 0) {
              subcategory = subcategoryMatches[subcategoryMatches.length - 1][1];
            }
          }
        } catch (scriptErr) {
          debugLog('[TakeUforward] Error parsing script tags for topics:', scriptErr);
        }
      }

      // Fallback to DOM parsing if everything else fails
      try {
        if (!category) {
          const activeCategoryElem = document.querySelector('.category-root-trigger--active-path');
          if (activeCategoryElem) {
            const breakWords = activeCategoryElem.querySelector('.break-words');
            category = breakWords ? breakWords.textContent.trim() : activeCategoryElem.textContent.trim();
          }
        }

        if (!subcategory) {
          const currentSlug = this.getProblemSlugFromUrl();
          const activeLink = document.querySelector(`a[href*="/problems/${currentSlug}"]`);
          if (activeLink) {
            const collapsible = activeLink.closest('[data-slot="collapsible-content"]') || activeLink.closest('[class*="collapsible-content"]');
            if (collapsible) {
              const trigger = collapsible.previousElementSibling || document.getElementById(collapsible.getAttribute('aria-labelledby'));
              if (trigger) {
                subcategory = trigger.textContent.replace(/[▶▼▲rightdownup]/gi, '').trim();
              }
            }
          }
        }
      } catch (domError) {
        debugLog('[TakeUforward] Error parsing DOM for topics:', domError);
      }

      if (category) {
        topics.push(category);
      } else {
        topics.push('General');
      }

      if (subcategory) {
        topics.push(subcategory);
      }

      return topics;
    }

    async storeProblemData(problemInfo, solved = false) {
      try {
        const currentUrl = problemInfo.url;
        const storageKey = `problem_data_${currentUrl}`;

        const existingResult = await chrome.storage.local.get([storageKey]);
        const existingData = existingResult[storageKey] || {};

        const previousSolved = existingData.solved || { value: false, date: 0, tries: 0 };

        let solvedData;
        if (solved) {
          // Just solved or revised (update to current timestamp so backend gets a new idempotency key)
          solvedData = {
            value: true,
            date: Date.now(),
            tries: TRIES || previousSolved.tries || 1
          };
        } else if (previousSolved.value) {
          // Keep existing solved data on page load
          solvedData = previousSolved;
        } else {
          // Not solved
          solvedData = {
            value: false,
            date: 0,
            tries: TRIES || previousSolved.tries || 0
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
        debugLog('[TakeUforward] Saved problem data for:', currentUrl);

        return problemData;
      } catch (error) {
        debugError('[TakeUforward] Error saving problem data:', error);
        return null;
      }
    }

    async handleThreeIncorrectRuns() {
      // Just set flag - Gemini analysis will run on successful submit before backend push
      debugLog(`[TakeUforward] 3 failed runs detected - flagging for Gemini analysis on submit`);
      this.hasAnalyzedMistakes = true;
      this.shouldAnalyzeWithGemini = true;
    }

    async handleSuccessfulSubmission(submissionData) {
      try {
        debugLog('[TakeUforward] SUCCESSFUL SUBMISSION DETECTED');

        // Wait a bit for UI to update
        await DSAUtils.sleep(2000);

        // Extract latest problem info
        const problemInfo = await this.extractProblemInfo();

        if (!problemInfo) {
          debugError('[TakeUforward] Could not extract problem information');
          return;
        }

        // Validate we have code
        if (!problemInfo.code || problemInfo.code.length < 10) {
          debugError('[TakeUforward] Missing or invalid code. Code length:', problemInfo.code?.length);
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

        debugLog('[TakeUforward] Problem info ready for push:', {
          title: problemInfo.title,
          difficulty: problemInfo.difficulty,
          codeLength: problemInfo.code.length,
          language: problemInfo.language,
          topics: problemInfo.topics
        });

        // Store problem as solved BEFORE pushing to backend
        await this.storeProblemData(problemInfo, true);
        debugLog('[TakeUforward] Stored problem as solved');

        // Step 0: Run Gemini analysis if flagged (before backend push)
        if (this.shouldAnalyzeWithGemini) {
          debugLog(`[TakeUforward] Step 0: Running Gemini analysis before backend push...`);
          try {
            const geminiAPI = new GeminiAPI();
            const geminiConfigured = await geminiAPI.initialize();

            if (geminiConfigured) {
              // Send ALL attempts (not just failed) to Gemini for full context
              const allAttempts = this.attempts.filter(a => a.code && a.code.length > 10);
              debugLog(`[TakeUforward] Sending ${allAttempts.length} code iterations to Gemini`);

              const geminiResult = await geminiAPI.analyzeMistakes(allAttempts, problemInfo);

              if (geminiResult.success) {
                this.aiAnalysis = geminiResult.analysis;
                this.aiTags = geminiResult.tags || [];
                debugLog(`[TakeUforward] Gemini analysis complete. Tags: ${this.aiTags.join(', ')}`);

                // Update stored problem data with AI analysis
                await this.storeProblemData(problemInfo, true);
              } else {
                debugLog(`[TakeUforward] Gemini analysis failed: ${geminiResult.error}`);
              }
            } else {
              debugLog(`[TakeUforward] Gemini API key not configured - skipping analysis`);
            }
          } catch (error) {
            debugError(`[TakeUforward] Gemini analysis error:`, error);
            // Continue with submission even if Gemini fails
          }
        }

        // Step 1: Push to Backend API
        debugLog('[TakeUforward] Step 1: Pushing to backend...');
        
        // Show immediate feedback that push is starting
        let syncToast = null;
        if (window.LeetFeedbackToast) {
          syncToast = window.LeetFeedbackToast.info('Analyzing solution...', 0); // 0 = no auto-dismiss
        }
        
        try {
          if (!backendAPI) {
            debugLog('[TakeUforward] Initializing BackendAPI...');
            backendAPI = new BackendAPI();
            await backendAPI.initialize();
          }

          const backendResult = await backendAPI.pushCurrentProblemData(problemInfo.url);

          if (backendResult.success) {
            debugLog('[TakeUforward] Backend push successful!', backendResult.data);
            // Update toast to success
            if (syncToast && window.LeetFeedbackToast) {
              const message = backendResult.data?.message || 'Solution synced to Traverse!';
              window.LeetFeedbackToast.update(syncToast, message, 'success', 5000);
            }
          } else {
            debugLog('[TakeUforward] Backend push failed:', backendResult.error);
            // Update toast to error
            if (syncToast && window.LeetFeedbackToast) {
              window.LeetFeedbackToast.update(syncToast, `Sync failed: ${backendResult.error}`, 'error', 6000);
            }
          }
        } catch (error) {
          debugError('[TakeUforward] Backend push error:', error);
          // Update toast to error
          if (syncToast && window.LeetFeedbackToast) {
            window.LeetFeedbackToast.update(syncToast, `Sync error: ${error.message}`, 'error', 6000);
          }
        }

        // Step 2: Check if GitHub push is enabled
        const githubSettings = await chrome.storage.sync.get(['github_push_enabled']);
        const githubPushEnabled = githubSettings.github_push_enabled !== false; // Default to true

        if (githubPushEnabled) {
          // Step 2: Push to GitHub
          debugLog('[TakeUforward] Step 2: Pushing to GitHub...');
          const githubResult = await githubAPI.pushSolution(problemInfo, PLATFORM);

          if (githubResult.success) {
            debugLog('[TakeUforward] GitHub push successful!');

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
            debugError('[TakeUforward] GitHub push failed:', githubResult.error);
          }
        } else {
          debugLog('[TakeUforward] GitHub push disabled by user - skipping');
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
      // Store debug flag in a way that doesn't violate CSP
      // We'll pass it through a data attribute or storage instead
      chrome.storage.local.set({ 'tuf_debug_mode': isDebugMode() });
      
      // Inject the actual interceptor
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('utils/interceptor.js');
      (document.head || document.documentElement).appendChild(script);
      script.addEventListener('load', () => {
        debugLog('[TakeUforward] Interceptor script injected');
        script.remove();
      });
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
      debugLog('[TakeUforward] Waiting for utilities...');
      setTimeout(initializeTakeUforward, 500);
      return;
    }

    debugLog('[TakeUforward] Starting initialization...');
    const extractor = new TakeUforwardExtractor();
    await extractor.initialize();
  }

})();