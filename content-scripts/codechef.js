// CodeChef content script for DSA to GitHub extension


(function () {
  'use strict';

  const PLATFORM = DSA_PLATFORMS.CODECHEF;
  let githubAPI = null;
  let backendAPI = null;
  let isInitialized = false;
  let submissionInProgress = false;
  let extractorInstance = null; // Global singleton instance


  class CodeChefExtractor {
    constructor() {
      this.currentProblem = null;
      this.currentSolution = null;
      this.isSubmissionInProgress = false;
      this.attempts = [];
      this.runCounter = 0;
      this.incorrectRunCounter = 0;
      this.hasAnalyzedMistakes = false;
      this.shouldAnalyzeWithGemini = false;
      this.aiAnalysis = null;
      this.aiTags = [];
      this.topics = [];
      this.currentProblemUrl = null;
    }

    async initialize() {
      try {
        DSAUtils.logDebug(PLATFORM, 'Initializing CodeChef extractor...');
        // Load persisted state from Chrome storage
        await this.loadPersistedState();

        githubAPI = new GitHubAPI();
        await githubAPI.initialize();
        DSAUtils.logDebug(PLATFORM, 'GitHubAPI initialized, configured:', githubAPI.isConfigured?.() ?? 'unknown');

        backendAPI = new BackendAPI();
        await backendAPI.initialize();

        this.setupEventListeners();
        this.checkPageType();

        // Detect if we've changed problems - reset counters if so
        const currentUrl = this.getCurrentProblemUrl();
        if (this.currentProblemUrl !== currentUrl) {
          DSAUtils.logDebug(PLATFORM, `Problem changed - resetting counters`);
          this.resetCounters();
          this.currentProblemUrl = currentUrl;
          await this.savePersistedState();
        }

        DSAUtils.logDebug(PLATFORM, '✅ CodeChef extractor fully initialized');
        isInitialized = true;
      } catch (error) {
        DSAUtils.logError(PLATFORM, '❌ Failed to initialize:', error);
      }
    }

    // Persistence methods to maintain state across page reloads
    async loadPersistedState() {
      try {
        const currentUrl = this.getCurrentProblemUrl();
        const result = await chrome.storage.local.get([`problem_data_${currentUrl}`]);
        const problemData = result[`problem_data_${currentUrl}`];

        if (problemData) {
          DSAUtils.logDebug(PLATFORM, `Loaded problem data:`, problemData);

          // Extract tracking info from problem data if available
          this.attempts = problemData.attempts || [];
          this.runCounter = problemData.runCounter || 0;
          this.incorrectRunCounter = problemData.incorrectRunCounter || 0;
          this.hasAnalyzedMistakes = problemData.hasAnalyzedMistakes || false;
          this.shouldAnalyzeWithGemini = problemData.shouldAnalyzeWithGemini || false;
          this.aiAnalysis = problemData.aiAnalysis || null;
          this.aiTags = problemData.aiTags || [];
          this.currentProblemUrl = problemData.currentProblemUrl || currentUrl;
          this.topics = problemData.parent_topic || [];

          DSAUtils.logDebug(PLATFORM, `Restored - Runs: ${this.runCounter}, Failed: ${this.incorrectRunCounter}/3, Analyzed: ${this.hasAnalyzedMistakes}, ShouldAnalyze: ${this.shouldAnalyzeWithGemini}`);
        } else {
          DSAUtils.logDebug(PLATFORM, `No problem data found - starting fresh`);
          this.topics = [];
        }
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error loading problem data:', error);
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
          shouldAnalyzeWithGemini: overrides.shouldAnalyzeWithGemini ?? this.shouldAnalyzeWithGemini,
          aiAnalysis: overrides.aiAnalysis ?? this.aiAnalysis,
          aiTags: overrides.aiTags ?? this.aiTags,
          currentProblemUrl: overrides.currentProblemUrl ?? this.currentProblemUrl,
          parent_topic: overrides.parent_topic ?? this.topics,
          timestamp: overrides.timestamp ?? new Date().toISOString()
        };

        await chrome.storage.local.set({ [`problem_data_${currentUrl}`]: problemData });
        DSAUtils.logDebug(PLATFORM, `Saved problem data for: ${currentUrl}`);
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error saving problem data:', error);
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

        const problemData = {
          ...existingData,
          name: problemInfo.title || existingData.name || 'Unknown Problem',
          platform: 'codechef',
          difficulty: this.normalizeDifficulty(problemInfo.difficulty),
          solved: solvedData,
          ignored: existingData.ignored ?? false,
          parent_topic: problemInfo.topics || problemInfo.topicTags || existingData.parent_topic || [],
          problem_link: problemInfo.url || existingData.problem_link || window.location.href.split('?')[0],
          code: problemInfo.code || existingData.code || '',

          // Include tracking state
          attempts: this.attempts || [],
          runCounter: this.runCounter || 0,
          incorrectRunCounter: this.incorrectRunCounter || 0,
          hasAnalyzedMistakes: this.hasAnalyzedMistakes || false,
          shouldAnalyzeWithGemini: this.shouldAnalyzeWithGemini || false,
          aiAnalysis: this.aiAnalysis || null,
          aiTags: this.aiTags || [],
          currentProblemUrl: this.currentProblemUrl || currentUrl,
          timestamp: new Date().toISOString()
        };

        await chrome.storage.local.set({ [storageKey]: problemData });
        DSAUtils.logDebug(PLATFORM, `Stored problem data:`, problemData);
        return problemData;
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error storing problem data:', error);
      }
    }

    normalizeDifficulty(difficulty) {
      if (!difficulty) return 0; // Default to Easy
      const diff = difficulty.toLowerCase();
      if (diff.includes('school')) return 0; // School
      if (diff.includes('basic') || diff.includes('easy')) return 0; // Easy
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
      this.shouldAnalyzeWithGemini = false;
      this.aiAnalysis = null;
      this.aiTags = [];
      this.topics = [];
      DSAUtils.logDebug(PLATFORM, `Counters reset for new problem`);

      // Clean up any stored problem data for this problem
      const currentUrl = this.getCurrentProblemUrl();
      chrome.storage.local.remove([`problem_data_${currentUrl}`]).catch(e => DSAUtils.logError(PLATFORM, e));
    }

    setupEventListeners() {
      // Listen for URL changes
      this.observeUrlChanges();

      // Monitor submissions
      this.monitorSubmissions();

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

    checkPageType() {
      const url = window.location.href;

      if (url.includes('/problems/') &&
        (url.includes('codechef.com'))) {
        const currentUrl = this.getCurrentProblemUrl();
        if (window.ProblemTimer) {
          window.ProblemTimer.getInstance().startTimer(currentUrl);
        }
        setTimeout(() => this.extractProblemInfo(), 1500);
      }
    }

    monitorSubmissions() {
      // Just attach global delegation once
      this.attachSubmitButtonListener();
    }

    observeRunButton() {
      let runButtonFound = false;

      // Monitor for run button clicks
      const checkForRunButton = () => {
        // Use the working selector for CodeChef run button
        const runButton = document.querySelector('button.problems_compile_button__Lfluz');

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

    async handleRunAttempt() {
      try {
        this.runCounter++;
        DSAUtils.logDebug(PLATFORM, `Run attempt #${this.runCounter}`);

        const code = this.getCurrentCode();
        const language = this.getCurrentLanguage();

        DSAUtils.logDebug(PLATFORM, `Extracted code length: ${code ? code.length : 0}, language: ${language}`);

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
          DSAUtils.logDebug(PLATFORM, `Stored run attempt #${this.runCounter}`);

          // Save state after adding attempt
          await this.savePersistedState();

          // Start observing for run results
          await this.observeRunResult(attempt);

        } else {
          DSAUtils.logDebug(PLATFORM, `Run #${this.runCounter} - Code too short or empty`);
        }
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error storing run attempt', error);
      }
    }

    async observeRunResult(attempt) {
      // Look for run results to determine if the run was successful
      const checkRunResult = async () => {
        // CodeChef specific selectors for run results
        const resultSelectors = [
          '.problems_content__kWANg',
          '[class*="result"]',
          '[class*="output"]',
          '.compile_and_run',
          '[class*="console"]'
        ];

        for (const selector of resultSelectors) {
          const resultElement = document.querySelector(selector);
          if (resultElement && resultElement.textContent) {
            const resultText = resultElement.textContent.toLowerCase();

            // Check for successful run indicators
            if (resultText.includes('correct') ||
              resultText.includes('passed') ||
              resultText.includes('expected output') ||
              (resultText.includes('output:') && !resultText.includes('expected:'))) {

              // Guard against multiple increments for the same attempt
              if (attempt.successful !== true) {
                attempt.successful = true;
                DSAUtils.logDebug(PLATFORM, `Run #${attempt.runNumber} - SUCCESS (Expected output matched)`);

                // Save state after successful attempt
                await this.savePersistedState();
              }
              return true;
            }

            // Check for failure indicators
            if (resultText.includes('wrong') ||
              resultText.includes('incorrect') ||
              resultText.includes('failed') ||
              resultText.includes('error') ||
              resultText.includes('expected:') ||
              resultText.includes('compilation error')) {

              // Guard against multiple increments for the same attempt
              if (attempt.successful !== false) {
                attempt.successful = false;
                this.incorrectRunCounter++;
                DSAUtils.logDebug(PLATFORM, `Run #${attempt.runNumber} - FAILED (Incorrect output)`);
                DSAUtils.logDebug(PLATFORM, `Total failed runs: ${this.incorrectRunCounter}/3`);

                // Save state after failed attempt
                await this.savePersistedState();

                // Check if we've reached 3 failed runs
                if (this.incorrectRunCounter >= 2 && !this.hasAnalyzedMistakes) {
                  this.handleThreeIncorrectRuns();
                }
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
        const observer = new MutationObserver(async () => {
          if (await checkRunResult()) {
            observer.disconnect();
          }
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true
        });

        // Stop observing after 10 seconds to prevent memory leaks
        setTimeout(async () => {
          observer.disconnect();
          if (attempt.successful === null) {
            // If we can't determine the result, assume it's a failed run for safety
            attempt.successful = false;
            this.incorrectRunCounter++;
            DSAUtils.logDebug(PLATFORM, `Run #${attempt.runNumber} - TIMEOUT → Counted as FAILED (safety measure)`);
            DSAUtils.logDebug(PLATFORM, `Total failed runs: ${this.incorrectRunCounter}/3`);

            // Save state after failed attempt
            await this.savePersistedState();

            // Check if we've reached 3 failed runs
            if (this.incorrectRunCounter >= 3 && !this.hasAnalyzedMistakes) {
              this.handleThreeIncorrectRuns();
            }
          }
        }, 10000);
      }
    }

    async handleThreeIncorrectRuns() {
      // Just set flag - Gemini analysis will run on successful submit before backend push
      DSAUtils.logDebug(PLATFORM, `3 failed runs detected - flagging for Gemini analysis on submit`);
      this.hasAnalyzedMistakes = true;
      this.shouldAnalyzeWithGemini = true;
      await this.savePersistedState({
        hasAnalyzedMistakes: true,
        shouldAnalyzeWithGemini: true
      });
    }

    attachSubmitButtonListener() {
      if (this.hasAttachedGlobalListener) return;
      this.hasAttachedGlobalListener = true;

      DSAUtils.logDebug(PLATFORM, 'Submit button listener setup starting');

      // Add a robust interval to directly attach to the button when it appears or changes
      setInterval(() => {
        const btn = document.querySelector('#submit_btn');
        if (btn && !btn.hasAttribute('data-traverse-listener')) {
          btn.setAttribute('data-traverse-listener', 'true');

          // Direct native click listener
          btn.addEventListener('click', (e) => {
            DSAUtils.logDebug(PLATFORM, 'Submit button clicked!');
            this.handleSubmissionAttempt();
          }, true); // Use capture to fire before React

          DSAUtils.logDebug(PLATFORM, 'Bound click listener to submit button');
        }
      }, 1000); // Check more frequently
    }

    async handleSubmissionAttempt() {
      DSAUtils.logDebug(PLATFORM, 'handleSubmissionAttempt called, submissionInProgress:', submissionInProgress);
      if (submissionInProgress) {
        DSAUtils.logDebug(PLATFORM, 'Submission already in progress, skipping');
        return;
      }

      submissionInProgress = true;
      this.submitCounter = (this.submitCounter || 0) + 1;
      DSAUtils.logDebug(PLATFORM, 'Submission attempt started');

      if (window.LeetFeedbackToast) {
        this.submissionTracker = window.LeetFeedbackToast.createSubmission();
      }

      try {
        // Extract problem info before submission
        await this.extractProblemInfo();
        DSAUtils.logDebug(PLATFORM, 'Problem info extracted:', this.currentProblem?.title);

        // Capture code IMMEDIATELY before knowing the result (like LeetCode)
        const code = this.getCurrentCode();
        const language = this.getCurrentLanguage();

        const attempt = {
          code,
          language,
          timestamp: new Date().toISOString(),
          type: 'submit',
          submissionNumber: this.submitCounter,
          successful: null
        };

        this.attempts.push(attempt);
        DSAUtils.logDebug(PLATFORM, `Recorded submission attempt #${this.submitCounter}`);
        await this.savePersistedState();

        // Monitor for submission result
        this.monitorSubmissionResult(attempt);
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error in handleSubmissionAttempt:', error);
        if (this.submissionTracker) {
          this.submissionTracker.fail(error.message || 'Failed to process submission');
          this.submissionTracker = null;
        }
        submissionInProgress = false;
      }
    }

    monitorSubmissionResult(attempt) {
      DSAUtils.logDebug(PLATFORM, 'Starting submission result monitoring...');
      let checkCount = 0;

      const checkInterval = setInterval(() => {
        checkCount++;
        if (checkCount <= 5 || checkCount % 10 === 0) {
          DSAUtils.logDebug(PLATFORM, `Checking for result... attempt ${checkCount}`);
        }

        // Try multiple selectors for result
        const resultSelectors = [
          'div[class*="_run__container"] span',
          'div[class*="_status-success"] span',
          '[class*="success"] span',
          '.submission-result',
          '.status-text'
        ];

        let resultElement = null;
        let resultText = '';

        for (const selector of resultSelectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent.trim()) {
            resultElement = element;
            resultText = element.textContent.trim().toLowerCase();
            break;
          }
        }

        if (resultElement && resultText && resultText.length > 2) {
          DSAUtils.logDebug(PLATFORM, `Found result text: "${resultText}"`);

          // Check for failure conditions FIRST (before success)
          if (resultText.includes('partially correct') ||
            resultText.includes('partial') ||
            resultText.includes('compilation error') ||
            resultText.includes('wrong answer') ||
            resultText.includes('time limit') ||
            resultText.includes('runtime error') ||
            resultText.includes('failed')) {
            DSAUtils.logDebug(PLATFORM, '❌ Submission failed or partial');
            attempt.successful = false;
            this.incorrectRunCounter++;
            this.savePersistedState();
            DSAUtils.logDebug(PLATFORM, `Failed submission #${this.attempts.length}, total failures: ${this.incorrectRunCounter}/3`);

            if (this.submissionTracker) {
              this.submissionTracker.fail(resultText);
              this.submissionTracker = null;
            }

            if (this.incorrectRunCounter >= 3 && !this.hasAnalyzedMistakes) {
              this.handleThreeIncorrectRuns();
            }

            clearInterval(checkInterval);
            submissionInProgress = false;
          } else if (resultText.includes('correct') ||
            resultText.includes('accepted') ||
            resultText.includes('success')) {
            DSAUtils.logDebug(PLATFORM, '✅ Successful submission detected!');
            clearInterval(checkInterval);
            submissionInProgress = false;
            this.handleSuccessfulSubmission();
          }
        }
      }, 1500);

      // Stop monitoring after 60 seconds
      setTimeout(() => {
        DSAUtils.logDebug(PLATFORM, 'Stopping result monitoring after 60 seconds');
        if (this.submissionTracker) {
          this.submissionTracker.fail('Timeout');
          this.submissionTracker = null;
        }
        clearInterval(checkInterval);
        submissionInProgress = false;
      }, 60000);
    }

    async extractProblemInfo() {
      try {
        DSAUtils.logDebug(PLATFORM, 'Starting problem extraction...');

        // Extract topics using the enhanced getTopicTags method
        const extractedTopics = this.getTopicTags();

        // Update the instance topics if new ones are found
        if (extractedTopics.length > 0) {
          this.topics = extractedTopics;
          await this.savePersistedState();
        }

        const problemInfo = {
          title: this.getProblemTitle(),
          description: this.getProblemDescription(),
          difficulty: this.getDifficulty(),
          tags: this.getTags(),
          url: window.location.href.split('?')[0],
          language: this.getCurrentLanguage(),
          code: this.getCurrentCode(),
          companyTags: this.getCompanyTags(),
          topicTags: this.getTopicTags(),
          topics: this.topics
        };

        DSAUtils.logDebug(PLATFORM, 'Extracted data:', {
          titleFound: !!problemInfo.title,
          title: problemInfo.title,
          descriptionLength: problemInfo.description?.length || 0,
          difficulty: problemInfo.difficulty,
          language: problemInfo.language,
          codeLength: problemInfo.code?.length || 0,
          companyTagsCount: problemInfo.companyTags?.length || 0,
          topicTagsCount: problemInfo.topicTags?.length || 0,
          topicsCount: problemInfo.topics.length,
          topics: problemInfo.topics,
          url: problemInfo.url
        });

        // Validate required fields
        if (!problemInfo.title) {
          DSAUtils.logError(PLATFORM, 'Could not extract problem title - checking available elements...');
          this.debugAvailableElements();
          return null;
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
      DSAUtils.logDebug(PLATFORM, 'getProblemTitle called, document.title:', document.title);

      // Priority 1: document title (most reliable on IDE tab)
      // CodeChef titles look like: "Water Consumption Practice Coding Problem | CodeChef"
      const docTitle = document.title;
      if (docTitle) {
        // Strip " | CodeChef" or " - CodeChef" suffix
        let cleanTitle = docTitle
          .replace(/\s*[\||\-]\s*CodeChef\s*$/i, '')
          .replace(/\s*Practice Coding Problem\s*$/i, '')
          .replace(/\s*Problem\s*$/i, '')
          .trim();

        if (cleanTitle.length > 2) {
          DSAUtils.logDebug(PLATFORM, 'Extracted title from document.title:', cleanTitle);
          return cleanTitle;
        }
      }

      // Priority 2: CodeChef-specific selectors (if on statement tab)
      const selectors = [
        'h3.notranslate',
        '[class*="problemBanner_title"]',
        'h3:not(.logo)'
      ];

      for (let selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          const title = element.textContent.trim();
          if (title.length > 3 && !title.toLowerCase().includes('codechef')) {
            DSAUtils.logDebug(PLATFORM, 'Found title with selector:', selector, title);
            return title;
          }
        }
      }

      // Priority 3: Extract from URL path
      const pathMatch = window.location.pathname.match(/problems\/([^\/\?]+)/);
      if (pathMatch) {
        const urlTitle = pathMatch[1].replace(/-/g, ' ');
        DSAUtils.logDebug(PLATFORM, 'Using URL-based title:', urlTitle);
        return urlTitle;
      }

      DSAUtils.logError(PLATFORM, 'No title found');
      return null;
    }

    getProblemDescription() {
      DSAUtils.logDebug(PLATFORM, 'Trying to find problem description...');

      const selectors = [
        '[class*="problems_problem_content"]',
        '.problem-description',
        '[class*="problem_content"]',
        '.problem-statement',
        '[class*="statement"]',
        '[class*="description"]',
        '.content',
        'main',
        '[class*="body"]',
        '.ui.segment',
        'article'
      ];

      for (let selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          let description = element.textContent || element.innerText || '';

          // Extract only the main problem statement (before examples)
          const lines = description.split('\n');
          const mainStatement = [];

          for (let line of lines) {
            const cleanLine = line.trim();

            // Stop at examples, constraints, or other sections
            if (cleanLine.toLowerCase().includes('example') ||
              cleanLine.toLowerCase().includes('constraint') ||
              cleanLine.toLowerCase().includes('input:') ||
              cleanLine.toLowerCase().includes('output:') ||
              cleanLine.toLowerCase().includes('expected time complexity') ||
              cleanLine.toLowerCase().includes('expected auxiliary space') ||
              cleanLine.toLowerCase().includes('explanation:') ||
              cleanLine.toLowerCase().includes('company tags') ||
              cleanLine.toLowerCase().includes('topic tags') ||
              cleanLine.toLowerCase().includes('login') ||
              cleanLine.toLowerCase().includes('signup') ||
              cleanLine.toLowerCase().includes('practice') ||
              cleanLine.toLowerCase().includes('courses')) {
              break;
            }

            // Skip empty lines and add meaningful content
            if (cleanLine.length > 0 && cleanLine.length > 10) {
              mainStatement.push(cleanLine);
            }
          }

          const finalDescription = mainStatement.join(' ').trim();

          if (finalDescription.length > 20) {
            DSAUtils.logDebug(PLATFORM, `Found main statement with selector: ${selector}`, finalDescription.substring(0, 100) + '...');
            return finalDescription;
          }
        }
      }

      DSAUtils.logError(PLATFORM, 'No description element found');
      return '';
    }

    getDifficulty() {
      // Try multiple selectors to find the difficulty rating
      const selectors = [
        'div[class*="_problemBanner__container"]',
        'div[class*="problemBanner"]',
        '[class*="difficulty"]',
        'div[class*="_problem__container"]'
      ];

      let ratingText = null;

      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) {
          const text = el.textContent.trim();
          const match = text.match(/Difficulty[:\s]*(\d+)/i);
          if (match && match[1]) {
            ratingText = match[1];
            break;
          }
        }
      }

      // Also check the full page text as fallback
      if (!ratingText) {
        const pageText = document.body?.innerText || '';
        const match = pageText.match(/Difficulty[:\s]*(\d+)/i);
        if (match && match[1]) {
          ratingText = match[1];
        }
      }

      if (ratingText) {
        const rating = parseInt(ratingText, 10);
        DSAUtils.logDebug(PLATFORM, 'Found difficulty rating:', rating);
        return this.mapRatingToTier(rating);
      }

      DSAUtils.logDebug(PLATFORM, 'Could not find difficulty rating');
      return null;
    }

    /**
     * Map CodeChef difficulty rating to a named tier for GitHub folder structure.
     * Tiers:
     *   0-500:    Basic (syntax, I/O, simple logic)
     *   500-1000: Easy (arrays, loops, basic math)
     *   1000-1400: Medium (standard problems, Division 4)
     *   1400-2000: Hard (competitive programming)
     *   2000+:    Advanced (expert-level CP)
     */
    mapRatingToTier(rating) {
      if (rating < 500) return 'Basic';
      if (rating < 1000) return 'Easy';
      if (rating < 1400) return 'Medium';
      if (rating < 2000) return 'Hard';
      return 'Advanced';
    }

    getTags() {
      // Combine company and topic tags
      return [...this.getCompanyTags(), ...this.getTopicTags()];
    }

    getCompanyTags() {
      const tags = [];
      const tagHeadings = document.querySelectorAll('.problems_tag_container__kWANg');

      for (let heading of tagHeadings) {
        if (heading.textContent.includes('Company Tags')) {
          const contentDiv = heading.nextElementSibling;
          if (contentDiv && contentDiv.classList.contains('content')) {
            // Temporarily make it active to get tags
            contentDiv.classList.add('active');
            const tagElements = contentDiv.querySelectorAll('span, div');

            for (let tagEl of tagElements) {
              const tagText = tagEl.textContent.trim();
              if (tagText && !tags.includes(tagText)) {
                tags.push(tagText);
              }
            }

            contentDiv.classList.remove('active');
          }
          break;
        }
      }

      return tags;
    }

    getTopicTags() {
      const tags = [];

      const topicElements = document.querySelectorAll('.problems_accordion_tags__JJ2DX:nth-child(3) .ui.labels a');
      if (topicElements.length > 0) {
        Array.from(topicElements).forEach(element => {
          const tagText = element.textContent.trim();
          if (tagText && !tags.includes(tagText)) {
            tags.push(tagText);
          }
        });
        DSAUtils.logDebug(PLATFORM, `Found ${tags.length} topic tags with new selector:`, tags);
        return tags;
      }
    }

    getCurrentLanguage() {
      const langElement = document.querySelector('#language-select');
      if (!langElement) return 'Unknown'; // Default

      let langText = '';
      if (langElement.tagName === 'SELECT') {
        langText = langElement.options[langElement.selectedIndex].text;
      } else {
        langText = langElement.textContent.trim();
      }
      // Remove anything in parentheses, e.g. "Java (21)" -> "Java"
      return langText.replace(/\(.*?\)/, '').trim();
    }
    getCurrentCode() {
      DSAUtils.logDebug(PLATFORM, 'Trying to extract current code...');

      // Method 1: Try to get from editor DOM
      const selectors = [
        '.ace_content',
        '.CodeMirror-code',
        '.monaco-editor',
        '.ace_editor',
        '[class*="editor"]',
        'textarea',
        '[class*="code"]',
        '.ace_text-input',
        '#editor',
        '[id*="editor"]',
        '[class*="codemirror"]'
      ];

      for (let selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          const code = this.extractCodeFromElement(element);
          if (code && code.length > 10) {
            DSAUtils.logDebug(PLATFORM, `Found code with selector: ${selector}`, code.substring(0, 100) + '...');
            return code;
          }
        }
      }

      // Method 2: Try to get from textarea elements specifically
      const textareas = document.querySelectorAll('textarea');
      for (let textarea of textareas) {
        const code = textarea.value;
        if (code && code.length > 10) {
          DSAUtils.logDebug(PLATFORM, 'Found code in textarea element', code.substring(0, 100) + '...');
          return code;
        }
      }

      DSAUtils.logDebug(PLATFORM, 'No code found in editor, trying stored solution...');
      // Method 3: Try to get from stored solution
      return this.getStoredSolution();
    }

    extractCodeFromElement(element) {
      // For ACE editor
      if (element.classList.contains('ace_content')) {
        const lines = element.querySelectorAll('.ace_line');
        return Array.from(lines)
          .map(line => line.textContent)
          .join('\n');
      }

      // For CodeMirror
      if (element.classList.contains('CodeMirror-code')) {
        const lines = element.querySelectorAll('.CodeMirror-line');
        return Array.from(lines)
          .map(line => line.textContent)
          .join('\n');
      }

      // For Monaco editor
      if (element.classList.contains('monaco-editor')) {
        const lines = element.querySelectorAll('.view-line');
        return Array.from(lines)
          .map(line => line.textContent)
          .join('\n');
      }

      return '';
    }

    getStoredSolution() {
      // This method will be enhanced by message passing to get user solution
      return '';
    }

    async handleSuccessfulSubmission() {
      try {
        DSAUtils.logDebug(PLATFORM, '🎯 SUCCESSFUL SUBMISSION - Starting GitHub push flow');

        // Get the solution code from the editor directly
        const solution = this.getCurrentCode();
        DSAUtils.logDebug(PLATFORM, 'Solution code length:', solution ? solution.length : 0);

        if (!this.currentProblem) {
          DSAUtils.logDebug(PLATFORM, 'No currentProblem, extracting...');
          await this.extractProblemInfo();
        }

        // FALLBACK: If extractProblemInfo still failed, build problem info inline
        if (!this.currentProblem) {
          DSAUtils.logDebug(PLATFORM, 'extractProblemInfo failed, using inline fallback...');

          // Extract title from document.title
          let title = document.title
            .replace(/\s*[\||\-]\s*CodeChef\s*$/i, '')
            .replace(/\s*Practice Coding Problem\s*$/i, '')
            .replace(/\s*Problem\s*$/i, '')
            .trim();

          // Fallback to URL path
          if (!title || title.length < 2) {
            const pathMatch = window.location.pathname.match(/problems\/([^\/\?]+)/);
            title = pathMatch ? pathMatch[1].replace(/-/g, ' ') : 'Unknown Problem';
          }

          DSAUtils.logDebug(PLATFORM, 'Inline title extraction:', title);

          // Extract difficulty from page
          let difficulty = this.getDifficulty() || 'Unknown';
          DSAUtils.logDebug(PLATFORM, 'Inline difficulty extraction:', difficulty);

          this.currentProblem = {
            title: title,
            description: '',
            difficulty: difficulty,
            tags: [],
            url: window.location.href.split('?')[0],
            language: this.getCurrentLanguage() || 'cpp',
            code: solution,
            companyTags: [],
            topicTags: [],
            topics: []
          };
        }

        DSAUtils.logDebug(PLATFORM, 'Problem title:', this.currentProblem?.title);

        if (!this.currentProblem) {
          DSAUtils.logError(PLATFORM, '❌ Could not extract problem information - aborting');
          return;
        }

        if (!solution) {
          DSAUtils.logError(PLATFORM, '❌ Could not extract solution code - aborting');
          return;
        }

        // Add the solution code to problem info
        this.currentProblem.code = solution;
        DSAUtils.logDebug(PLATFORM, 'Problem info with code:', this.currentProblem);

        // Add final successful attempt
        if (solution && solution.length > 10) {
          const successfulAttempt = {
            code: solution,
            language: this.currentProblem.language || 'Unknown',
            timestamp: new Date().toISOString(),
            type: 'submit',
            successful: true
          };
          this.attempts.push(successfulAttempt);
          DSAUtils.logDebug(PLATFORM, 'Added final successful submission attempt');
        }

        // Add attempts for mistake analysis
        const finalAttempts = [...this.attempts];
        const incorrectAttempts = finalAttempts.filter(a => !a.successful);
        DSAUtils.logDebug(PLATFORM, `Total attempts: ${finalAttempts.length}, Incorrect attempts: ${incorrectAttempts.length}`);

        const totalRunCounter = this.runCounter;
        const totalIncorrectRuns = this.incorrectRunCounter;

        this.currentProblem.attempts = finalAttempts;

        // Calculate total tries
        const totalTries = totalRunCounter + 1; // +1 for the successful submission

        // Step 0: Run Gemini analysis if flagged (before backend push)
        // Step 0: Run Gemini analysis if flagged (before backend push)
        if (this.shouldAnalyzeWithGemini) {
          DSAUtils.logDebug(PLATFORM, `Step 0: Running Gemini analysis before backend push...`);
          try {
            const geminiAPI = new GeminiAPI();
            const geminiConfigured = await geminiAPI.initialize();

            if (geminiConfigured) {
              // Send ALL attempts (not just failed) to Gemini for full context
              const allAttempts = this.attempts.filter(a => a.code && a.code.length > 10);
              DSAUtils.logDebug(PLATFORM, `Sending ${allAttempts.length} code iterations to Gemini`);

              if (this.submissionTracker) {
                this.submissionTracker.setAIStarted();
              }

              const geminiResult = await geminiAPI.analyzeMistakes(allAttempts, this.currentProblem);

              if (geminiResult.success) {
                this.aiAnalysis = geminiResult.analysis;
                this.aiTags = geminiResult.tags || [];
                DSAUtils.logDebug(PLATFORM, `Gemini analysis complete. Tags: ${this.aiTags.join(', ')}`);
                if (this.submissionTracker) {
                  this.submissionTracker.setAIComplete();
                }
              } else {
                DSAUtils.logDebug(PLATFORM, `Gemini analysis failed: ${geminiResult.error}`);
                if (this.submissionTracker) {
                  this.submissionTracker.setAISkipped();
                }
              }
            } else {
              DSAUtils.logDebug(PLATFORM, `Gemini API key not configured - skipping analysis`);
              if (this.submissionTracker) {
                this.submissionTracker.setAISkipped();
              }
            }
          } catch (error) {
            DSAUtils.logError(PLATFORM, `Gemini analysis error:`, error);
            if (this.submissionTracker) {
              this.submissionTracker.setAISkipped();
            }
            // Continue with submission even if Gemini fails
          }
        } else {
          if (this.submissionTracker) {
            this.submissionTracker.setAISkipped();
          }
        }

        // Store problem data with AI analysis (will be picked up by backend push)
        await this.storeProblemData(this.currentProblem, true, totalTries);
        DSAUtils.logDebug(PLATFORM, `Stored problem as solved with ${totalTries} tries`);

        // Step 1: Push to Backend API
        DSAUtils.logDebug(PLATFORM, `Step 1: Pushing to backend...`);
        try {
          if (this.submissionTracker) {
            this.submissionTracker.setBackendStarted();
          }

          if (!backendAPI) {
            DSAUtils.logDebug(PLATFORM, `Initializing BackendAPI...`);
            backendAPI = new BackendAPI();
            await backendAPI.initialize();
          }

          const currentUrl = this.getCurrentProblemUrl();
          DSAUtils.logDebug(PLATFORM, `Current problem URL: ${currentUrl}`);

          const backendResult = await backendAPI.pushCurrentProblemData(currentUrl);

          if (backendResult.success) {
            DSAUtils.logDebug(PLATFORM, `Backend push successful!`, backendResult.data);
            if (this.submissionTracker) {
              const message = backendResult.data?.message || 'Solution synced to Traverse!';
              this.submissionTracker.succeed(message);
              this.submissionTracker = null;
            }
          } else {
            DSAUtils.logDebug(PLATFORM, `Backend push failed: ${backendResult.error}`);
            if (this.submissionTracker) {
              this.submissionTracker.fail(`Sync failed: ${backendResult.error}`);
              this.submissionTracker = null;
            }
            // Preserve state for retry
            DSAUtils.logDebug(PLATFORM, `Backend push did not succeed - preserving state for retry`);
            return;
          }
        } catch (error) {
          DSAUtils.logError(PLATFORM, `Backend push error:`, error);
          if (this.submissionTracker) {
            this.submissionTracker.fail(`Sync error: ${error.message}`);
            this.submissionTracker = null;
          }
          // Preserve state for retry
          DSAUtils.logDebug(PLATFORM, `Backend push did not succeed - preserving state for retry`);
          return;
        }

        // Step 2: Check if GitHub push is enabled
        const githubSettings = await chrome.storage.sync.get(['github_push_enabled']);
        const githubPushEnabled = githubSettings.github_push_enabled !== false; // Default to true

        if (githubPushEnabled) {
          // Step 2: Push to GitHub
          DSAUtils.logDebug(PLATFORM, 'Step 2: Pushing to GitHub...');
          const result = await githubAPI.pushSolution(this.currentProblem, PLATFORM);
          DSAUtils.logDebug(PLATFORM, 'GitHub push result:', result);

          if (result.success) {
            DSAUtils.logDebug(PLATFORM, '✅ Solution pushed to GitHub successfully!');
            DSAUtils.logDebug(PLATFORM, `Solution pushed to GitHub successfully!`);
          } else {
            DSAUtils.logError(PLATFORM, 'Push failed:', result.error);
            DSAUtils.logDebug(PLATFORM, `Failed to push solution:`, result.error);
          }
        } else {
          DSAUtils.logDebug(PLATFORM, `GitHub push disabled by user - skipping`);
        }

        // Reset counters after successful backend submission
        this.runCounter = 0;
        this.incorrectRunCounter = 0;
        this.attempts = [];
        this.hasAnalyzedMistakes = false;
        this.shouldAnalyzeWithGemini = false;
        this.aiAnalysis = null;
        this.aiTags = [];

        // Persist final state
        await this.savePersistedState({
          attempts: finalAttempts,
          runCounter: 0,
          incorrectRunCounter: 0,
          hasAnalyzedMistakes: false,
          shouldAnalyzeWithGemini: false,
          aiAnalysis: null,
          aiTags: []
        });

      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error handling submission', error);
      }
    }

    async getUserSolution() {
      return new Promise((resolve) => {
        DSAUtils.logDebug(PLATFORM, 'Sending message to background script for solution...');

        // Send message to background script to extract solution
        chrome.runtime.sendMessage({
          type: 'getUserSolution',
          platform: PLATFORM
        }, (response) => {
          DSAUtils.logDebug(PLATFORM, 'Background script response:', response);

          if (chrome.runtime.lastError) {
            DSAUtils.logError(PLATFORM, 'Chrome runtime error:', chrome.runtime.lastError);
            resolve('');
            return;
          }

          if (response && response.solution) {
            DSAUtils.logDebug(PLATFORM, 'Solution from background script:', response.solution.substring(0, 100) + '...');
            resolve(response.solution);
          } else {
            DSAUtils.logError(PLATFORM, 'No solution in response');
            resolve('');
          }
        });
      });
    }

    debugAvailableElements() {
      DSAUtils.logDebug(PLATFORM, 'Debugging available elements on page...');

      // Log all h1, h2, h3 elements
      const headers = document.querySelectorAll('h1, h2, h3');
      DSAUtils.logDebug(PLATFORM, `Found ${headers.length} header elements:`);
      headers.forEach((h, i) => {
        DSAUtils.logDebug(PLATFORM, `Header ${i}: ${h.tagName} - "${h.textContent.trim()}"`);
      });

      // Log elements with class containing "title"
      const titleElements = document.querySelectorAll('[class*="title"]');
      DSAUtils.logDebug(PLATFORM, `Found ${titleElements.length} elements with "title" in class:`);
      titleElements.forEach((el, i) => {
        DSAUtils.logDebug(PLATFORM, `Title element ${i}: ${el.className} - "${el.textContent.trim()}"`);
      });

      // Log elements with class containing "problem"
      const problemElements = document.querySelectorAll('[class*="problem"]');
      DSAUtils.logDebug(PLATFORM, `Found ${problemElements.length} elements with "problem" in class:`);
      problemElements.forEach((el, i) => {
        DSAUtils.logDebug(PLATFORM, `Problem element ${i}: ${el.className}`);
      });

      // Log current URL and page structure
      DSAUtils.logDebug(PLATFORM, `Current URL: ${window.location.href}`);
      DSAUtils.logDebug(PLATFORM, `Page title: ${document.title}`);
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeCodeChef);
  } else {
    initializeCodeChef();
  }

  async function initializeCodeChef() {
    // Wait for required utilities to be available
    if (typeof DSAUtils === 'undefined' || typeof GitHubAPI === 'undefined') {
      setTimeout(initializeCodeChef, 500);
      return;
    }

    // Use singleton pattern to maintain state across page changes
    if (!extractorInstance) {
      extractorInstance = new CodeChefExtractor();
      DSAUtils.logDebug(PLATFORM, `Created new extractor instance`);
    } else {
      DSAUtils.logDebug(PLATFORM, `Reusing existing extractor instance`);
    }

    await extractorInstance.initialize();
  }

})();
