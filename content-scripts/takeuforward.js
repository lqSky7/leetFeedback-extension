// TakeUforward content script for DSA to GitHub extension

(function() {
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
      this.problemStartTime = null;
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
        this.startTimeTracking();
        this.pollForQuestionDetails();
        
        DSAUtils.logDebug(PLATFORM, 'TakeUforward extractor initialized');
        console.log('✅ [TakeUforward] Extension fully initialized');
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
          
          // Reset tries on problem change
          TRIES = 0;
          this.problemStartTime = Date.now();
          
          setTimeout(() => {
            this.fetchQuestionDetails();
          }, 4000);
        }
      }, 4000);

      // Clean up on page unload
      window.addEventListener('beforeunload', () => {
        clearInterval(urlChangeDetector);
        this.updateTimeTracking();
      });
    }

    setupMessageListener() {
      window.addEventListener('message', async (event) => {
        // CODE_SUBMIT: Capture code when user submits
        if (event.data.type === 'CODE_SUBMIT') {
          const submitData = event.data.payload;
          console.log('📝 [TakeUforward] Captured code submission:', submitData);
          
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
          
          console.log('💾 [TakeUforward] Stored code data:', {
            language: SELECTED_LANGUAGE,
            codeLength: PUBLIC_CODE.length,
            problemSlug: PROBLEM_SLUG
          });
          
          TRIES++;
          console.log('🔢 [TakeUforward] Tries now:', TRIES);
        }
        
        // CODE_RUN: Track run attempts
        else if (event.data.type === 'CODE_RUN') {
          console.log('🏃 [TakeUforward] Run button clicked');
        }
        
        // SUBMISSION_RESPONSE: Handle submission results
        else if (event.data.type === 'SUBMISSION_RESPONSE') {
          const submissionData = event.data.payload;
          console.log('📊 [TakeUforward] Received submission response:', submissionData);
          
          if (submissionData.success === true) {
            console.log('✅ [TakeUforward] Submission successful! Processing...');
            await this.handleSuccessfulSubmission(submissionData);
          } else {
            console.log('❌ [TakeUforward] Submission was not successful. Status:', submissionData.status);
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
      this.problemStartTime = Date.now();
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

    pollForQuestionDetails() {
      const pollInterval = setInterval(() => {
        console.log('🔍 [TakeUforward] Polling for question details...');
        this.fetchQuestionDetails();
        
        if (QUES && DESCRIPTION) {
          console.log('✅ [TakeUforward] Question details found, stopping poll');
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
        console.log('✅ [TakeUforward] Question details fetched:', QUES);
      } else {
        console.log('⚠️ [TakeUforward] Question elements not found:', { 
          hasHeading: !!headingElem, 
          hasParagraph: !!paragraphElem 
        });
      }

      // Extract difficulty
      const difficultyElement = document.querySelector('[class*="difficulty"], [class*="Difficulty"]');
      DIFFICULTY = difficultyElement?.textContent?.trim() || "Medium";
      console.log('📊 [TakeUforward] Extracted difficulty:', DIFFICULTY);
    }

    async extractProblemInfo() {
      try {
        // Make sure we have latest question details
        this.fetchQuestionDetails();
        
        // Try to get stored code data if not in memory
        if (!PUBLIC_CODE || !SELECTED_LANGUAGE || !PROBLEM_SLUG) {
          console.log('🔄 [TakeUforward] Code data missing in memory, checking storage...');
          const storedData = await chrome.storage.local.get(['tuf_code_data']);
          
          if (storedData.tuf_code_data && storedData.tuf_code_data.timestamp) {
            const dataAge = Date.now() - storedData.tuf_code_data.timestamp;
            if (dataAge < 60000) { // Within 60 seconds
              SELECTED_LANGUAGE = storedData.tuf_code_data.SELECTED_LANGUAGE || SELECTED_LANGUAGE;
              PUBLIC_CODE = storedData.tuf_code_data.PUBLIC_CODE || PUBLIC_CODE;
              PROBLEM_SLUG = storedData.tuf_code_data.PROBLEM_SLUG || PROBLEM_SLUG;
              console.log('✅ [TakeUforward] Retrieved code data from storage (age:', Math.round(dataAge/1000), 'seconds)');
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
      // Extract topic from URL: /plus/dsa/topic-name/
      const urlPath = window.location.pathname;
      const match = urlPath.match(/\/plus\/dsa\/([^\/]+)/);
      
      if (match && match[1]) {
        const rawTopic = match[1];
        const topic = rawTopic
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
          problemStartTime: this.problemStartTime || existingData.problemStartTime || Date.now(),
          timestamp: new Date().toISOString()
        };

        await chrome.storage.local.set({ [storageKey]: problemData });
        console.log('💾 [TakeUforward] Saved problem data for:', currentUrl);
        
        return problemData;
      } catch (error) {
        console.error('[TakeUforward] Error saving problem data:', error);
        return null;
      }
    }

    async handleSuccessfulSubmission(submissionData) {
      try {
        console.log('🎉 [TakeUforward] SUCCESSFUL SUBMISSION DETECTED');
        
        // Wait a bit for UI to update
        await DSAUtils.sleep(2000);
        
        // Extract latest problem info
        const problemInfo = await this.extractProblemInfo();
        
        if (!problemInfo) {
          console.error('❌ [TakeUforward] Could not extract problem information');
          return;
        }
        
        // Validate we have code
        if (!problemInfo.code || problemInfo.code.length < 10) {
          console.error('❌ [TakeUforward] Missing or invalid code. Code length:', problemInfo.code?.length);
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

        console.log('📊 [TakeUforward] Problem info ready for push:', {
          title: problemInfo.title,
          difficulty: problemInfo.difficulty,
          codeLength: problemInfo.code.length,
          language: problemInfo.language,
          topics: problemInfo.topics
        });

        // Store problem as solved BEFORE pushing to backend
        await this.storeProblemData(problemInfo, true);
        console.log('💾 [TakeUforward] Stored problem as solved');

        // Step 1: Push to Backend API
        console.log('🔄 [TakeUforward] Step 1: Pushing to backend...');
        try {
          if (!backendAPI) {
            console.log('🔧 [TakeUforward] Initializing BackendAPI...');
            backendAPI = new BackendAPI();
            await backendAPI.initialize();
          }
          
          const backendResult = await backendAPI.pushCurrentProblemData(problemInfo.url);
          
          if (backendResult.success) {
            console.log('✅ [TakeUforward] Backend push successful!', backendResult.data);
          } else {
            console.log('⚠️ [TakeUforward] Backend push failed:', backendResult.error);
          }
        } catch (error) {
          console.error('❌ [TakeUforward] Backend push error:', error);
        }

        // Step 2: Push to GitHub
        console.log('🔄 [TakeUforward] Step 2: Pushing to GitHub...');
        const githubResult = await githubAPI.pushSolution(problemInfo, PLATFORM);
        
        if (githubResult.success) {
          console.log('✅ [TakeUforward] GitHub push successful!');
          
          // Clear stored code data after successful push
          await chrome.storage.local.remove(['tuf_code_data']);
          
          // Reset state
          TRIES = 0;
          PUBLIC_CODE = '';
          SELECTED_LANGUAGE = '';
          PROBLEM_SLUG = '';
        } else {
          console.error('❌ [TakeUforward] GitHub push failed:', githubResult.error);
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
        console.log('✅ [TakeUforward] Interceptor script injected');
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
      console.log('⏳ [TakeUforward] Waiting for utilities...');
      setTimeout(initializeTakeUforward, 500);
      return;
    }

    console.log('🚀 [TakeUforward] Starting initialization...');
    const extractor = new TakeUforwardExtractor();
    await extractor.initialize();
  }

})();