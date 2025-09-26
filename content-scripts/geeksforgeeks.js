// GeeksforGeeks content script for DSA to GitHub extension

(function () {
  'use strict';

  const PLATFORM = DSA_PLATFORMS.GEEKSFORGEEKS;
  let githubAPI = null;
  let isInitialized = false;
  let submissionInProgress = false;
  let extractorInstance = null; // Global singleton instance

  // GeeksforGeeks specific selectors
  const SELECTORS = {
    problemTitle: 'h1, h2, h3, .problems_header_content__title h3, [class*="problems_header_content__title"] h3, .problem-title, [class*="title"], [class*="header"] h1, [class*="header"] h2, [class*="header"] h3',
    problemDescription: '[class*="problems_problem_content"], .problem-description, [class*="problem_content"], .problem-statement, [class*="description"], [class*="statement"], .content, main',
    difficulty: '[class*="problems_header_description"] span:first-child, .difficulty-tag, .difficulty, [class*="difficulty"], [class*="level"], span[class*="tag"]',
    submitButton: '.ui.button.problems_submit_button__6QoNQ, [class*="ui button problems_submit_button"], .submit-button, button[class*="submit"], [class*="submit"], input[type="submit"]',
    submissionResult: '[class*="problems_content"], .submission-result, .result, [class*="result"], [class*="status"], [class*="verdict"]',
    languageSelector: 'div.problems_language_dropdown__DgjFb .menu [role="option"].active.selected',
    codeEditor: '.ace_content, .CodeMirror-code, .monaco-editor, .ace_editor, [class*="editor"], textarea, [class*="code"], .ace_text-input',
    companyTags: '.problems_tag_container__kWANg:contains("Company Tags") + .content, [class*="company"] [class*="tag"], [class*="tag"][class*="company"]',
    topicTags: '.problems_tag_container__kWANg:contains("Topic Tags") + .content, [class*="topic"] [class*="tag"], [class*="tag"][class*="topic"]'
  };

  // Language mappings for GeeksforGeeks
  const GFG_LANGUAGES = {
    'C': '.c',
    'C++': '.cpp',
    'Java': '.java',
    'Python': '.py',
    'Python3': '.py',
    'JavaScript': '.js',
    'Javascript': '.js',
    'C#': '.cs'
  };

  class GeeksforGeeksExtractor {
    constructor() {
      this.currentProblem = null;
      this.currentSolution = null;
      this.isSubmissionInProgress = false;
      this.attempts = [];
      this.runCounter = 0;
      this.incorrectRunCounter = 0;
      this.hasAnalyzedMistakes = false;
      this.topics = [];
      this.currentProblemUrl = null;
    }

    async initialize() {
      try {
        // Load persisted state from Chrome storage
        await this.loadPersistedState();

        githubAPI = new GitHubAPI();
        await githubAPI.initialize();
        this.setupEventListeners();
        this.checkPageType();

        // Detect if we've changed problems - reset counters if so
        const currentUrl = this.getCurrentProblemUrl();
        if (this.currentProblemUrl !== currentUrl) {
          console.log(`🔄 [GeeksforGeeks Run Counter] Problem changed - resetting counters`);
          this.resetCounters();
          this.currentProblemUrl = currentUrl;
          await this.savePersistedState();
        }

        DSAUtils.logDebug(PLATFORM, 'GeeksforGeeks extractor initialized');
        isInitialized = true;
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Failed to initialize', error);
      }
    }

    // Persistence methods to maintain state across page reloads
    async loadPersistedState() {
      try {
        const currentUrl = this.getCurrentProblemUrl();
        const result = await chrome.storage.local.get([`problem_data_${currentUrl}`]);
        const problemData = result[`problem_data_${currentUrl}`];

        if (problemData) {
          console.log(`📥 [GeeksforGeeks] Loaded problem data:`, problemData);
          
          // Extract tracking info from problem data if available
          this.attempts = problemData.attempts || [];
          this.runCounter = problemData.runCounter || 0;
          this.incorrectRunCounter = problemData.incorrectRunCounter || 0;
          this.hasAnalyzedMistakes = problemData.hasAnalyzedMistakes || false;
          this.currentProblemUrl = problemData.currentProblemUrl || currentUrl;
          this.topics = problemData.parent_topic || [];

          console.log(`🔢 [GeeksforGeeks] Restored - Runs: ${this.runCounter}, Failed: ${this.incorrectRunCounter}/3, Analyzed: ${this.hasAnalyzedMistakes}, Topics: ${this.topics.length}`);
        } else {
          console.log(`🆕 [GeeksforGeeks] No problem data found - starting fresh`);
          this.topics = [];
        }
      } catch (error) {
        console.error('[GeeksforGeeks] Error loading problem data:', error);
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
          timestamp: overrides.timestamp ?? new Date().toISOString()
        };

        await chrome.storage.local.set({ [`problem_data_${currentUrl}`]: problemData });
        console.log(`💾 [GeeksforGeeks] Saved problem data for: ${currentUrl}`);
      } catch (error) {
        console.error('[GeeksforGeeks] Error saving problem data:', error);
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
          platform: 'geeksforgeeks',
          difficulty: this.normalizeDifficulty(problemInfo.difficulty),
          solved: solvedData,
          ignored: existingData.ignored ?? false,
          parent_topic: problemInfo.topics || problemInfo.topicTags || existingData.parent_topic || [],
          problem_link: problemInfo.url || existingData.problem_link || window.location.href.split('?')[0],
          
          // Include tracking state
          attempts: this.attempts || [],
          runCounter: this.runCounter || 0,
          incorrectRunCounter: this.incorrectRunCounter || 0,
          hasAnalyzedMistakes: this.hasAnalyzedMistakes || false,
          currentProblemUrl: this.currentProblemUrl || currentUrl,
          timestamp: new Date().toISOString()
        };

        await chrome.storage.local.set({ [storageKey]: problemData });
        console.log(`💾 [GeeksforGeeks] Stored problem data:`, problemData);
        return problemData;
      } catch (error) {
        console.error('[GeeksforGeeks] Error storing problem data:', error);
      }
    }

    normalizeDifficulty(difficulty) {
      if (!difficulty) return 1; // Default to Easy
      const diff = difficulty.toLowerCase();
      if (diff.includes('school')) return 0; // School
      if (diff.includes('basic') || diff.includes('easy')) return 1; // Easy
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
      this.topics = [];
      console.log(`🔄 [GeeksforGeeks] Counters reset for new problem`);

      // Clean up any stored problem data for this problem
      const currentUrl = this.getCurrentProblemUrl();
      chrome.storage.local.remove([`problem_data_${currentUrl}`]).catch(console.error);
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
        (url.includes('geeksforgeeks.org') || url.includes('practice.geeksforgeeks.org'))) {
        setTimeout(() => this.extractProblemInfo(), 1500);
      }
    }

    monitorSubmissions() {
      const observer = new MutationObserver(() => {
        if (!submissionInProgress) {
          this.attachSubmitButtonListener();
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      // Initial attachment
      this.attachSubmitButtonListener();
    }

    observeRunButton() {
      let runButtonFound = false;

      // Monitor for run button clicks
      const checkForRunButton = () => {
        // Use the working selector for GeeksforGeeks run button
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
        console.log(`🏃‍♂️ [GeeksforGeeks Run Counter] Run attempt #${this.runCounter}`);

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
          console.log(`📝 [GeeksforGeeks Run Counter] Stored run attempt #${this.runCounter}`);

          // Save state after adding attempt
          await this.savePersistedState();

          // Start observing for run results
          await this.observeRunResult(attempt);

        } else {
          console.log(`❌ [GeeksforGeeks Run Counter] Run #${this.runCounter} - Code too short or empty`);
        }
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error storing run attempt', error);
      }
    }

    async observeRunResult(attempt) {
      // Look for run results to determine if the run was successful
      const checkRunResult = async () => {
        // GeeksforGeeks specific selectors for run results
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
                console.log(`✅ [GeeksforGeeks Run Counter] Run #${attempt.runNumber} - SUCCESS (Expected output matched)`);

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
                console.log(`❌ [GeeksforGeeks Run Counter] Run #${attempt.runNumber} - FAILED (Incorrect output)`);
                console.log(`🔢 [GeeksforGeeks Run Counter] Total failed runs: ${this.incorrectRunCounter}/3`);

                // Save state after failed attempt
                await this.savePersistedState();

                // Check if we've reached 3 failed runs
                if (this.incorrectRunCounter >= 3 && !this.hasAnalyzedMistakes) {
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
            console.log(`⏰ [GeeksforGeeks Run Counter] Run #${attempt.runNumber} - TIMEOUT → Counted as FAILED (safety measure)`);
            console.log(`🔢 [GeeksforGeeks Run Counter] Total failed runs: ${this.incorrectRunCounter}/3`);

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
      try {
        console.log(`🚨 [GeeksforGeeks Run Counter] 3 INCORRECT RUNS DETECTED - Triggering Gemini mistake analysis`);
        this.hasAnalyzedMistakes = true;

        // Save state immediately after setting analysis flag
        await this.savePersistedState();

        // Get the failed attempts (should be exactly 3 by now)
        const failedAttempts = this.attempts.filter(a => a.successful === false);
        console.log(`🔍 [GeeksforGeeks Run Counter] Analyzing ${failedAttempts.length} failed attempts`);

        // Ensure we have at least 3 failed attempts
        if (failedAttempts.length < 3) {
          console.log(`⚠️ [GeeksforGeeks Run Counter] Expected 3 failed attempts, found ${failedAttempts.length}. Counter: ${this.incorrectRunCounter}`);
          return;
        }

        // Get current problem info
        const problemInfo = await this.extractProblemInfo();
        if (!problemInfo) {
          console.log(`❌ [GeeksforGeeks Run Counter] Could not extract problem info for mistake analysis`);
          return;
        }

        // Add failed attempts to problem info
        problemInfo.attempts = failedAttempts;
        problemInfo.mistakeAnalysisOnly = true;

        console.log(`📤 [GeeksforGeeks Run Counter] Pushing mistake analysis to GitHub...`);

        // Initialize GitHub API
        if (!githubAPI) {
          githubAPI = new GitHubAPI();
          await githubAPI.initialize();
        }

        // Push mistake analysis to GitHub
        const result = await githubAPI.pushMistakeAnalysis(problemInfo, PLATFORM);

        if (result.success) {
          console.log(`✅ [GeeksforGeeks Run Counter] Mistake analysis pushed to GitHub successfully!`);
        } else {
          console.log(`❌ [GeeksforGeeks Run Counter] Failed to push mistake analysis:`, result.error);
        }

      } catch (error) {
        console.error('[GeeksforGeeks Run Counter] Error handling three incorrect runs:', error);
      }
    }

    attachSubmitButtonListener() {
      // Use the working selector for GeeksforGeeks submit button
      const submitButton = document.querySelector('button.problems_submit_button__6QoNQ');

      if (submitButton && !submitButton.hasAttribute('data-gfg-listener')) {
        submitButton.setAttribute('data-gfg-listener', 'true');
        DSAUtils.logDebug(PLATFORM, 'Submit button listener attached');

        submitButton.addEventListener('click', () => {
          DSAUtils.logDebug(PLATFORM, 'Submit button clicked!');
          this.handleSubmissionAttempt();
        });
      }
    }

    async handleSubmissionAttempt() {
      if (submissionInProgress) return;

      submissionInProgress = true;
      DSAUtils.logDebug(PLATFORM, 'Submission attempt detected');

      // Extract problem info before submission
      await this.extractProblemInfo();

      // Monitor for submission result
      this.monitorSubmissionResult();
    }

    monitorSubmissionResult() {
      DSAUtils.logDebug(PLATFORM, 'Starting submission result monitoring...');
      let checkCount = 0;

      const checkInterval = setInterval(() => {
        checkCount++;
        DSAUtils.logDebug(PLATFORM, `Checking for result... attempt ${checkCount}`);

        // Try multiple selectors for result
        const resultSelectors = [
          '[class*="problems_content"]',
          '.submission-result',
          '.result',
          '[class*="result"]',
          '[class*="status"]',
          '[class*="verdict"]',
          '.ui.message',
          '[class*="message"]'
        ];

        let resultElement = null;
        let resultText = '';

        for (const selector of resultSelectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent.trim()) {
            resultElement = element;
            resultText = element.textContent.trim();
            DSAUtils.logDebug(PLATFORM, `Found result with selector ${selector}: "${resultText}"`);
            break;
          }
        }

        if (resultElement && resultText) {
          DSAUtils.logDebug(PLATFORM, `Result text: "${resultText}"`);

          if (resultText.includes('Problem Solved Successfully') ||
            resultText.includes('Correct') ||
            resultText.includes('Accepted') ||
            resultText.includes('Success')) {
            DSAUtils.logDebug(PLATFORM, 'Successful submission detected!');
            clearInterval(checkInterval);
            submissionInProgress = false;
            this.handleSuccessfulSubmission();
          } else if (resultText.includes('Compilation Error') ||
            resultText.includes('Wrong Answer') ||
            resultText.includes('Time Limit Exceeded') ||
            resultText.includes('Runtime Error') ||
            resultText.includes('Failed')) {
            DSAUtils.logDebug(PLATFORM, 'Submission failed, not pushing to GitHub');
            clearInterval(checkInterval);
            submissionInProgress = false;
          }
        } else {
          DSAUtils.logDebug(PLATFORM, 'No result element found yet...');
        }
      }, 1000);

      // Stop monitoring after 30 seconds
      setTimeout(() => {
        DSAUtils.logDebug(PLATFORM, 'Stopping result monitoring after 30 seconds');
        clearInterval(checkInterval);
        submissionInProgress = false;
      }, 30000);
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
      DSAUtils.logDebug(PLATFORM, 'Trying to find problem title...');

      // Try multiple selectors
      const selectors = [
        'h1',
        'h2',
        'h3',
        '.problems_header_content__title h3',
        '[class*="problems_header_content__title"] h3',
        '.problem-title',
        '[class*="title"]',
        '[class*="header"] h1',
        '[class*="header"] h2',
        '[class*="header"] h3',
        '.ui.header',
        'header h1',
        'header h2',
        'header h3'
      ];

      for (let selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim()) {
          const title = element.textContent.trim();
          // Filter out obviously wrong titles
          if (title.length > 5 && !title.toLowerCase().includes('geeksforgeeks') && !title.toLowerCase().includes('menu')) {
            DSAUtils.logDebug(PLATFORM, `Found title with selector: ${selector}`, title);
            return title;
          }
        }
      }

      // Fallback: try document title
      const docTitle = document.title;
      if (docTitle && !docTitle.toLowerCase().includes('geeksforgeeks')) {
        const cleanTitle = docTitle.replace(/\s*-\s*GeeksforGeeks$/, '').trim();
        if (cleanTitle.length > 5) {
          DSAUtils.logDebug(PLATFORM, 'Using document title as fallback', cleanTitle);
          return cleanTitle;
        }
      }

      DSAUtils.logError(PLATFORM, 'No title element found with any selector');
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
      const difficultyElement = document.querySelector(SELECTORS.difficulty);
      if (!difficultyElement) return null;

      const text = difficultyElement.textContent.trim();

      // Normalize difficulty levels
      if (text.toLowerCase().includes('school')) return 'School';
      if (text.toLowerCase().includes('basic')) return 'Basic';
      if (text.toLowerCase().includes('easy')) return 'Easy';
      if (text.toLowerCase().includes('medium')) return 'Medium';
      if (text.toLowerCase().includes('hard')) return 'Hard';

      return text;
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
      const langElement = document.querySelector(SELECTORS.languageSelector);
      if (!langElement) return 'C++'; // Default

      const langText = langElement.textContent.trim();
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
        console.log(`🎉 [GeeksforGeeks Submission] SUCCESSFUL SUBMISSION DETECTED`);
        console.log(`📊 [GeeksforGeeks Stats] Total runs: ${this.runCounter}, Failed runs: ${this.incorrectRunCounter}`);

        DSAUtils.logDebug(PLATFORM, 'Handling successful submission');

        // Get the solution code via message to background script
        DSAUtils.logDebug(PLATFORM, 'Getting user solution...');
        const solution = await this.getUserSolution();
        DSAUtils.logDebug(PLATFORM, 'Solution retrieved:', solution ? `${solution.length} characters` : 'null');

        if (!this.currentProblem) {
          DSAUtils.logDebug(PLATFORM, 'No current problem, extracting...');
          await this.extractProblemInfo();
        }

        DSAUtils.logDebug(PLATFORM, 'Current problem:', this.currentProblem);
        DSAUtils.logDebug(PLATFORM, 'Solution length:', solution ? solution.length : 0);

        if (!this.currentProblem) {
          DSAUtils.logError(PLATFORM, 'Could not extract problem information');
          return;
        }

        if (!solution) {
          DSAUtils.logError(PLATFORM, 'Could not extract solution code');
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
        this.hasAnalyzedMistakes = false;

        this.currentProblem.attempts = finalAttempts;
        if (finalAttempts.length > 0) {
          DSAUtils.logDebug(PLATFORM, 'Attempts being sent to GitHub:', finalAttempts.map(a => ({
            language: a.language,
            type: a.type,
            successful: a.successful,
            codeLength: a.code?.length || 0,
            timestamp: a.timestamp,
            codePreview: a.code?.substring(0, 50) + '...'
          })));

          if (incorrectAttempts.length >= 3) {
            DSAUtils.logDebug(PLATFORM, `🔍 Mistake analysis will be triggered (${incorrectAttempts.length} incorrect attempts >= 3 threshold)`);
          } else {
            DSAUtils.logDebug(PLATFORM, `ℹ️ No mistake analysis (${incorrectAttempts.length} incorrect attempts < 3 threshold)`);
          }
        }

        // Push to GitHub using single solution.md file
        DSAUtils.logDebug(PLATFORM, 'Pushing to GitHub...');
        const result = await githubAPI.pushSolution(this.currentProblem, PLATFORM);
        DSAUtils.logDebug(PLATFORM, 'Push result:', result);

        if (result.success) {
          DSAUtils.logDebug(PLATFORM, 'Push successful!');
          console.log(`✅ [GeeksforGeeks Submission] Solution pushed to GitHub successfully!`);

          // Store problem data as solved
          const totalTries = totalRunCounter + 1; // +1 for the successful submission
          await this.storeProblemData(this.currentProblem, true, totalTries);

          // Reset counters after successful submission
          this.runCounter = 0;
          this.incorrectRunCounter = 0;
          this.attempts = [];

          // Persist final attempts and counters for history
          await this.savePersistedState({
            attempts: finalAttempts,
            runCounter: totalRunCounter,
            incorrectRunCounter: totalIncorrectRuns,
            hasAnalyzedMistakes: this.hasAnalyzedMistakes
          });
        } else {
          DSAUtils.logError(PLATFORM, 'Push failed:', result.error);
          console.log(`❌ [GeeksforGeeks Submission] Failed to push solution:`, result.error);
        }

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
    document.addEventListener('DOMContentLoaded', initializeGeeksforGeeks);
  } else {
    initializeGeeksforGeeks();
  }

  async function initializeGeeksforGeeks() {
    // Wait for required utilities to be available
    if (typeof DSAUtils === 'undefined' || typeof GitHubAPI === 'undefined') {
      setTimeout(initializeGeeksforGeeks, 500);
      return;
    }

    // Use singleton pattern to maintain state across page changes
    if (!extractorInstance) {
      extractorInstance = new GeeksforGeeksExtractor();
      console.log(`🆕 [GeeksforGeeks Run Counter] Created new extractor instance`);
    } else {
      console.log(`♻️ [GeeksforGeeks Run Counter] Reusing existing extractor instance`);
    }

    await extractorInstance.initialize();
  }

})();
