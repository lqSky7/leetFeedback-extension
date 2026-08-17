// Backend API utility for DSA to GitHub extension

// Category mapping for ML model (0-14)
const CATEGORY_MAP = {
  // Arrays
  'array': 0, 'arrays': 0, 'sliding window': 0, 'two pointers': 0, 'two pointer': 0, '2 pointer': 0, 'sliding window / 2 pointer': 0,
  // Strings
  'string': 1, 'strings': 1, 'strings (advanced algo)': 1, 'strings(advanced algo)': 1,
  // Linked List
  'linked list': 2, 'linkedlist': 2, 'linked-list': 2,
  // Trees
  'tree': 3, 'trees': 3, 'binary tree': 3, 'binary trees': 3, 'binary search tree': 3, 'binary search trees': 3, 'bst': 3, 'trie': 3, 'tries': 3,
  // Graphs
  'graph': 4, 'graphs': 4,
  // Dynamic Programming
  'dp': 5, 'dynamic programming': 5,
  // Greedy
  'greedy': 6, 'greedy algorithms': 6, 'greedy algorithm': 6,
  // Backtracking
  'backtracking': 7, 'recursion': 7,
  // Sorting
  'sorting': 8, 'sort': 8, 'sorting and searching': 8,
  // Searching
  'searching': 9, 'search': 9, 'binary search': 9,
  // Stack
  'stack': 10, 'monotonic stack': 10, 'stack / queues': 10, 'stacks / queues': 10, 'stack and queues': 10, 'stacks and queues': 10, 'stack & queues': 10, 'stacks & queues': 10,
  // Queue
  'queue': 11,
  // Heap
  'heap': 12, 'heaps': 12, 'priority queue': 12,
  // HashMap
  'hash map': 13, 'hashmap': 13, 'hash table': 13, 'hashtable': 13, 'hashing': 13,
  'math': 14, 'maths': 14, 'bit manipulation': 14, 'number theory': 14
};

/**
 * Map topic strings to category ID for ML model
 * @param {string[]} topics - Array of topic strings from problem
 * @returns {number|null} - Category ID (0-14) or null if unknown
 */
function mapTopicToCategory(topics) {
  if (!topics || !Array.isArray(topics) || topics.length === 0) {
    return null;
  }

  for (const topic of topics) {
    const normalized = topic.toLowerCase().trim();
    if (CATEGORY_MAP[normalized] !== undefined) {
      return CATEGORY_MAP[normalized];
    }
  }

  // No exact match found
  return null;
}

class BackendAPI {
  constructor() {
    this.baseURL = 'https://neatness-enlarged-curled.ngrok-free.dev';
    this.authToken = null;
    this.initialized = false;
    this._log(`[Backend API] BackendAPI constructor called`);
  }

  // Debug-aware logging methods
  _log(...args) {
    if (typeof debugLog === 'function') {
      debugLog(...args);
    } else if (typeof window !== 'undefined' && typeof window.isDebugMode === 'function' && window.isDebugMode()) {
      console.log(...args);
    }
  }

  _error(...args) {
    if (typeof debugError === 'function') {
      debugError(...args);
    } else if (typeof window !== 'undefined' && typeof window.isDebugMode === 'function' && window.isDebugMode()) {
      console.error(...args);
    }
  }

  _warn(...args) {
    if (typeof debugWarn === 'function') {
      debugWarn(...args);
    } else if (typeof window !== 'undefined' && typeof window.isDebugMode === 'function' && window.isDebugMode()) {
      console.warn(...args);
    }
  }

  async initialize() {
    try {
      // Get authentication token from chrome storage
      const result = await chrome.storage.local.get(['auth_token', 'auth_user']);
      this.authToken = result.auth_token;
      this.initialized = true;

      this._log('[Backend API] Initialization attempt');
      this._log('[Backend API] Token found:', !!this.authToken);
      this._log('[Backend API] User found:', !!result.auth_user);

      if (!this.authToken) {
        this._warn('[Backend API] No authentication token found in storage');

        // Debug: Check all storage keys
        const allAuthData = await chrome.storage.local.get(null);
        const authKeys = Object.keys(allAuthData).filter(key =>
          key.includes('auth') || key.includes('token') || key.includes('user')
        );
        this._log('[Backend API] Available auth-related keys:', authKeys);

        return false;
      }

      this._log('[Backend API] Initialized successfully with token');
      return true;
    } catch (error) {
      this._error('[Backend API] Error during initialization:', error);
      return false;
    }
  }

  async testConnection() {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.authToken) {
      return { success: false, error: 'No authentication token available' };
    }

    try {
      const response = await fetch(`${this.baseURL}/api/auth/verify`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Backend API error: ${response.status}`);
      }

      const userData = await response.json();
      return { success: true, user: userData };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async pushSubmissionData(problemData) {
    try {
      if (!this.initialized) {
        this._log('[Backend API] Not initialized, initializing now...');
        const initialized = await this.initialize();
        if (!initialized) {
          throw new Error('Failed to initialize: No authentication token found. Please log in to the extension.');
        }
      }

      if (!this.authToken) {
        throw new Error('No authentication token available. Please log in to the extension.');
      }

      this._log('[Backend API] Pushing submission data');

      // Use background script to make the fetch call (bypasses CORS)
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'BACKEND_API_FETCH',
          url: `${this.baseURL}/api/submissions`,
          options: {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${this.authToken}`
            },
            body: JSON.stringify(problemData)
          }
        }, (response) => {
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message;
            if (errorMsg && errorMsg.includes('Extension context invalidated')) {
              reject(new Error('Extension was updated. Please refresh the page to submit again.'));
            } else {
              reject(new Error(errorMsg));
            }
          } else if (!response) {
            reject(new Error('No response from background script'));
          } else {
            resolve(response);
          }
        });
      });

      if (!response.success) {
        const errorStatus = response.status || 'unknown';
        const errorDetails = response.error || response.data || 'No details available';
        this._error('[Backend API] Push failed:', errorStatus, errorDetails);
        throw new Error(`Backend API error: ${errorStatus} - ${typeof errorDetails === 'object' ? JSON.stringify(errorDetails) : errorDetails}`);
      }

      this._log('[Backend API] Submission data pushed successfully! Status:', response.status);
      this._log('[Backend API] Backend response:', response.data);
      return { success: true, data: response.data };

    } catch (error) {
      this._error('[Backend API] Error pushing submission data:', error);
      return { success: false, error: error.message };
    }
  }

  // Convert stored problem data to backend API format
  async formatProblemDataForBackend(storedProblemData) {
    try {
      const {
        name,
        platform = 'leetcode',
        difficulty = 1,
        solved = { value: false, date: 0, tries: 0 },
        parent_topic = [],
        problem_link,
        attempts = [],
        runCounter = 0,
        shouldAnalyzeWithGemini = false,
        problemStartTime = null,
        timestamp,
        language = null  // Add language from stored data (for TakeUforward/GFG)
      } = storedProblemData;

      // Read AI config for server-side analysis
      let geminiApiKey = null;
      let geminiModel = null;
      try {
          const geminiAPI = new GeminiAPI();
          await geminiAPI.initialize();
          geminiApiKey = geminiAPI.getGeminiApiKey();
          geminiModel = geminiAPI.getGeminiModel();
      } catch (e) {
          this._warn('[Backend API] Failed to read Gemini config:', e);
      }

      // Convert difficulty: 0 -> easy, 1 -> medium, 2 -> hard
      const difficultyMap = { 0: 'easy', 1: 'medium', 2: 'hard' };
      const difficultyStr = difficultyMap[Number(difficulty)] || 'medium';

      // Generate problem slug from URL or name
      let problemSlug = '';
      if (problem_link) {
        const match = problem_link.match(/(?:problem-details|problems)\/([^\/\?]+)/);
        problemSlug = match ? match[1] : name.toLowerCase().replace(/\s+/g, '-');
      } else {
        problemSlug = name.toLowerCase().replace(/\s+/g, '-');
      }

      // Determine language from attempts if available, otherwise from stored data
      const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;
      const languageValue = lastAttempt?.language || language || 'python';

      // Calculate time taken (in seconds) from problem start to submission
      // Subtract pausedTime (time when tab was hidden) for accurate active time tracking
      // This calculation matches the overlay display in problem-timer.js
      let timeTaken = 0;
      const pausedTime = storedProblemData.pausedTime || 0;

      if (problemStartTime && solved.date) {
        const totalElapsed = solved.date - problemStartTime; // Total elapsed time in ms
        const activeTime = totalElapsed - pausedTime; // Subtract time when tab was hidden

        // Validation matches problem-timer.js getElapsedActiveTime()
        // Ensure elapsed time is always positive and reasonable
        if (activeTime < 0) {
          this._warn('[Backend API] Negative active time detected, resetting to 0. Active time:', activeTime, 'ms');
          timeTaken = 0;
        } else {
          // Cap at 2 hours for all platforms to match problem-timer.js
          const MAX_TIME_SECONDS = 2 * 60 * 60; // 2 hours
          const rawTimeTaken = Math.floor(activeTime / 1000); // Convert ms to seconds

          if (rawTimeTaken > MAX_TIME_SECONDS) {
            this._warn(`[Backend API] Time taken exceeds cap (${MAX_TIME_SECONDS}s), capping. Raw value:`, rawTimeTaken);
            timeTaken = MAX_TIME_SECONDS;
          } else {
            timeTaken = rawTimeTaken;
          }
        }
      }

      // Generate idempotency key from problem slug and timestamp
      const idempotencyKey = `${problemSlug}-${solved.date || Date.now()}`;

      // Ensure attempts array is populated and token-optimized via attempt diffing
      let rawAttemptsList = Array.isArray(attempts) ? [...attempts] : [];
      if (rawAttemptsList.length === 0 && storedProblemData.code && storedProblemData.code.length > 10) {
        rawAttemptsList.push({
          code: storedProblemData.code,
          language: languageValue,
          timestamp: solved.date ? new Date(solved.date).toISOString() : new Date().toISOString(),
          type: 'submit',
          successful: solved.value
        });
      }

      const attemptsList = this.formatAttemptsWithDiffs(rawAttemptsList);

      const formattedData = {
        problemSlug: problemSlug,
        platform: platform.toLowerCase(),
        problemTitle: name || 'Unknown Problem',
        difficulty: difficultyStr,
        language: languageValue,
        outcome: solved.value ? 'accepted' : 'failed',
        idempotencyKey: idempotencyKey,
        happenedAt: solved.date ? new Date(solved.date).toISOString() : new Date().toISOString(),
        deviceId: 1, // Default device ID
        shouldAnalyzeWithAI: shouldAnalyzeWithGemini,
        geminiApiKey: geminiApiKey,
        geminiModel: geminiModel,
        numberOfTries: Number(runCounter) || 1, // Use runCounter (run button presses)
        timeTaken: timeTaken,
        category: mapTopicToCategory(parent_topic), // Map topic to category ID for ML model
        topic: parent_topic[0] || null,
        subtopic: parent_topic[1] || null,
        attempts: attemptsList,
      };

      this._log('[Backend API] Formatted submission data:', formattedData);
      this._log('[Backend API] Topics:', parent_topic, '-> Category:', formattedData.category, 'Topic:', formattedData.topic, 'Subtopic:', formattedData.subtopic);

      return formattedData;

    } catch (error) {
      this._error('[Backend API] Error formatting submission data:', error);
      throw new Error('Failed to format submission data for backend');
    }
  }

  // Main method to push current problem data from localStorage
  async pushCurrentProblemData(currentProblemUrl) {
    try {
      if (!currentProblemUrl) {
        throw new Error('No current problem URL provided');
      }

      // Get problem data from chrome storage
      const storageKey = `problem_data_${currentProblemUrl}`;
      const result = await chrome.storage.local.get([storageKey]);
      const storedData = result[storageKey];

      if (!storedData) {
        throw new Error(`No problem data found for: ${currentProblemUrl}`);
      }

      this._log('[Backend API] Retrieved stored problem data:', storedData);

      // Format data for backend API
      const formattedData = await this.formatProblemDataForBackend(storedData);

      // Push to backend
      return await this.pushSubmissionData(formattedData);

    } catch (error) {
      const errorMsg = error.message || String(error);
      if (errorMsg.includes('Extension context invalidated')) {
        this._warn('[Backend API] Extension was updated. Please refresh the page to submit again.');
        return { success: false, error: 'Extension was updated. Please refresh the page.' };
      }
      this._error('[Backend API] Error pushing submission:', error);
      return { success: false, error: error.message };
    }
  }

  formatAttemptsWithDiffs(attempts) {
    if (!Array.isArray(attempts) || attempts.length === 0) {
      return [];
    }

    const diffedAttempts = [];
    let previousCode = "";

    for (let i = 0; i < attempts.length; i++) {
      const att = attempts[i];
      const currentCode = att.code || "";

      if (i === 0) {
        diffedAttempts.push({
          ...att,
          code: currentCode
        });
        previousCode = currentCode;
      } else {
        let codeContent = currentCode;
        if (currentCode.length > 0 && previousCode.length > 0 && currentCode !== previousCode) {
          codeContent = this.computeAttemptDiffSummary(previousCode, currentCode, i + 1);
        } else if (currentCode === previousCode) {
          codeContent = `// Attempt #${i + 1}: Same code as Attempt #${i}`;
        }

        diffedAttempts.push({
          ...att,
          code: codeContent
        });
        previousCode = currentCode;
      }
    }

    return diffedAttempts;
  }

  computeAttemptDiffSummary(oldCode, newCode, attemptNumber) {
    const oldLines = oldCode.split(/\r?\n/);
    const newLines = newCode.split(/\r?\n/);

    const changes = [];
    const maxLines = Math.max(oldLines.length, newLines.length);

    for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
      const oldLine = oldLines[lineIdx];
      const newLine = newLines[lineIdx];

      if (oldLine !== newLine) {
        const lineNum = lineIdx + 1;
        if (oldLine !== undefined && newLine !== undefined) {
          changes.push(`// Line ${lineNum}:\n// - ${oldLine.trim()}\n// + ${newLine.trim()}`);
        } else if (oldLine === undefined) {
          changes.push(`// Line ${lineNum} added: + ${newLine.trim()}`);
        } else if (newLine === undefined) {
          changes.push(`// Line ${lineNum} removed: - ${oldLine.trim()}`);
        }
      }
    }

    if (changes.length === 0) {
      return `// Attempt #${attemptNumber}: No code changes`;
    }

    return `// Attempt #${attemptNumber} changes:\n` + changes.join('\n');
  }
}

// Make BackendAPI available globally
window.BackendAPI = BackendAPI;
// BackendAPI class loaded and made available globally