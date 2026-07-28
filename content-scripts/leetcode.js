// LeetCode content script for DSA to GitHub extension

(function () {
  'use strict';

  const PLATFORM = DSA_PLATFORMS.LEETCODE;
  let githubAPI = null;
  let backendAPI = null;
  let isInitialized = false;
  let extractorInstance = null; // Global singleton instance

  // LeetCode specific selectors (kept for metadata extraction fallbacks)
  const SELECTORS = {
    problemTitle: '.text-title-large, [data-cy="question-title"], h1',
    problemDescription: '[data-track-load="description_content"], [class*="description"]'
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
      this.currentRunAttempt = null;
      this.currentSubmissionId = null;
      this.currentRunId = null;
      this.aiAnalysis = null; // Store Gemini AI analysis
      this.aiTags = []; // Store Gemini mistake tags
      this.shouldAnalyzeWithGemini = false; // Flag to run Gemini on submit
    }

    async initialize() {
      try {
        // Load persisted state from Chrome storage
        await this.loadPersistedState();

        githubAPI = new GitHubAPI();
        await githubAPI.initialize();

        backendAPI = new BackendAPI();
        await backendAPI.initialize();

        this.injectMonacoBridge();
        this.injectInterceptor();
        this.setupMessageListener();
        this.setupEventListeners();
        this.checkPageType();

        // Detect if we've changed problems - reset counters if so
        const currentUrl = this.getCurrentProblemUrl();
        if (this.currentProblemUrl !== currentUrl) {
          debugLog(`[LeetCode Run Counter] Problem changed - resetting counters`);
          this.resetCounters();
          this.currentProblemUrl = currentUrl;
          await this.savePersistedState();
        }

        // Start the unified problem timer (handles visibility tracking & overlay)
        if (window.ProblemTimer) {
          window.ProblemTimer.getInstance().startTimer(currentUrl);
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
        debugWarn('[LeetCode] Failed to inject monaco bridge', e);
      }
    }

    injectInterceptor() {
      try {
        const id = 'leetfeedback-interceptor';
        if (document.getElementById(id)) return;

        // Pass debug mode to storage
        chrome.storage.local.set({ 'leetcode_debug_mode': isDebugMode() });

        const script = document.createElement('script');
        script.id = id;
        script.src = chrome.runtime.getURL('utils/interceptor.js');
        (document.head || document.documentElement).appendChild(script);
        script.addEventListener('load', () => {
          DSAUtils.logDebug(PLATFORM, 'Interceptor script injected');
          script.remove();
        });
      } catch (e) {
        debugWarn('[LeetCode] Failed to inject interceptor', e);
      }
    }

    setupMessageListener() {
      window.addEventListener('message', async (event) => {
        try {
          if (event.source !== window) return;
          const data = event.data || {};

          // Monaco bridge messages
          if (data.source === 'LeetFeedback') {
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
              return;
            }
          }

          // Network interceptor messages
          if (data.type === 'LEETCODE_CODE_SUBMIT') {
            const payload = data.payload || {};
            DSAUtils.logDebug(PLATFORM, 'Network: Captured submission attempt', payload);
            await this.handleSubmissionAttemptFromNetwork(payload);
          }

          else if (data.type === 'LEETCODE_CODE_RUN') {
            const payload = data.payload || {};
            DSAUtils.logDebug(PLATFORM, 'Network: Captured run attempt', payload);
            await this.handleRunAttemptFromNetwork(payload);
          }

          else if (data.type === 'LEETCODE_SUBMIT_ID') {
            const submissionId = data.payload?.submission_id;
            if (submissionId) {
              DSAUtils.logDebug(PLATFORM, `Network: Captured submission ID: ${submissionId}`);
              this.currentSubmissionId = submissionId;
            }
          }

          else if (data.type === 'LEETCODE_RUN_ID') {
            const interpretId = data.payload?.interpret_id;
            if (interpretId) {
              DSAUtils.logDebug(PLATFORM, `Network: Captured run ID: ${interpretId}`);
              this.currentRunId = interpretId;
            }
          }

          else if (data.type === 'LEETCODE_CHECK_RESPONSE') {
            const { id, data: checkData } = data.payload || {};
            DSAUtils.logDebug(PLATFORM, `Network: Captured check response for ID ${id}`, checkData);
            await this.handleCheckResponseFromNetwork(id, checkData);
          }
        } catch (error) {
          DSAUtils.logError(PLATFORM, 'Error in message listener', error);
        }
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
          debugLog(`[LeetCode] Loaded problem data:`, problemData);

          // Extract tracking info from problem data if available
          this.attempts = problemData.attempts || [];
          this.runCounter = problemData.runCounter || 0;
          this.incorrectRunCounter = problemData.incorrectRunCounter || 0;
          this.hasAnalyzedMistakes = problemData.hasAnalyzedMistakes || false;
          this.currentProblemUrl = problemData.currentProblemUrl || currentUrl;
          this.topics = problemData.parent_topic || [];
          this.submitCounter = problemData.submitCounter || 0;
          this.aiAnalysis = problemData.aiAnalysis || null;
          this.aiTags = problemData.aiTags || [];
          this.shouldAnalyzeWithGemini = problemData.shouldAnalyzeWithGemini || false;

          debugLog(`[LeetCode] Restored - Runs: ${this.runCounter}, Failed: ${this.incorrectRunCounter}/3, Analyzed: ${this.hasAnalyzedMistakes}`);
        } else {
          debugLog(`[LeetCode] No problem data found - starting fresh`);
        }
      } catch (error) {
        debugError('[LeetCode] Error loading problem data:', error);
      }
    }

    async savePersistedState(overrides = {}) {
      try {
        const currentUrl = this.getCurrentProblemUrl();

        // Load existing problem data to merge with tracking state
        const result = await chrome.storage.local.get([`problem_data_${currentUrl}`]);
        let problemData = result[`problem_data_${currentUrl}`] || {};

        // Get time values from ProblemTimer utility
        const timer = window.ProblemTimer ? window.ProblemTimer.getInstance() : null;

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
          aiAnalysis: overrides.aiAnalysis ?? this.aiAnalysis,
          aiTags: overrides.aiTags ?? this.aiTags,
          shouldAnalyzeWithGemini: overrides.shouldAnalyzeWithGemini ?? this.shouldAnalyzeWithGemini,
          // Time values from ProblemTimer
          problemStartTime: timer?.getStartTime() || problemData.problemStartTime || Date.now(),
          pausedTime: timer?.getPausedTime() || problemData.pausedTime || 0,
          timestamp: overrides.timestamp ?? new Date().toISOString()
        };

        await chrome.storage.local.set({ [`problem_data_${currentUrl}`]: problemData });
        debugLog(`[LeetCode] Saved problem data for: ${currentUrl}`);
      } catch (error) {
        debugError('[LeetCode] Error saving problem data:', error);
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
        if (solved) {
          // Just solved or revised (update to current timestamp so backend gets a new idempotency key)
          solvedData = {
            value: true,
            date: Date.now(),
            tries: triesValue
          };
        } else if (previousSolved.value) {
          // Keep existing solved data on page load
          solvedData = previousSolved;
        } else {
          // Not solved
          solvedData = {
            value: false,
            date: 0,
            tries: triesValue
          };
        }

        // Get time values from ProblemTimer utility
        const timer = window.ProblemTimer ? window.ProblemTimer.getInstance() : null;

        const problemData = {
          ...existingData,
          name: problemInfo.title || existingData.name || 'Unknown Problem',
          platform: 'leetcode',
          difficulty: this.normalizeDifficulty(problemInfo.difficulty),
          solved: solvedData,
          ignored: existingData.ignored ?? false,
          parent_topic: problemInfo.topics || existingData.parent_topic || [],
          problem_link: problemInfo.url || existingData.problem_link || window.location.href.split('?')[0],
          code: problemInfo.code || existingData.code || '',

          // Include tracking state
          attempts: this.attempts || [],
          runCounter: this.runCounter || 0,
          incorrectRunCounter: this.incorrectRunCounter || 0,
          hasAnalyzedMistakes: this.hasAnalyzedMistakes || false,
          shouldAnalyzeWithGemini: this.shouldAnalyzeWithGemini || false,
          currentProblemUrl: this.currentProblemUrl || currentUrl,
          submitCounter: this.submitCounter || 0,
          aiAnalysis: this.aiAnalysis || null,
          aiTags: this.aiTags || [],
          // Time values from ProblemTimer
          problemStartTime: timer?.getStartTime() || existingData.problemStartTime || Date.now(),
          pausedTime: timer?.getPausedTime() || existingData.pausedTime || 0,
          timestamp: new Date().toISOString()
        };

        await chrome.storage.local.set({ [storageKey]: problemData });
        debugLog(`[LeetCode] Stored problem data:`, problemData);
        return problemData;
      } catch (error) {
        debugError('[LeetCode] Error storing problem data:', error);
      }
    }

    normalizeDifficulty(difficulty) {
      if (!difficulty) return 0; // Default to Easy
      const diff = difficulty.toLowerCase();
      if (diff.includes('easy')) return 0; // Easy
      if (diff.includes('medium')) return 1; // Medium
      if (diff.includes('hard')) return 2; // Hard
      return 0; // Default to Easy
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
      this.currentRunAttempt = null;
      this.currentSubmissionId = null;
      this.currentRunId = null;
      this.aiAnalysis = null;
      this.aiTags = [];
      this.shouldAnalyzeWithGemini = false;
      debugLog(`[LeetCode] Counters reset for new problem`);

      // Clean up any stored problem data for this problem
      const currentUrl = this.getCurrentProblemUrl();
      chrome.storage.local.remove([`problem_data_${currentUrl}`]).catch(debugError);

      // Reset the unified problem timer
      if (window.ProblemTimer) {
        window.ProblemTimer.getInstance().reset();
      }
    }

    setupEventListeners() {
      // Listen for URL changes (LeetCode is SPA)
      this.observeUrlChanges();
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

    async handleSubmissionAttemptFromNetwork(payload) {
      if (this.submissionInProgress) {
        DSAUtils.logDebug(PLATFORM, 'Submission already in progress - ignoring duplicate network trigger');
        return;
      }

      this.submissionInProgress = true;
      this.submitCounter = (this.submitCounter || 0) + 1;

      if (window.LeetFeedbackToast) {
        this.submissionTracker = window.LeetFeedbackToast.createSubmission();
      }

      try {
        const code = this._sanitizeText(payload.usercode);
        const language = payload.language || 'cpp';

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

        DSAUtils.logDebug(PLATFORM, `Recorded submission attempt #${this.submitCounter} via network`);

        await this.savePersistedState();
      } catch (error) {
        this.submissionInProgress = false;
        if (this.submissionTracker) {
          this.submissionTracker.fail(error.message || 'Failed to process submission');
          this.submissionTracker = null;
        }
        DSAUtils.logError(PLATFORM, 'Error handling submission attempt from network', error);
      }
    }

    async handleRunAttemptFromNetwork(payload) {
      try {
        this.runCounter++;
        DSAUtils.logDebug(PLATFORM, `Run attempt #${this.runCounter} via network`);

        const code = this._sanitizeText(payload.usercode);
        const language = payload.language || 'cpp';

        if (code && code.length > 10) {
          const attempt = {
            code,
            language,
            timestamp: new Date().toISOString(),
            type: 'run',
            runNumber: this.runCounter,
            successful: null
          };

          this.attempts.push(attempt);
          this.currentRunAttempt = attempt;
          DSAUtils.logDebug(PLATFORM, `Stored run attempt #${this.runCounter}`);

          await this.savePersistedState();
        }
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error storing run attempt from network', error);
      }
    }

    async handleCheckResponseFromNetwork(id, checkData) {
      if (!id || !checkData) return;

      const runSuccess = checkData.run_success; // boolean

      // 1. Is it the current submission?
      if (this.currentSubmissionId && String(id) === String(this.currentSubmissionId)) {
        if (!this.submissionInProgress || !this.currentSubmissionAttempt) {
          return;
        }

        const attempt = this.currentSubmissionAttempt;

        if (runSuccess) {
          attempt.successful = true;
          DSAUtils.logDebug(PLATFORM, 'Submission result detected: ACCEPTED');
          await this.savePersistedState();
          this.submissionInProgress = false;
          this.currentSubmissionAttempt = null;
          this.currentSubmissionId = null;
          await this.handleSuccessfulSubmission(attempt, checkData);
        } else {
          attempt.successful = false;
          const statusText = checkData.status_msg || 'Submission failed';
          DSAUtils.logDebug(PLATFORM, `Submission result detected: ${statusText}`);
          if (this.submissionTracker) {
            this.submissionTracker.fail(statusText);
            this.submissionTracker = null;
          }
          await this.savePersistedState();
          this.submissionInProgress = false;
          this.currentSubmissionAttempt = null;
          this.currentSubmissionId = null;
        }
      }

      // 2. Is it the current run?
      else if (this.currentRunId && String(id) === String(this.currentRunId)) {
        if (!this.currentRunAttempt) return;

        const attempt = this.currentRunAttempt;

        if (runSuccess) {
          if (attempt.successful !== true) {
            attempt.successful = true;
            DSAUtils.logDebug(PLATFORM, `Run #${attempt.runNumber} - SUCCESS`);
            await this.savePersistedState();
          }
        } else {
          if (attempt.successful !== false) {
            attempt.successful = false;
            this.incorrectRunCounter++;
            DSAUtils.logDebug(PLATFORM, `Run #${attempt.runNumber} - FAILED. Total failed runs: ${this.incorrectRunCounter}/3`);
            await this.savePersistedState();

            if (this.incorrectRunCounter >= 2 && !this.hasAnalyzedMistakes) {
              this.handleThreeIncorrectRuns();
            }
          }
        }
        this.currentRunAttempt = null;
        this.currentRunId = null;
      }
    }

    async handleThreeIncorrectRuns() {
      // Just set flag - Gemini analysis will run on successful submit before backend push
      debugLog(`[LeetCode] 3 failed runs detected - flagging for Gemini analysis on submit`);
      this.hasAnalyzedMistakes = true;
      this.shouldAnalyzeWithGemini = true;
      await this.savePersistedState({
        hasAnalyzedMistakes: true,
        shouldAnalyzeWithGemini: true
      });
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
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes('code')) {
          try {
            const value = localStorage.getItem(key);
            if (value && value.length > 50) {
              return value;
            }
          } catch (e) {
            continue;
          }
        }
      }
      return null;
    }

    async handleSuccessfulSubmission(submissionAttempt = null, checkData = null) {
      try {
        debugLog(`[LeetCode Submission] SUCCESSFUL SUBMISSION DETECTED`);
        debugLog(`[LeetCode Stats] Total runs: ${this.runCounter}, Failed runs: ${this.incorrectRunCounter}`);

        // Wait a bit for performance data to load
        await DSAUtils.sleep(2000);

        // Extract performance metrics
        const stats = this.extractPerformanceStats(checkData);

        // Get updated problem info
        const problemInfo = await this.extractProblemInfo();
        if (!problemInfo) {
          debugLog(`[LeetCode Submission] Could not extract problem info`);
          return;
        }

        // Add performance stats
        problemInfo.stats = stats;

        // Case 1: Normal successful submission (push to backend first, then GitHub)
        debugLog(`[LeetCode Submission] UPDATED VERSION - Pushing successful solution to backend and GitHub...`);

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

        // Store problem as solved BEFORE pushing to backend
        const submissionCount = attemptsToPersist.filter(a => a.type === 'submit').length;
        const totalTries = (submissionCount > 0 ? submissionCount : this.runCounter + 1);

        // Step 0: Run Gemini analysis if flagged (before backend push)
        if (this.shouldAnalyzeWithGemini) {
          debugLog(`[LeetCode Submission] Step 0: Running Gemini analysis before backend push...`);
          try {
            const geminiAPI = new GeminiAPI();
            const geminiConfigured = await geminiAPI.initialize();

            if (geminiConfigured) {
              // Send ALL attempts (not just failed) to Gemini for full context
              const allAttempts = this.attempts.filter(a => a.code && a.code.length > 10);
              debugLog(`[LeetCode] Sending ${allAttempts.length} code iterations to Gemini`);

              if (this.submissionTracker) {
                this.submissionTracker.setAIStarted();
              }

              const geminiResult = await geminiAPI.analyzeMistakes(allAttempts, problemInfo);

              if (geminiResult.success) {
                this.aiAnalysis = geminiResult.analysis;
                this.aiTags = geminiResult.tags || [];
                debugLog(`[LeetCode] Gemini analysis complete. Tags: ${this.aiTags.join(', ')}`);
                if (this.submissionTracker) {
                  this.submissionTracker.setAIComplete();
                }
              } else {
                debugLog(`[LeetCode] Gemini analysis failed: ${geminiResult.error}`);
                if (this.submissionTracker) {
                  this.submissionTracker.setAISkipped();
                }
              }
            } else {
              debugLog(`[LeetCode] Gemini API key not configured - skipping analysis`);
              if (this.submissionTracker) {
                this.submissionTracker.setAISkipped();
              }
            }
          } catch (error) {
            debugError(`[LeetCode] Gemini analysis error:`, error);
            if (this.submissionTracker) {
              this.submissionTracker.setAISkipped();
            }
          }
        } else {
          if (this.submissionTracker) {
            this.submissionTracker.setAISkipped();
          }
        }

        // Store problem data with AI analysis (will be picked up by backend push)
        await this.storeProblemData(problemInfo, true, totalTries);
        debugLog(`[LeetCode Submission] Stored problem as solved with ${totalTries} tries`);

        // Step 1: Push to Backend API
        debugLog(`[LeetCode Submission] Step 1: Pushing to backend...`);
        debugLog(`[LeetCode Debug] BackendAPI available:`, typeof BackendAPI !== 'undefined');
        debugLog(`[LeetCode Debug] backendAPI instance:`, backendAPI);

        if (this.submissionTracker) {
          this.submissionTracker.setBackendStarted();
        }

        let backendPushSucceeded = false;
        try {
          if (!backendAPI) {
            debugLog(`[LeetCode Submission] Initializing BackendAPI...`);
            backendAPI = new BackendAPI();
            await backendAPI.initialize();
            debugLog(`[LeetCode Submission] BackendAPI initialized:`, backendAPI);
          }

          const currentUrl = this.getCurrentProblemUrl();
          debugLog(`[LeetCode Submission] Current problem URL: ${currentUrl}`);

          const backendResult = await backendAPI.pushCurrentProblemData(currentUrl);

          if (backendResult.success) {
            backendPushSucceeded = true;
            debugLog(`[LeetCode Submission] Backend push successful!`, backendResult.data);
            if (this.submissionTracker) {
              const message = backendResult.data?.message || 'Solution synced to Traverse!';
              this.submissionTracker.succeed(message);
              this.submissionTracker = null;
            }
          } else {
            debugLog(`[LeetCode Submission] Backend push failed: ${backendResult.error}`);
            if (this.submissionTracker) {
              this.submissionTracker.fail(`Sync failed: ${backendResult.error}`);
              this.submissionTracker = null;
            }
          }
        } catch (error) {
          debugError(`[LeetCode Submission] Backend push error:`, error);
          if (this.submissionTracker) {
            this.submissionTracker.fail(`Sync error: ${error.message}`);
            this.submissionTracker = null;
          }
        }

        // If backend push failed, preserve all state (attempts, AI analysis, etc.)
        // so the next submission retry can use them
        if (!backendPushSucceeded) {
          debugLog(`[LeetCode Submission] Backend push did not succeed - preserving state for retry`);
          return;
        }

        // Step 2: Check if GitHub push is enabled
        const githubSettings = await chrome.storage.sync.get(['github_push_enabled']);
        const githubPushEnabled = githubSettings.github_push_enabled !== false; // Default to true

        if (githubPushEnabled) {
          // Step 2: Push to GitHub (normal solution)
          debugLog(`[LeetCode Submission] Step 2: Pushing to GitHub...`);
          const result = await githubAPI.pushSolution(problemInfo, PLATFORM);

          if (result.success) {
            debugLog(`[LeetCode Submission] Solution pushed to GitHub successfully!`);
          } else {
            debugLog(`[LeetCode Submission] Failed to push solution:`, result.error);
          }
        } else {
          debugLog(`[LeetCode Submission] GitHub push disabled by user - skipping`);
        }

        // Reset counters after successful backend submission
        this.runCounter = 0;
        this.incorrectRunCounter = 0;
        this.attempts = [];
        this.hasAnalyzedMistakes = false;
        this.shouldAnalyzeWithGemini = false;
        this.submitCounter = 0;
        this.currentSubmissionAttempt = null;
        this.currentRunAttempt = null;
        this.currentSubmissionId = null;
        this.currentRunId = null;
        this.aiAnalysis = null;
        this.aiTags = [];

        await this.savePersistedState({
          attempts: attemptsToPersist,
          runCounter: 0,
          incorrectRunCounter: 0,
          hasAnalyzedMistakes: false,
          shouldAnalyzeWithGemini: false,
          submitCounter: 0,
          aiAnalysis: null,
          aiTags: []
        });

      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error handling submission', error);
      }
    }

    extractPerformanceStats(checkData = null) {
      const stats = {};

      if (checkData) {
        stats.runtime = checkData.status_runtime || '';
        stats.memory = checkData.status_memory || '';
        if (checkData.runtime_percentile !== undefined || checkData.memory_percentile !== undefined) {
          const runtimePercent = checkData.runtime_percentile ? `${checkData.runtime_percentile.toFixed(1)}%` : '';
          const memoryPercent = checkData.memory_percentile ? `${checkData.memory_percentile.toFixed(1)}%` : '';
          if (runtimePercent && memoryPercent) {
            stats.beats = `Beats ${runtimePercent} for runtime, ${memoryPercent} for memory`;
          } else if (runtimePercent) {
            stats.beats = `Beats ${runtimePercent} for runtime`;
          }
        }
        return stats;
      }

      // Fallback to DOM
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
    debugLog(`[LeetCode Init] Checking dependencies - DSAUtils: ${typeof DSAUtils}, GitHubAPI: ${typeof GitHubAPI}, BackendAPI: ${typeof BackendAPI}`);
    if (typeof DSAUtils === 'undefined' || typeof GitHubAPI === 'undefined' || typeof BackendAPI === 'undefined') {
      debugLog(`[LeetCode Init] Dependencies not ready, retrying in 500ms...`);
      setTimeout(initializeLeetCode, 500);
      return;
    }

    // Use singleton pattern to maintain state across page changes
    if (!extractorInstance) {
      extractorInstance = new LeetCodeExtractor();
      debugLog(`[LeetCode Run Counter] Created new extractor instance`);
    } else {
      debugLog(`[LeetCode Run Counter] Reusing existing extractor instance`);
    }

    await extractorInstance.initialize();
  }

})();
