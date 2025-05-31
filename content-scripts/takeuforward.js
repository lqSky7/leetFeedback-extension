// TakeUforward content script for DSA to GitHub extension

(function() {
  'use strict';

  const PLATFORM = DSA_PLATFORMS.TAKEUFORWARD;
  let githubAPI = null;
  let isInitialized = false;
  let currentProblemSlug = '';
  let currentLanguage = '';
  let currentCode = '';

  // TakeUforward specific selectors
  const SELECTORS = {
    problemTitle: '.text-2xl.font-bold.text-new_primary.dark\\:text-new_dark_primary.relative',
    problemDescription: 'p.text-new_secondary',
    submitButton: 'button[data-tooltip-id="Submit"]',
    runButton: 'button[data-tooltip-id="Run"]',
    languageSelector: '.language-selector',
    codeEditor: '.monaco-editor, .ace_content',
    submissionResult: '.submission-result'
  };

  class TakeUforwardExtractor {
    constructor() {
      this.currentProblem = null;
      this.sessionStartTime = null;
      this.lastActivityTime = Date.now();
      this.currentPathname = window.location.pathname;
    }

    async initialize() {
      try {
        githubAPI = new GitHubAPI();
        await githubAPI.initialize();
        this.setupEventListeners();
        this.injectInterceptor();
        this.checkPageType();
        this.startTimeTracking();
        DSAUtils.logDebug(PLATFORM, 'TakeUforward extractor initialized');
        isInitialized = true;
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Failed to initialize', error);
      }
    }

    setupEventListeners() {
      // Listen for URL changes
      this.observeUrlChanges();
      
      // Listen for submission events via message passing
      this.setupMessageListener();
      
      // Track user activity
      this.setupActivityTracking();
      

    }

    observeUrlChanges() {
      const urlChangeDetector = setInterval(() => {
        if (this.currentPathname !== window.location.pathname) {
          DSAUtils.logDebug(PLATFORM, `Path changed from ${this.currentPathname} to ${window.location.pathname}`);
          this.currentPathname = window.location.pathname;

          setTimeout(() => {
            this.extractProblemInfo();
            this.fetchLatestCodeData();
          }, 2000);
        }
      }, 2000);

      // Clean up on page unload
      window.addEventListener('beforeunload', () => {
        clearInterval(urlChangeDetector);
        this.updateTimeTracking();
      });
    }

    setupMessageListener() {
      window.addEventListener('message', async (event) => {
        if (event.data.type === 'SUBMISSION_RESPONSE') {
          const submissionData = event.data.payload;
          DSAUtils.logDebug(PLATFORM, 'Submission response received', submissionData);
          
          if (submissionData.success === true) {
            await this.handleSuccessfulSubmission(submissionData);
          } else {
            DSAUtils.logDebug(PLATFORM, 'Submission was not successful, not pushing to GitHub');
          }
        }
      });
    }

    setupActivityTracking() {
      const handleUserActivity = () => {
        this.lastActivityTime = Date.now();
        if (!this.sessionStartTime) {
          this.startTimeTracking();
        }
      };

      document.addEventListener('click', handleUserActivity);
      document.addEventListener('keypress', handleUserActivity);
      document.addEventListener('scroll', handleUserActivity);
      document.addEventListener('mousemove', handleUserActivity);

      // Update time every 5 minutes if user is active
      setInterval(() => {
        const timeSinceLastActivity = Date.now() - this.lastActivityTime;
        if (timeSinceLastActivity < 300000) { // 5 minutes
          this.updateTimeTracking();
        }
      }, 300000);
    }

    startTimeTracking() {
      this.sessionStartTime = Date.now();
      chrome.storage.sync.set({ last_session_start: new Date().toISOString() });
      DSAUtils.logDebug(PLATFORM, 'Started tracking time on TakeUforward');
    }

    updateTimeTracking() {
      if (this.sessionStartTime) {
        const sessionDuration = Math.floor((Date.now() - this.sessionStartTime) / 60000); // in minutes
        chrome.storage.sync.get(['takeuforward_time'], (data) => {
          const currentTime = data.takeuforward_time || 0;
          const newTotalTime = currentTime + sessionDuration;
          chrome.storage.sync.set({ 
            takeuforward_time: newTotalTime,
            last_activity: new Date().toISOString()
          });
        });
        this.sessionStartTime = Date.now(); // Reset session start
      }
    }

    checkPageType() {
      const url = window.location.href;
      if (url.includes('takeuforward.org') && url.includes('/problems/')) {
        setTimeout(() => {
          this.extractProblemInfo();
          this.fetchLatestCodeData();
        }, 2000);
      }
    }

    async extractProblemInfo() {
      try {
        const problemInfo = {
          title: this.getProblemTitle(),
          description: this.getProblemDescription(),
          url: window.location.href.split('?')[0],
          language: currentLanguage || this.getCurrentLanguage(),
          code: currentCode || this.getCurrentCode(),
          slug: this.getProblemSlug()
        };

        // Validate required fields
        if (!problemInfo.title) {
          DSAUtils.logDebug(PLATFORM, 'Could not extract problem title');
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

    getProblemTitle() {
      const titleElement = document.querySelector(SELECTORS.problemTitle);
      return titleElement ? titleElement.textContent.trim() : null;
    }

    getProblemDescription() {
      const descElement = document.querySelector(SELECTORS.problemDescription);
      return descElement ? descElement.textContent.trim() : '';
    }

    getProblemSlug() {
      const urlParts = window.location.pathname.split('/');
      return urlParts[urlParts.length - 1] || '';
    }

    getCurrentLanguage() {
      // Try to get from stored data first
      if (currentLanguage) return currentLanguage;
      
      // Fallback to detecting from UI
      const langElements = document.querySelectorAll('[class*="language"]');
      for (let el of langElements) {
        const text = el.textContent.toLowerCase();
        if (text.includes('cpp') || text.includes('c++')) return 'cpp';
        if (text.includes('python')) return 'python';
        if (text.includes('java')) return 'java';
        if (text.includes('javascript')) return 'javascript';
      }
      
      return 'cpp'; // default
    }

    getCurrentCode() {
      // Try to get from stored data first
      if (currentCode) return currentCode;
      
      // Try to get from editor
      const codeElement = document.querySelector(SELECTORS.codeEditor);
      if (codeElement) {
        return this.extractCodeFromElement(codeElement);
      }
      
      return '';
    }

    extractCodeFromElement(element) {
      // For Monaco editor
      if (element.classList.contains('monaco-editor')) {
        const lines = element.querySelectorAll('.view-line');
        return Array.from(lines)
          .map(line => line.textContent)
          .join('\n');
      }

      // For ACE editor
      if (element.classList.contains('ace_content')) {
        const lines = element.querySelectorAll('.ace_line');
        return Array.from(lines)
          .map(line => line.textContent)
          .join('\n');
      }

      return '';
    }

    fetchLatestCodeData() {
      try {
        const storedData = localStorage.getItem('storedData');
        const parsedData = JSON.parse(storedData || '[]');

        if (parsedData.length > 0) {
          const latest = parsedData[parsedData.length - 1];
          currentProblemSlug = latest.problemSlug || '';
          currentLanguage = latest.selectedLanguage || '';
          currentCode = latest.publicCodeOfSelected || '';
          
          DSAUtils.logDebug(PLATFORM, 'Latest code data fetched for language:', currentLanguage);
        }
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error fetching code data', error);
      }
    }

    async handleSuccessfulSubmission(submissionData) {
      try {
        DSAUtils.logDebug(PLATFORM, 'Handling successful submission');
        
        // Re-fetch latest data
        this.extractProblemInfo();
        this.fetchLatestCodeData();

        if (!this.currentProblem) {
          DSAUtils.logError(PLATFORM, 'Could not extract problem information');
          return;
        }

        // Update problem info with latest code and submission stats
        this.currentProblem.code = currentCode;
        this.currentProblem.stats = {
          success: submissionData.success,
          totalTestCases: submissionData.totalTestCases,
          runtime: submissionData.averageTime,
          memory: submissionData.averageMemory
        };

        // Push to GitHub
        const result = await githubAPI.pushSolution(this.currentProblem, PLATFORM);
        
        if (result.success) {
          DSAUtils.logDebug(PLATFORM, 'Push successful!');
        } else {
          DSAUtils.logError(PLATFORM, 'Push failed:', result.error);
        }

      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Error handling submission', error);
      }
    }

    injectInterceptor() {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('utils/interceptor.js');
      (document.head || document.documentElement).appendChild(script);
      script.onload = () => script.remove();
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
    if (typeof DSAUtils === 'undefined' || typeof GitHubAPI === 'undefined') {
      setTimeout(initializeTakeUforward, 500);
      return;
    }

    const extractor = new TakeUforwardExtractor();
    await extractor.initialize();
  }

})();