// Naukri Code360 content script for DSA to GitHub extension

(function () {
  'use strict';

  const PLATFORM = DSA_PLATFORMS.NAUKRI;
  let githubAPI = null;
  let backendAPI = null;
  let isInitialized = false;
  let submissionInProgress = false;

  const LANGUAGE_MAP = {
    'C++': 'cpp',
    'cpp': 'cpp',
    'C': 'c',
    'Java': 'java',
    'Python': 'py',
    'Python3': 'py',
    'python': 'py',
    'JavaScript': 'js',
    'Javascript': 'js',
    'TypeScript': 'ts'
  };

  class NaukriExtractor {
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
      this.cognitiveTier = null;
      this.recallScore = null;
      this.topics = [];
      this.currentProblemUrl = null;
    }

    async initialize() {
      try {
        DSAUtils.logDebug(PLATFORM, 'Initializing Naukri Code360 extractor...');
        await this.loadPersistedState();

        githubAPI = new GitHubAPI();
        await githubAPI.initialize();

        backendAPI = new BackendAPI();
        await backendAPI.initialize();

        this.setupEventListeners();
        this.checkPageType();

        const currentUrl = this.getCurrentProblemUrl();
        if (this.currentProblemUrl !== currentUrl) {
          DSAUtils.logDebug(PLATFORM, 'Problem changed - resetting counters');
          this.resetCounters();
          this.currentProblemUrl = currentUrl;
          await this.savePersistedState();
        }

        DSAUtils.logDebug(PLATFORM, '✅ Naukri Code360 extractor fully initialized');
        isInitialized = true;
      } catch (error) {
        DSAUtils.logError(PLATFORM, '❌ Failed to initialize:', error);
      }
    }

    async loadPersistedState() {
      try {
        const currentUrl = this.getCurrentProblemUrl();
        const result = await chrome.storage.local.get([`problem_data_${currentUrl}`]);
        const problemData = result[`problem_data_${currentUrl}`];

        if (problemData) {
          DSAUtils.logDebug(PLATFORM, 'Loaded problem data:', problemData);
          this.attempts = problemData.attempts || [];
          this.runCounter = problemData.runCounter || 0;
          this.incorrectRunCounter = problemData.incorrectRunCounter || 0;
          this.hasAnalyzedMistakes = problemData.hasAnalyzedMistakes || false;
          this.shouldAnalyzeWithGemini = problemData.shouldAnalyzeWithGemini || false;
          this.aiAnalysis = problemData.aiAnalysis || null;
          this.aiTags = problemData.aiTags || [];
          this.cognitiveTier = problemData.cognitiveTier ?? null;
          this.recallScore = problemData.recallScore ?? null;
          this.currentProblemUrl = problemData.currentProblemUrl || currentUrl;
          this.topics = problemData.parent_topic || [];
        } else {
          DSAUtils.logDebug(PLATFORM, 'No problem data found - starting fresh');
          this.topics = [];
        }
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error loading problem data:', error);
      }
    }

    async savePersistedState(overrides = {}) {
      try {
        const currentUrl = this.getCurrentProblemUrl();
        const result = await chrome.storage.local.get([`problem_data_${currentUrl}`]);
        let problemData = result[`problem_data_${currentUrl}`] || {};

        const timer = window.ProblemTimer ? window.ProblemTimer.getInstance() : null;

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
          cognitiveTier: overrides.cognitiveTier ?? this.cognitiveTier,
          recallScore: overrides.recallScore ?? this.recallScore,
          currentProblemUrl: overrides.currentProblemUrl ?? this.currentProblemUrl,
          parent_topic: overrides.parent_topic ?? this.topics,
          problemStartTime: timer?.getStartTime() || problemData.problemStartTime || Date.now(),
          pausedTime: timer?.getPausedTime() || problemData.pausedTime || 0,
          timestamp: overrides.timestamp ?? new Date().toISOString()
        };

        await chrome.storage.local.set({ [`problem_data_${currentUrl}`]: problemData });
        DSAUtils.logDebug(PLATFORM, `Saved problem data for: ${currentUrl}`);
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error saving problem data:', error);
      }
    }

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
          solvedData = {
            value: true,
            date: Date.now(),
            tries: triesValue
          };
        } else if (previousSolved.value) {
          solvedData = previousSolved;
        } else {
          solvedData = {
            value: false,
            date: 0,
            tries: triesValue
          };
        }

        const timer = window.ProblemTimer ? window.ProblemTimer.getInstance() : null;

        const problemData = {
          ...existingData,
          name: problemInfo.title || existingData.name || 'Unknown Problem',
          platform: 'naukri',
          difficulty: this.normalizeDifficulty(problemInfo.difficulty),
          solved: solvedData,
          ignored: existingData.ignored ?? false,
          parent_topic: problemInfo.topics || problemInfo.topicTags || existingData.parent_topic || ['General'],
          problem_link: problemInfo.url || existingData.problem_link || window.location.href.split('?')[0],
          code: problemInfo.code || existingData.code || '',
          language: problemInfo.language || existingData.language || 'cpp',

          attempts: this.attempts || [],
          runCounter: this.runCounter || 0,
          incorrectRunCounter: this.incorrectRunCounter || 0,
          hasAnalyzedMistakes: this.hasAnalyzedMistakes || false,
          shouldAnalyzeWithGemini: this.shouldAnalyzeWithGemini || false,
          aiAnalysis: this.aiAnalysis || null,
          aiTags: this.aiTags || [],
          cognitiveTier: this.cognitiveTier ?? null,
          recallScore: this.recallScore ?? null,
          currentProblemUrl: this.currentProblemUrl || currentUrl,
          problemStartTime: timer?.getStartTime() || existingData.problemStartTime || Date.now(),
          pausedTime: timer?.getPausedTime() || existingData.pausedTime || 0,
          timestamp: new Date().toISOString()
        };

        await chrome.storage.local.set({ [storageKey]: problemData });
        DSAUtils.logDebug(PLATFORM, 'Stored problem data:', problemData);
        return problemData;
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error storing problem data:', error);
      }
    }

    normalizeDifficulty(difficulty) {
      if (!difficulty) return 0;
      const diff = String(difficulty).toLowerCase();
      if (diff.includes('easy') || diff.includes('basic')) return 0;
      if (diff.includes('medium') || diff.includes('moderate')) return 1;
      if (diff.includes('hard') || diff.includes('ninja')) return 2;
      return 0;
    }

    getCurrentProblemUrl() {
      const url = window.location.href;
      const match = url.match(/(?:problem-details|problems)\/([^\/\?#]+)/);
      return match ? match[1] : window.location.pathname.split('/').pop() || 'unknown';
    }

    isProblemPage() {
      const url = window.location.href;
      return url.includes('naukri.com/code360') &&
        (url.includes('/problem-details/') || url.includes('/problems/'));
    }

    checkPageType() {
      if (this.isProblemPage()) {
        const currentUrl = this.getCurrentProblemUrl();
        if (window.ProblemTimer && currentUrl) {
          window.ProblemTimer.getInstance().startTimer(currentUrl);
        }
        setTimeout(() => this.extractProblemInfo(), 1500);
      } else {
        if (window.ProblemTimer) {
          window.ProblemTimer.getInstance().hideOverlay();
        }
      }
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
      DSAUtils.logDebug(PLATFORM, 'Counters reset for new problem');

      const currentUrl = this.getCurrentProblemUrl();
      chrome.storage.local.remove([`problem_data_${currentUrl}`]).catch(e => DSAUtils.logError(PLATFORM, e));
    }

    setupEventListeners() {
      this.observeUrlChanges();
      this.monitorSubmissions();
      this.observeRunButton();
    }

    observeUrlChanges() {
      let currentUrl = location.href;

      new MutationObserver(() => {
        if (location.href !== currentUrl) {
          currentUrl = location.href;
          if (window.ProblemTimer) {
            if (this.isProblemPage()) {
              window.ProblemTimer.getInstance().reset();
              window.ProblemTimer.getInstance().startTimer(this.getCurrentProblemUrl());
            } else {
              window.ProblemTimer.getInstance().hideOverlay();
            }
          }
          setTimeout(() => {
            this.checkPageType();
            this.extractProblemInfo();
          }, 1000);
        }
      }).observe(document, { subtree: true, childList: true });
    }

    extractProblemInfo() {
      try {
        const titleEl = document.querySelector('h1, .problem-title, [class*="problem-title"], [class*="ProblemTitle"], [class*="title"]');
        let title = titleEl ? titleEl.textContent.trim() : '';
        if (!title) {
          title = document.title.replace(/[-|].*Code360.*/i, '').replace(/Coding Ninjas.*/i, '').trim();
        }

        const diffEl = document.querySelector('[class*="difficulty"], [class*="Difficulty"], .badge');
        let difficulty = diffEl ? diffEl.textContent.trim() : 'Easy';

        const topicEls = document.querySelectorAll('[class*="topic"], [class*="tag"], [class*="category"]');
        let topics = Array.from(topicEls).map(el => el.textContent.trim()).filter(Boolean);
        if (topics.length === 0) topics = ['General'];
        this.topics = topics;

        const code = this.getCurrentCode();
        const language = this.getCurrentLanguage();

        const problemInfo = {
          title,
          difficulty,
          topics,
          code,
          language,
          url: window.location.href.split('?')[0]
        };

        this.currentProblem = problemInfo;
        this.storeProblemData(problemInfo, false);
        return problemInfo;
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error extracting problem info:', error);
      }
    }

    getCurrentCode() {
      try {
        if (window.monaco && window.monaco.editor) {
          const models = window.monaco.editor.getModels();
          if (models && models.length > 0) {
            return models[0].getValue();
          }
        }

        const viewLines = document.querySelectorAll('.view-line');
        if (viewLines.length > 0) {
          return Array.from(viewLines).map(line => line.textContent).join('\n');
        }

        const textarea = document.querySelector('.monaco-editor textarea, textarea.inputarea, textarea');
        if (textarea && textarea.value) {
          return textarea.value;
        }

        return '';
      } catch (e) {
        DSAUtils.logError(PLATFORM, 'Error getting current code:', e);
        return '';
      }
    }

    getCurrentLanguage() {
      try {
        const langEl = document.querySelector('[class*="language"], [class*="Language"], select, button[class*="select"]');
        const langText = langEl ? langEl.textContent.trim() : 'cpp';
        return LANGUAGE_MAP[langText] || 'cpp';
      } catch (e) {
        return 'cpp';
      }
    }

    observeRunButton() {
      const attachRunListener = () => {
        const runBtns = Array.from(document.querySelectorAll('button')).filter(btn => {
          const txt = btn.textContent.toLowerCase();
          return (txt.includes('run') || txt.includes('test')) && !txt.includes('submit');
        });

        for (const runBtn of runBtns) {
          if (!runBtn.hasAttribute('data-dsa-listener')) {
            runBtn.setAttribute('data-dsa-listener', 'true');
            runBtn.addEventListener('click', () => {
              setTimeout(() => this.handleRunAttempt(), 1000);
            });
          }
        }
      };

      attachRunListener();
      setInterval(attachRunListener, 5000);
    }

    async handleRunAttempt() {
      try {
        this.runCounter++;
        DSAUtils.logDebug(PLATFORM, `Run attempt #${this.runCounter}`);

        const code = this.getCurrentCode();
        const language = this.getCurrentLanguage();

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
          await this.savePersistedState();
          await this.observeRunResult(attempt);
        }
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error handling run attempt:', error);
      }
    }

    async observeRunResult(attempt) {
      let checks = 0;
      const interval = setInterval(async () => {
        checks++;
        const pageText = document.body.innerText.toLowerCase();

        if (pageText.includes('all test cases passed') || pageText.includes('sample test cases passed') || pageText.includes('accepted')) {
          clearInterval(interval);
          if (attempt.successful !== true) {
            attempt.successful = true;
            DSAUtils.logDebug(PLATFORM, `Run #${attempt.runNumber} - SUCCESS`);
            await this.savePersistedState();
          }
        } else if (pageText.includes('wrong answer') || pageText.includes('compilation error') || pageText.includes('time limit exceeded') || pageText.includes('runtime error') || pageText.includes('failed')) {
          clearInterval(interval);
          if (attempt.successful !== false) {
            attempt.successful = false;
            this.incorrectRunCounter++;
            DSAUtils.logDebug(PLATFORM, `Run #${attempt.runNumber} - FAILED (${this.incorrectRunCounter}/3)`);
            await this.savePersistedState();

            if (this.incorrectRunCounter >= 2 && !this.hasAnalyzedMistakes) {
              this.handleThreeIncorrectRuns();
            }
          }
        } else if (checks > 20) {
          clearInterval(interval);
        }
      }, 1000);
    }

    async handleThreeIncorrectRuns() {
      try {
        DSAUtils.logDebug(PLATFORM, 'Triggering Gemini mistake analysis...');
        this.hasAnalyzedMistakes = true;
        this.shouldAnalyzeWithGemini = true;

        // AI analysis now happens server-side after submission
        if (this.submissionTracker) {
            this.submissionTracker.setAISkipped();
        }
        await this.savePersistedState();
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error during Gemini mistake analysis:', error);
      }
    }

    monitorSubmissions() {
      const attachSubmitListener = () => {
        const submitBtns = Array.from(document.querySelectorAll('button')).filter(btn => {
          return btn.textContent.toLowerCase().includes('submit');
        });

        for (const submitBtn of submitBtns) {
          if (!submitBtn.hasAttribute('data-dsa-listener')) {
            submitBtn.setAttribute('data-dsa-listener', 'true');
            submitBtn.addEventListener('click', () => {
              if (!submissionInProgress) {
                this.handleSubmissionAttempt();
              }
            });
          }
        }
      };

      attachSubmitListener();
      setInterval(attachSubmitListener, 5000);
    }

    async handleSubmissionAttempt() {
      submissionInProgress = true;
      let toastTracker = null;
      if (window.LeetFeedbackToast) {
        toastTracker = window.LeetFeedbackToast.createSubmission();
      }

      try {
        const problemInfo = this.extractProblemInfo();
        const code = this.getCurrentCode();
        const language = this.getCurrentLanguage();

        let checks = 0;
        const checkResult = setInterval(async () => {
          checks++;
          const pageText = document.body.innerText.toLowerCase();

          if (pageText.includes('all test cases passed') || pageText.includes('accepted') || pageText.includes('correct answer')) {
            clearInterval(checkResult);
            submissionInProgress = false;

            if (toastTracker) toastTracker.success('Accepted');
            await this.handleSuccessfulSubmission(problemInfo, code, language);
          } else if (pageText.includes('wrong answer') || pageText.includes('compilation error') || pageText.includes('time limit exceeded') || pageText.includes('runtime error')) {
            clearInterval(checkResult);
            submissionInProgress = false;

            if (toastTracker) toastTracker.fail('Wrong Answer');
            await this.storeProblemData(problemInfo, false);
          } else if (checks > 30) {
            clearInterval(checkResult);
            submissionInProgress = false;
          }
        }, 1000);
      } catch (error) {
        submissionInProgress = false;
        DSAUtils.logError(PLATFORM, 'Error handling submission:', error);
      }
    }

    async handleSuccessfulSubmission(problemInfo, code, language) {
      try {
        const storedData = await this.storeProblemData({
          ...problemInfo,
          code,
          language
        }, true);

        if (backendAPI) {
          await backendAPI.pushProblemData(storedData);
        }

        if (githubAPI && githubAPI.isConfigured()) {
          const formattedTitle = DSAUtils.formatProblemName(problemInfo.title);
          const dirPath = `naukri/${problemInfo.difficulty.toLowerCase()}/${formattedTitle}`;
          const ext = DSAUtils.getFileExtension(language);
          const filePath = `${dirPath}/solution${ext}`;
          const commitMsg = DSAUtils.generateCommitMessage('naukri', {
            title: problemInfo.title,
            difficulty: problemInfo.difficulty
          });

          await githubAPI.pushSolution(filePath, code, commitMsg);
        }

        DSAUtils.logDebug(PLATFORM, '✅ Successfully processed solved problem');
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error handling successful submission:', error);
      }
    }
  }

  // Instantiate singleton and initialize
  const extractor = new NaukriExtractor();
  window.NaukriExtractorInstance = extractor;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => extractor.initialize());
  } else {
    extractor.initialize();
  }
})();
