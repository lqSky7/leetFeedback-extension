// LeetCode content script for DSA to GitHub extension

(function() {
  'use strict';

  const PLATFORM = DSA_PLATFORMS.LEETCODE;
  let githubAPI = null;
  let isInitialized = false;

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
      }

    async initialize() {
      try {
        githubAPI = new GitHubAPI();
        await githubAPI.initialize();
        this.setupEventListeners();
        this.checkPageType();
        DSAUtils.logDebug(PLATFORM, 'LeetCode extractor initialized');
        isInitialized = true;
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Failed to initialize', error);
      }
    }

    setupEventListeners() {
      // Listen for URL changes (LeetCode is SPA)
      this.observeUrlChanges();
      
      // Listen for submission events
      this.observeSubmissions();
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
      // Observer for submission results
      const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check for successful submission
              const successElement = node.querySelector ? 
                node.querySelector('[data-e2e-locator="submission-result"]') : null;
              
              if (successElement && successElement.textContent.includes('Accepted')) {
                setTimeout(() => this.handleSuccessfulSubmission(), 2000);
              }
            }
          });
        });
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
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
        
        const problemInfo = {
          title: this.getProblemTitle(),
          number: this.getProblemNumber(),
          description: this.getProblemDescription(),
          difficulty: this.getDifficulty(),
          url: window.location.href.split('?')[0],
          language: this.getCurrentLanguage(),
          code: this.getCurrentCode()
        };

        DSAUtils.logDebug(PLATFORM, 'Extracted data:', {
          titleFound: !!problemInfo.title,
          title: problemInfo.title,
          number: problemInfo.number,
          descriptionLength: problemInfo.description?.length || 0,
          difficulty: problemInfo.difficulty,
          language: problemInfo.language,
          codeLength: problemInfo.code?.length || 0,
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





    getCurrentLanguage() {
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

    getCurrentCode() {
      // Method 1: Monaco editor
      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels();
        if (models.length > 0) {
          const code = models[0].getValue();
          if (code && code.length > 10) {
            return code;
          }
        }
      }

      // Method 2: DOM elements
      const selectors = ['.view-lines', '.monaco-editor', '.ace_content'];
      
      for (let selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          const code = this.extractCodeFromElement(element);
          if (code && code.length > 10) {
            return code;
          }
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

    async handleSuccessfulSubmission() {
      try {
        DSAUtils.logDebug(PLATFORM, 'Handling successful submission');
        
        // Wait a bit for performance data to load
        await DSAUtils.sleep(2000);
        
        // Extract performance metrics
        const stats = this.extractPerformanceStats();
        
        // Get updated problem info
        const problemInfo = await this.extractProblemInfo();
        if (!problemInfo) {
          return;
        }

        // Add performance stats
        problemInfo.stats = stats;

        // Push to GitHub
        const result = await githubAPI.pushSolution(problemInfo, PLATFORM);
        
        if (result.success) {
          DSAUtils.logDebug(PLATFORM, 'Push successful!');
        } else {
          DSAUtils.logError(PLATFORM, 'Push failed:', result.error);
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

    const extractor = new LeetCodeExtractor();
    await extractor.initialize();
  }

})();