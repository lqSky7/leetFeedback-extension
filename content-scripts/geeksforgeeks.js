// GeeksforGeeks content script for DSA to GitHub extension

(function() {
  'use strict';

  const PLATFORM = DSA_PLATFORMS.GEEKSFORGEEKS;
  let githubAPI = null;
  let isInitialized = false;
  let submissionInProgress = false;

  // GeeksforGeeks specific selectors
  const SELECTORS = {
    problemTitle: 'h1, h2, h3, .problems_header_content__title h3, [class*="problems_header_content__title"] h3, .problem-title, [class*="title"], [class*="header"] h1, [class*="header"] h2, [class*="header"] h3',
    problemDescription: '[class*="problems_problem_content"], .problem-description, [class*="problem_content"], .problem-statement, [class*="description"], [class*="statement"], .content, main',
    difficulty: '[class*="problems_header_description"] span:first-child, .difficulty-tag, .difficulty, [class*="difficulty"], [class*="level"], span[class*="tag"]',
    submitButton: '.ui.button.problems_submit_button__6QoNQ, [class*="ui button problems_submit_button"], .submit-button, button[class*="submit"], [class*="submit"], input[type="submit"]',
    submissionResult: '[class*="problems_content"], .submission-result, .result, [class*="result"], [class*="status"], [class*="verdict"]',
    languageSelector: '.divider.text, .language-selector, [class*="language"], select, [class*="dropdown"]',
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
      this.isMonitoring = false;
    }

    async initialize() {
      try {
        githubAPI = new GitHubAPI();
        await githubAPI.initialize();
        this.setupEventListeners();
        this.checkPageType();
        DSAUtils.logDebug(PLATFORM, 'GeeksforGeeks extractor initialized');
        isInitialized = true;
      } catch (error) {
        DSAUtils.logError(PLATFORM, 'Failed to initialize', error);
      }
    }

    setupEventListeners() {
      // Listen for URL changes
      this.observeUrlChanges();
      
      // Monitor submit button clicks
      this.monitorSubmissions();
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

    attachSubmitButtonListener() {
      // Try multiple selectors specifically for GFG submit button
      const submitSelectors = [
        '.ui.button.problems_submit_button__6QoNQ',
        '[class*="ui button problems_submit_button"]',
        'button.ui.button:contains("Submit")',
        '.submit-button',
        'button[class*="submit"]'
      ];
      
      let submitButton = null;
      for (const selector of submitSelectors) {
        submitButton = document.querySelector(selector);
        if (submitButton) {
          DSAUtils.logDebug(PLATFORM, `Found submit button with selector: ${selector}`);
          break;
        }
      }
      
      if (submitButton && !submitButton.hasAttribute('data-gfg-listener')) {
        submitButton.setAttribute('data-gfg-listener', 'true');
        DSAUtils.logDebug(PLATFORM, 'Added click listener to submit button');
        
        submitButton.addEventListener('click', () => {
          DSAUtils.logDebug(PLATFORM, 'Submit button clicked!');
          this.handleSubmissionAttempt();
        });
      } else if (!submitButton) {
        DSAUtils.logError(PLATFORM, 'Submit button not found with any selector');
        // Debug all buttons on page
        const allButtons = document.querySelectorAll('button');
        DSAUtils.logDebug(PLATFORM, `Found ${allButtons.length} buttons on page:`);
        allButtons.forEach((btn, i) => {
          DSAUtils.logDebug(PLATFORM, `Button ${i}: "${btn.textContent.trim()}" (class: ${btn.className})`);
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
        
        const problemInfo = {
          title: this.getProblemTitle(),
          description: this.getProblemDescription(),
          difficulty: this.getDifficulty(),
          tags: this.getTags(),
          url: window.location.href.split('?')[0],
          language: this.getCurrentLanguage(),
          code: this.getCurrentCode(),
          companyTags: this.getCompanyTags(),
          topicTags: this.getTopicTags()
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
      const tagHeadings = document.querySelectorAll('.problems_tag_container__kWANg');
      
      for (let heading of tagHeadings) {
        if (heading.textContent.includes('Topic Tags')) {
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

    getCurrentLanguage() {
      const langElement = document.querySelector(SELECTORS.languageSelector);
      if (!langElement) return 'C++'; // Default
      
      const langText = langElement.textContent;
      const match = langText.match(/\((.*?)\)/);
      
      return match ? match[1].trim() : langText.split('(')[0].trim();
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

        // Push to GitHub using single solution.md file
        DSAUtils.logDebug(PLATFORM, 'Pushing to GitHub...');
        const result = await githubAPI.pushSolution(this.currentProblem, PLATFORM);
        DSAUtils.logDebug(PLATFORM, 'Push result:', result);
        
        if (result.success) {
          DSAUtils.logDebug(PLATFORM, 'Push successful!');
        } else {
          DSAUtils.logError(PLATFORM, 'Push failed:', result.error);
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

    const extractor = new GeeksforGeeksExtractor();
    await extractor.initialize();
  }

})();