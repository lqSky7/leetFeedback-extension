// LeetCode content script for DSA to GitHub extension

(function () {
  'use strict';

  const PLATFORM = DSA_PLATFORMS.LEETCODE;
  let githubAPI = null;
  let isInitialized = false;
  let extractorInstance = null; // Global singleton instance

  // LeetCode specific selectors
  const SELECTORS = {
    problemTitle: '.text-title-large, [data-cy="question-title"], h1',
    problemDescription: '[data-track-load="description_content"], [class*="description"]',
    statusSuccess: '[data-e2e-locator="submission-result"]',
    performanceMetrics: '[data-e2e-locator="submission-detail"]'
  };



  class LeetCodeExtractor {
    constructor() {
      this.currentProblem = null;
      this.currentSolution = null;
      this.isSubmissionPage = false;
      this.attempts = [];
      this.runCounter = 0; // Track number of run button presses
      this.incorrectRunCounter = 0; // Track failed runs
      this.hasAnalyzedMistakes = false; // Prevent duplicate mistake analysis
      this.currentProblemUrl = null; // Track current problem to detect problem changes
      this.bridgeReady = false;
      this.pendingCodeRequests = new Map();
      this.submissionInProgress = false;
      this.submitCounter = 0;
      this.currentSubmissionAttempt = null;
    }

    async initialize() {
      try {
        // Load persisted state from Chrome storage
        await this.loadPersistedState();

        githubAPI = new GitHubAPI();
        await githubAPI.initialize();
        this.injectMonacoBridge();
        this.setupBridgeListener();
        this.setupEventListeners();
        this.checkPageType();

        // Detect if we've changed problems - reset counters if so
        const currentUrl = this.getCurrentProblemUrl();
        if (this.currentProblemUrl !== currentUrl) {
          console.log(`🔄 [LeetCode Run Counter] Problem changed - resetting counters`);
          this.resetCounters();
          this.currentProblemUrl = currentUrl;
          await this.savePersistedState();
        }

        DSAUtils.logDebug(PLATFORM, 'LeetCode extractor initialized');
        isInitialized = true;
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Failed to initialize', error);
      }
    }

    injectMonacoBridge() {
      try {
        const id = 'leetfeedback-monaco-bridge';
        if (document.getElementById(id)) return;
        const script = document.createElement('script');
        script.id = id;
        script.src = chrome.runtime.getURL('utils/monaco-bridge.js');
        (document.head || document.documentElement).appendChild(script);
      } catch (e) {
        console.warn('[LeetCode] Failed to inject monaco bridge', e);
      }
    }

    setupBridgeListener() {
      window.addEventListener('message', (event) => {
        try {
          if (event.source !== window) return;
          const data = event.data || {};
          if (data.source !== 'LeetFeedback') return;
          if (data.type === 'LEETFEEDBACK_BRIDGE_READY') {
            this.bridgeReady = true;
            return;
          }
          if (data.type === 'LEETFEEDBACK_CODE' && data.requestId) {
            const resolver = this.pendingCodeRequests.get(data.requestId);
            if (resolver) {
              this.pendingCodeRequests.delete(data.requestId);
              resolver({ code: this._sanitizeText(data.code), language: data.language });
            }
          }
        } catch (_) { /* no-op */ }
      });
    }

    _sanitizeText(text) {
      if (!text) return '';
      return String(text)
        .replace(/\u00A0/g, ' ')
        .replace(/\u200B/g, '')
        .replace(/\r\n/g, '\n');
    }

    async getCodeViaBridge(timeoutMs = 1500) {
      try {
        const requestId = Math.random().toString(36).slice(2);
        const p = new Promise((resolve) => {
          this.pendingCodeRequests.set(requestId, resolve);
        });
        window.postMessage({ source: 'LeetFeedback', type: 'LEETFEEDBACK_REQUEST_CODE', requestId }, '*');
        const timer = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
        const result = await Promise.race([p, timer]);
        return result || { code: '', language: 'text' };
      } catch (_) {
        return { code: '', language: 'text' };
      }
    }

    getTopics() {
      try {
        const topicElements = document.querySelectorAll('div.mt-2.flex.flex-wrap.gap-1.pl-7 a');
        const topics = Array.from(topicElements)
          .map(element => element.textContent.trim())
          .filter(topic => topic.length > 0); // Filter out empty topics

        DSAUtils.logDebug(PLATFORM, `Found ${topics.length} topics:`, topics);
        return topics;
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error extracting topics', error);
        return [];
      }
    }
    // Persistence methods to maintain state across page reloads
    async loadPersistedState() {
      try {
        const currentUrl = this.getCurrentProblemUrl();
        const result = await chrome.storage.local.get([`problem_data_${currentUrl}`]);
        const problemData = result[`problem_data_${currentUrl}`];

        if (problemData) {
          console.log(`📥 [LeetCode] Loaded problem data:`, problemData);
          
          // Extract tracking info from problem data if available
          this.attempts = problemData.attempts || [];
          this.runCounter = problemData.runCounter || 0;
          this.incorrectRunCounter = problemData.incorrectRunCounter || 0;
          this.hasAnalyzedMistakes = problemData.hasAnalyzedMistakes || false;
          this.currentProblemUrl = problemData.currentProblemUrl || currentUrl;
          this.topics = problemData.parent_topic || [];
          this.submitCounter = problemData.submitCounter || 0;

          console.log(`🔢 [LeetCode] Restored - Runs: ${this.runCounter}, Failed: ${this.incorrectRunCounter}/3, Analyzed: ${this.hasAnalyzedMistakes}`);
        } else {
          console.log(`🆕 [LeetCode] No problem data found - starting fresh`);
        }
      } catch (error) {
        console.error('[LeetCode] Error loading problem data:', error);
      }
    }

    async savePersistedState(overrides = {}) {
      try {
        const currentUrl = this.getCurrentProblemUrl();
        
        // Load existing problem data to merge with tracking state
        const result = await chrome.storage.local.get([`problem_data_${currentUrl}`]);
        let problemData = result[`problem_data_${currentUrl}`] || {};

        // Merge tracking state into problem data
        problemData = {
          ...problemData,
          ...overrides,
          attempts: overrides.attempts ?? this.attempts,
          runCounter: overrides.runCounter ?? this.runCounter,
          incorrectRunCounter: overrides.incorrectRunCounter ?? this.incorrectRunCounter,
          hasAnalyzedMistakes: overrides.hasAnalyzedMistakes ?? this.hasAnalyzedMistakes,
          currentProblemUrl: overrides.currentProblemUrl ?? this.currentProblemUrl,
          parent_topic: overrides.parent_topic ?? this.topics,
          submitCounter: overrides.submitCounter ?? this.submitCounter,
          timestamp: overrides.timestamp ?? new Date().toISOString()
        };

        await chrome.storage.local.set({ [`problem_data_${currentUrl}`]: problemData });
        console.log(`💾 [LeetCode] Saved problem data for: ${currentUrl}`);
      } catch (error) {
        console.error('[LeetCode] Error saving problem data:', error);
      }
    }

    // Utility methods for new problem data format
    async storeProblemData(problemInfo, solved = false, tries = 0) {
      try {
        const currentUrl = this.getCurrentProblemUrl();
        const storageKey = `problem_data_${currentUrl}`;
        const existingResult = await chrome.storage.local.get([storageKey]);
        const existingData = existingResult[storageKey] || {};
        const previousSolved = existingData.solved || { value: false, date: 0, tries: 0 };

        const triesValue = typeof tries === 'number' ? tries : (previousSolved.tries ?? 0);

        let solvedData;
        if (previousSolved.value) {
          solvedData = previousSolved;
        } else if (solved) {
          solvedData = {
            value: true,
            date: previousSolved.date && previousSolved.date > 0 ? previousSolved.date : Date.now(),
            tries: triesValue
          };
        } else {
          solvedData = {
            value: false,
            date: 0,
            tries: triesValue
          };
        }

        const problemData = {
          ...existingData,
          name: problemInfo.title || existingData.name || 'Unknown Problem',
          platform: 'leetcode',
          difficulty: this.normalizeDifficulty(problemInfo.difficulty),
          solved: solvedData,
          ignored: existingData.ignored ?? false,
          parent_topic: problemInfo.topics || existingData.parent_topic || [],
          problem_link: problemInfo.url || existingData.problem_link || window.location.href.split('?')[0],
          
          // Include tracking state
          attempts: this.attempts || [],
          runCounter: this.runCounter || 0,
          incorrectRunCounter: this.incorrectRunCounter || 0,
          hasAnalyzedMistakes: this.hasAnalyzedMistakes || false,
          currentProblemUrl: this.currentProblemUrl || currentUrl,
          submitCounter: this.submitCounter || 0,
          timestamp: new Date().toISOString()
        };

        await chrome.storage.local.set({ [storageKey]: problemData });
        console.log(`💾 [LeetCode] Stored problem data:`, problemData);
        return problemData;
      } catch (error) {
        console.error('[LeetCode] Error storing problem data:', error);
      }
    }

    normalizeDifficulty(difficulty) {
      if (!difficulty) return 1; // Default to Easy
      const diff = difficulty.toLowerCase();
      if (diff.includes('easy')) return 1; // Easy
      if (diff.includes('medium')) return 2; // Medium
      if (diff.includes('hard')) return 3; // Hard
      return 1; // Default to Easy
    }
    getCurrentProblemUrl() {
      const url = window.location.href;
      const match = url.match(/\/problems\/([^\/]+)/);
      return match ? match[1] : 'unknown';
    }


    resetCounters() {
      this.attempts = [];
      this.runCounter = 0;
      this.incorrectRunCounter = 0;
      this.hasAnalyzedMistakes = false;
      this.topics = []; // Reset topics array
      this.submitCounter = 0;
      this.submissionInProgress = false;
      this.currentSubmissionAttempt = null;
      console.log(`🔄 [LeetCode] Counters reset for new problem`);

      // Clean up any stored problem data for this problem
      const currentUrl = this.getCurrentProblemUrl();
      chrome.storage.local.remove([`problem_data_${currentUrl}`]).catch(console.error);
    }
    setupEventListeners() {
      // Listen for URL changes (LeetCode is SPA)
      this.observeUrlChanges();

      // Listen for submission events
      this.observeSubmissions();

      // Listen for run button clicks
      this.observeRunButton();
    }

    observeUrlChanges() {
      let currentUrl = location.href;

      new MutationObserver(() => {
        if (location.href !== currentUrl) {
          currentUrl = location.href;
          setTimeout(() => {
            this.checkPageType();
            this.extractProblemInfo();
          }, 1000);
        }
      }).observe(document, { subtree: true, childList: true });
    }

    observeSubmissions() {
      const attachSubmitListener = (root) => {
        const submitButton = root.querySelector ?
          root.querySelector('button[data-e2e-locator="console-submit-button"]') : null;

        if (submitButton && !submitButton.hasAttribute('data-leetcode-submit-listener')) {
          submitButton.setAttribute('data-leetcode-submit-listener', 'true');
          submitButton.addEventListener('click', () => {
            DSAUtils.logDebug(PLATFORM, 'Submit button clicked!');
            this.handleSubmissionAttempt();
          });
        }
      };

      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              attachSubmitListener(node);
            }
          });
        });
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      attachSubmitListener(document);
    }

    observeRunButton() {
      let runButtonFound = false;

      // Monitor for run button clicks
      const checkForRunButton = () => {

        // Use the exact working selector for LeetCode run button
        const runButton = document.querySelector('button[data-e2e-locator="console-run-button"]');

        if (runButton && !runButton.hasAttribute('data-dsa-listener')) {
          if (!runButtonFound) {
            DSAUtils.logDebug(PLATFORM, `Run button found and listener attached`);
            runButtonFound = true;
          }
          runButton.setAttribute('data-dsa-listener', 'true');
          runButton.addEventListener('click', () => {
            setTimeout(() => this.handleRunAttempt(), 1000);
          });
        }
      };

      // Check initially and on DOM changes
      checkForRunButton();

      // Periodic check every 10 seconds for run button
      setInterval(() => {
        checkForRunButton();
      }, 10000);

      const observer = new MutationObserver(() => {
        checkForRunButton();
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    async handleSubmissionAttempt() {
      if (this.submissionInProgress) {
        DSAUtils.logDebug(PLATFORM, 'Submission already in progress - ignoring duplicate click');
        return;
      }

      this.submissionInProgress = true;
      this.submitCounter = (this.submitCounter || 0) + 1;

      try {
        const code = await this.getCurrentCode();
        const language = await this.getCurrentLanguage();

        const attempt = {
          code,
          language,
          timestamp: new Date().toISOString(),
          type: 'submit',
          submissionNumber: this.submitCounter,
          successful: null
        };

        this.attempts.push(attempt);
        this.currentSubmissionAttempt = attempt;

        DSAUtils.logDebug(PLATFORM, `Recorded submission attempt #${this.submitCounter}`);

        await this.savePersistedState();

        this.monitorSubmissionResult(attempt);
      } catch (error) {
        this.submissionInProgress = false;
        DSAUtils.logError(PLATFORM, 'Error handling submission attempt', error);
      }
    }

    monitorSubmissionResult(attempt) {
      let checks = 0;
      const maxChecks = 30;
      const intervalMs = 1000;

      const checkResult = async () => {
        if (!this.submissionInProgress) {
          return;
        }

        try {
          const resultElement = document.querySelector('[data-e2e-locator="submission-result"]');

          if (resultElement && resultElement.textContent) {
            const resultText = resultElement.textContent.toLowerCase();

            if (resultText.includes('accepted')) {
              attempt.successful = true;
              DSAUtils.logDebug(PLATFORM, 'Submission result detected: ACCEPTED');
              await this.savePersistedState();
              this.submissionInProgress = false;
              this.currentSubmissionAttempt = null;
              await this.handleSuccessfulSubmission(attempt);
              return;
            }

            if (resultText.includes('wrong answer') ||
              resultText.includes('runtime error') ||
              resultText.includes('time limit exceeded') ||
              resultText.includes('memory limit exceeded') ||
              resultText.includes('compile error') ||
              resultText.includes('compilation error') ||
              resultText.includes('output limit exceeded') ||
              resultText.includes('failed')) {
              attempt.successful = false;
              DSAUtils.logDebug(PLATFORM, `Submission result detected: ${resultText}`);
              await this.savePersistedState();
              this.submissionInProgress = false;
              this.currentSubmissionAttempt = null;
              return;
            }
          }

          checks++;
          if (checks < maxChecks) {
            setTimeout(() => checkResult().catch((error) => {
              DSAUtils.logError(PLATFORM, 'Error while polling submission result', error);
            }), intervalMs);
          } else {
            attempt.successful = false;
            DSAUtils.logDebug(PLATFORM, 'Submission result not detected within timeout - marking as failed');
            await this.savePersistedState();
            this.submissionInProgress = false;
            this.currentSubmissionAttempt = null;
          }
        } catch (error) {
          DSAUtils.logError(PLATFORM, 'Unexpected error while checking submission result', error);
          this.submissionInProgress = false;
          this.currentSubmissionAttempt = null;
        }
      };

      setTimeout(() => checkResult().catch((error) => {
        DSAUtils.logError(PLATFORM, 'Error while initiating submission result polling', error);
        this.submissionInProgress = false;
        this.currentSubmissionAttempt = null;
      }), intervalMs);
    }

    async handleRunAttempt() {
      try {
        this.runCounter++;
        console.log(`🏃‍♂️ [LeetCode Run Counter] Run attempt #${this.runCounter}`);

        const code = await this.getCurrentCode();
        const language = await this.getCurrentLanguage();

        DSAUtils.logDebug(PLATFORM, `Extracted code length: ${code ? code.length : 0}, language: ${language}`);

        if (code && code.length > 10) {
          const attempt = {
            code,
            language,
            timestamp: new Date().toISOString(),
            type: 'run',
            runNumber: this.runCounter,
            successful: null // Will be determined by result observation
          };

          this.attempts.push(attempt);
          console.log(`📝 [LeetCode Run Counter] Stored run attempt #${this.runCounter}`);

          // Save state after adding attempt
          await this.savePersistedState();

          // Start observing for run results
          await this.observeRunResult(attempt);

        } else {
          console.log(`❌ [LeetCode Run Counter] Run #${this.runCounter} - Code too short or empty`);
        }
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error storing run attempt', error);
      }
    }

    async observeRunResult(attempt) {
      // Look for run results to determine if the run was successful
      const checkRunResult = async () => {
        // Updated LeetCode selectors for run results
        const resultSelectors = [
          '[data-e2e-locator="console-result"]',
          '[data-e2e-locator="console-panel"]',
          '.result-container',
          '.console-wrapper',
          '.result__3-aA',
          '[class*="result"]',
          '[class*="console"]',
          '.code-output',
          '.execution-result'
        ];

        for (const selector of resultSelectors) {
          const resultElement = document.querySelector(selector);
          if (resultElement && resultElement.textContent) {
            const resultText = resultElement.textContent.toLowerCase();
            DSAUtils.logDebug(PLATFORM, `Checking result text: "${resultText.substring(0, 100)}..."`);

            // Check for successful run indicators
            if (resultText.includes('accepted') ||
              resultText.includes('success') ||
              resultText.includes('correct') ||
              resultText.includes('case passed') ||
              (resultText.includes('runtime:') && resultText.includes('memory:')) ||
              (resultText.includes('output') && !resultText.includes('expected') && !resultText.includes('wrong'))) {

              // Guard against multiple increments for the same attempt
              if (attempt.successful !== true) {
                attempt.successful = true;
                console.log(`✅ [LeetCode Run Counter] Run #${attempt.runNumber} - SUCCESS (Expected output matched)`);

                // Save state after successful attempt
                await this.savePersistedState();
              } else {
                DSAUtils.logDebug(PLATFORM, `Run #${attempt.runNumber} already marked as successful - skipping`);
              }

              return true;
            }

            // Check for failure indicators
            if (resultText.includes('wrong answer') ||
              resultText.includes('time limit exceeded') ||
              resultText.includes('runtime error') ||
              resultText.includes('compilation error') ||
              resultText.includes('expected:') ||
              resultText.includes('output:') && resultText.includes('expected:') ||
              resultText.includes('failed') ||
              resultText.includes('error') ||
              resultText.includes('incorrect')) {

              // Guard against multiple increments for the same attempt
              if (attempt.successful !== false) {
                attempt.successful = false;
                this.incorrectRunCounter++;
                console.log(`❌ [LeetCode Run Counter] Run #${attempt.runNumber} - FAILED (Incorrect output)`);
                console.log(`🔢 [LeetCode Run Counter] Total failed runs: ${this.incorrectRunCounter}/3`);

                // Save state after failed attempt
                await this.savePersistedState();

                // Check if we've reached 3 failed runs
                if (this.incorrectRunCounter >= 3 && !this.hasAnalyzedMistakes) {
                  this.handleThreeIncorrectRuns();
                }
              } else {
                DSAUtils.logDebug(PLATFORM, `Run #${attempt.runNumber} already marked as failed - skipping increment`);
              }
              return true;
            }
          }
        }
        return false;
      };

      // Check immediately and then set up observer
      const initialResult = await checkRunResult();
      if (!initialResult) {
        let checkCount = 0;
        const observer = new MutationObserver(async () => {
          checkCount++;
          if (await checkRunResult()) {
            DSAUtils.logDebug(PLATFORM, `Result detected after ${checkCount} mutations`);
            clearInterval(periodicCheck);
            observer.disconnect();
          }
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true
        });

        // Also check periodically in case mutation observer misses changes
        const periodicCheck = setInterval(async () => {
          if (await checkRunResult()) {
            DSAUtils.logDebug(PLATFORM, `Result detected via periodic check`);
            clearInterval(periodicCheck);
            observer.disconnect();
          }
        }, 1000);

        // Stop observing after 15 seconds to prevent memory leaks
        setTimeout(async () => {
          observer.disconnect();
          clearInterval(periodicCheck);
          if (attempt.successful === null) {
            // If we can't determine the result, assume it's a failed run for safety
            attempt.successful = false;
            this.incorrectRunCounter++;
            console.log(`⏰ [LeetCode Run Counter] Run #${attempt.runNumber} - TIMEOUT → Counted as FAILED (safety measure)`);
            console.log(`🔢 [LeetCode Run Counter] Total failed runs: ${this.incorrectRunCounter}/3`);

            // Save state after failed attempt
            await this.savePersistedState();

            // Check if we've reached 3 failed runs
            if (this.incorrectRunCounter >= 3 && !this.hasAnalyzedMistakes) {
              this.handleThreeIncorrectRuns();
            }
          }
        }, 15000);
      }
    }

    async handleThreeIncorrectRuns() {
      try {
        console.log(`🚨 [LeetCode Run Counter] 3 INCORRECT RUNS DETECTED - Triggering Gemini mistake analysis`);
        this.hasAnalyzedMistakes = true;

        // Save state immediately after setting analysis flag
        await this.savePersistedState();

        // Get the failed attempts (should be exactly 3 by now)
        const failedAttempts = this.attempts.filter(a => a.successful === false);
        console.log(`🔍 [LeetCode Run Counter] Analyzing ${failedAttempts.length} failed attempts`);

        // Debug: Log attempt details for verification
        console.log(`📋 [LeetCode Debug] Failed attempts:`, failedAttempts.map(a => ({
          runNumber: a.runNumber,
          successful: a.successful,
          timestamp: a.timestamp
        })));

        // Ensure we have at least 3 failed attempts
        if (failedAttempts.length < 3) {
          console.log(`⚠️ [LeetCode Run Counter] Expected 3 failed attempts, found ${failedAttempts.length}. Counter: ${this.incorrectRunCounter}`);
          return;
        }

        // Get current problem info
        const problemInfo = await this.extractProblemInfo();
        if (!problemInfo) {
          console.log(`❌ [LeetCode Run Counter] Could not extract problem info for mistake analysis`);
          return;
        }

        // Add failed attempts to problem info
        problemInfo.attempts = failedAttempts;
        problemInfo.mistakeAnalysisOnly = true; // Flag to indicate this is just for mistake analysis

        console.log(`� [LeetCode Debug] Sending to GitHub:`, {
          attempts: problemInfo.attempts.length,
          mistakeAnalysisOnly: problemInfo.mistakeAnalysisOnly,
          attemptDetails: problemInfo.attempts.map(a => ({
            runNumber: a.runNumber,
            successful: a.successful,
            hasCode: !!a.code
          }))
        });

        console.log(`�📤 [LeetCode Run Counter] Pushing mistake analysis to GitHub...`);

        // Initialize GitHub API
        if (!githubAPI) {
          githubAPI = new GitHubAPI();
          await githubAPI.initialize();
        }

        // Push mistake analysis to GitHub
        const result = await githubAPI.pushMistakeAnalysis(problemInfo, PLATFORM);

        if (result.success) {
          console.log(`✅ [LeetCode Run Counter] Mistake analysis pushed to GitHub successfully!`);
        } else {
          console.log(`❌ [LeetCode Run Counter] Failed to push mistake analysis:`, result.error);
        }

      } catch (error) {
        console.error('[LeetCode Run Counter] Error handling three incorrect runs:', error);
      }
    }



    checkPageType() {
      const url = window.location.href;
      this.isSubmissionPage = url.includes('/submissions/');

      if (url.includes('/problems/')) {
        setTimeout(() => this.extractProblemInfo(), 1000);
      }
    }

    async extractProblemInfo() {
      try {
        DSAUtils.logDebug(PLATFORM, 'Starting LeetCode problem extraction...');

        // Extract topics
        const extractedTopics = this.getTopics();

        // Update the instance topics if new ones are found
        if (extractedTopics.length > 0) {
          this.topics = extractedTopics;
          await this.savePersistedState(); // Save updated topics
        }
        const problemInfo = {
          title: this.getProblemTitle(),
          number: this.getProblemNumber(),
          description: this.getProblemDescription(),
          difficulty: this.getDifficulty(),
          url: window.location.href.split('?')[0],
          language: await this.getCurrentLanguage(),
          code: await this.getCurrentCode(),
          topics: this.topics
        };

        DSAUtils.logDebug(PLATFORM, 'Extracted data:', {
          titleFound: !!problemInfo.title,
          title: problemInfo.title,
          number: problemInfo.number,
          descriptionLength: problemInfo.description?.length || 0,
          difficulty: problemInfo.difficulty,
          language: problemInfo.language,
          codeLength: problemInfo.code?.length || 0,
          topicsCount: problemInfo.topics.length,
          topics: problemInfo.topics
        });

        // Validate required fields
        if (!problemInfo.title) {
          DSAUtils.logError(PLATFORM, 'Could not extract problem title');
          return null;
        }

        if (!problemInfo.code) {
          DSAUtils.logError(PLATFORM, 'Could not extract code - this is normal, will try again on submission');
        }

        this.currentProblem = problemInfo;
        DSAUtils.logDebug(PLATFORM, 'Problem info extracted successfully', problemInfo);

        // Store problem data as unsolved when first encountered
        await this.storeProblemData(problemInfo, false, 0);

        return problemInfo;
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error extracting problem info', error);
        return null;
      }
    }

    getProblemTitle() {
      for (let selector of ['.text-title-large', '[data-cy="question-title"]', 'h1']) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          let titleText = element.textContent.trim();
          titleText = titleText.replace(/^\d+\.\s*/, '');
          if (titleText.length > 0) {
            DSAUtils.logDebug(PLATFORM, `Found title: ${titleText}`);
            return titleText;
          }
        }
      }
      DSAUtils.logError(PLATFORM, 'No title element found');
      return null;
    }

    getProblemNumber() {
      const titleElement = document.querySelector('.text-title-large, [data-cy="question-title"], h1');
      const match = titleElement?.textContent.match(/^(\d+)\./);
      return match ? match[1] : null;
    }

    getProblemDescription() {
      const selectors = ['[data-track-load="description_content"]', '[class*="description"]'];

      for (let selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          let description = element.textContent.trim();

          // Extract only the main problem statement (before examples)
          const lines = description.split('\n');
          const mainStatement = [];

          for (let line of lines) {
            const cleanLine = line.trim();

            if (cleanLine.toLowerCase().includes('example') ||
              cleanLine.toLowerCase().includes('constraint') ||
              cleanLine.toLowerCase().includes('follow up') ||
              cleanLine.toLowerCase().includes('note:') ||
              cleanLine.startsWith('Input:') ||
              cleanLine.startsWith('Output:') ||
              cleanLine.startsWith('Explanation:')) {
              break;
            }

            if (cleanLine.length > 0) {
              mainStatement.push(cleanLine);
            }
          }

          const finalDescription = mainStatement.join(' ').trim();

          if (finalDescription.length > 20) {
            return finalDescription;
          }
        }
      }

      return '';
    }

    getDifficulty() {
      // Look for the difficulty tag with specific class structure
      const difficultySelectors = [
        '.text-difficulty-easy, .text-difficulty-medium, .text-difficulty-hard',
        '[class*="text-difficulty"]',
        '[class*="difficulty"]',
        '.relative.inline-flex.items-center.justify-center.text-caption.px-2.py-1.gap-1.rounded-full.bg-fill-secondary',
        '.bg-fill-secondary',
        'div[class*="bg-fill-secondary"]'
      ];

      for (let selector of difficultySelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          const difficultyText = element.textContent.trim();

          // Normalize difficulty levels
          if (difficultyText.toLowerCase().includes('easy')) return 'Easy';
          if (difficultyText.toLowerCase().includes('medium')) return 'Medium';
          if (difficultyText.toLowerCase().includes('hard')) return 'Hard';

          return difficultyText;
        }
      }

      return null;
    }





    async getCurrentLanguage() {
      const viaBridge = await this.getCodeViaBridge(800);
      if (viaBridge.language && viaBridge.language !== 'text') return viaBridge.language;

      const editorElement = document.querySelector('[data-mode-id]');
      if (editorElement) {
        return editorElement.getAttribute('data-mode-id');
      }
      const langSelector = document.querySelector('button[id*="headlessui-listbox-button"]');
      if (langSelector) {
        return langSelector.textContent.trim().toLowerCase();
      }
      return 'cpp';
    }

    async getCurrentCode() {
      // Preferred: page-context bridge for exact Monaco content
      const viaBridge = await this.getCodeViaBridge(1200);
      if (viaBridge.code && viaBridge.code.length > 10) return viaBridge.code;

      // Fallbacks
      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models.length > 0) {
          const code = this._sanitizeText(models[0].getValue());
          if (code && code.length > 10) return code;
        }
      }
      const selectors = ['.view-lines', '.monaco-editor', '.ace_content'];
      for (let selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          const code = this._sanitizeText(this.extractCodeFromElement(element));
          if (code && code.length > 10) return code;
        }
      }
      return this.getStoredCode() || '';
    }

    extractCodeFromElement(element) {
      const lines = element.querySelectorAll('.view-line');
      return Array.from(lines)
        .map(line => line.textContent)
        .join('\n');
    }

    getStoredCode() {
      // Check localStorage for saved code
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('code')) {
          try {
            const value = localStorage.getItem(key);
            if (value && value.length > 50) { // Assume valid code is > 50 chars
              return value;
            }
          } catch (e) {
            continue;
          }
        }
      }
      return null;
    }

    async handleSuccessfulSubmission(submissionAttempt = null) {
      try {
        console.log(`🎉 [LeetCode Submission] SUCCESSFUL SUBMISSION DETECTED`);
        console.log(`📊 [LeetCode Stats] Total runs: ${this.runCounter}, Failed runs: ${this.incorrectRunCounter}`);

        // Wait a bit for performance data to load
        await DSAUtils.sleep(2000);

        // Extract performance metrics
        const stats = this.extractPerformanceStats();

        // Get updated problem info
        const problemInfo = await this.extractProblemInfo();
        if (!problemInfo) {
          console.log(`❌ [LeetCode Submission] Could not extract problem info`);
          return;
        }

        // Add performance stats
        problemInfo.stats = stats;

        // Case 1: Normal successful submission (push solution to GitHub)
        console.log(`📤 [LeetCode Submission] Pushing successful solution to GitHub...`);

        const attemptsToPersist = [...this.attempts];
        if (submissionAttempt) {
          const latestAttempt = attemptsToPersist[attemptsToPersist.length - 1];
          if (latestAttempt && latestAttempt === submissionAttempt) {
            latestAttempt.successful = true;
          }
        } else if (attemptsToPersist.length > 0) {
          // Mark the last attempt as successful if we triggered from observer fallback
          const lastAttempt = attemptsToPersist[attemptsToPersist.length - 1];
          if (lastAttempt && lastAttempt.type === 'submit') {
            lastAttempt.successful = true;
          }
        }

        problemInfo.attempts = [];
        problemInfo.mistakeAnalysisOnly = false;

        // Push to GitHub (normal solution)
        const result = await githubAPI.pushSolution(problemInfo, PLATFORM);

        if (result.success) {
          console.log(`✅ [LeetCode Submission] Solution pushed to GitHub successfully!`);
          
          // Store problem data as solved
          this.hasAnalyzedMistakes = false;
          const submissionCount = attemptsToPersist.filter(a => a.type === 'submit').length;
          const totalTries = (submissionCount > 0 ? submissionCount : this.runCounter + 1);
          await this.storeProblemData(problemInfo, true, totalTries);
          
          // Reset counters after successful submission
          this.runCounter = 0;
          this.incorrectRunCounter = 0;
          this.attempts = [];
          this.hasAnalyzedMistakes = false;
          this.submitCounter = 0;
          this.currentSubmissionAttempt = null;

          await this.savePersistedState({
            attempts: attemptsToPersist,
            runCounter: 0,
            incorrectRunCounter: 0,
            hasAnalyzedMistakes: false,
            submitCounter: 0
          });
        } else {
          console.log(`❌ [LeetCode Submission] Failed to push solution:`, result.error);
        }

      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error handling submission', error);
      }
    }

    extractPerformanceStats() {
      const stats = {};

      const runtimeElement = document.querySelector('[class*="runtime"]');
      if (runtimeElement) {
        stats.runtime = runtimeElement.textContent.trim();
      }

      const memoryElement = document.querySelector('[class*="memory"]');
      if (memoryElement) {
        stats.memory = memoryElement.textContent.trim();
      }

      const beatsElements = document.querySelectorAll('[class*="beats"]');
      if (beatsElements.length > 0) {
        stats.beats = Array.from(beatsElements)
          .map(el => el.textContent.trim())
          .join(', ');
      }

      return stats;
    }


  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeLeetCode);
  } else {
    initializeLeetCode();
  }

  async function initializeLeetCode() {
    // Wait for required utilities to be available
    if (typeof DSAUtils === 'undefined' || typeof GitHubAPI === 'undefined') {
      setTimeout(initializeLeetCode, 500);
      return;
    }

    // Use singleton pattern to maintain state across page changes
    if (!extractorInstance) {
      extractorInstance = new LeetCodeExtractor();
      console.log(`🆕 [LeetCode Run Counter] Created new extractor instance`);
    } else {
      console.log(`♻️ [LeetCode Run Counter] Reusing existing extractor instance`);
    }

    await extractorInstance.initialize();
  }

})();
