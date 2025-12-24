// Backend API utility for DSA to GitHub extension

class BackendAPI {
  constructor() {
    this.baseURL = 'https://traverse-backend-api.azurewebsites.net';
    this.authToken = null;
    this.initialized = false;
    console.log(`🔧 [Backend API] BackendAPI constructor called`);
  }

  async initialize() {
    try {
      // Get authentication token from chrome storage
      const result = await chrome.storage.local.get(['auth_token']);
      this.authToken = result.auth_token;
      this.initialized = true;
      
      console.log('[Backend API] Raw token from storage:', this.authToken);
      console.log('[Backend API] Token type:', typeof this.authToken);
      console.log('[Backend API] Token starts with Bearer?', this.authToken ? this.authToken.startsWith('Bearer ') : false);
      
      if (!this.authToken) {
        console.warn('[Backend API] No authentication token found');
        // Let's also check all auth-related storage keys
        const allAuthData = await chrome.storage.local.get(null);
        const authKeys = Object.keys(allAuthData).filter(key => key.includes('auth') || key.includes('token'));
        console.log('[Backend API] Available auth-related keys:', authKeys);
        authKeys.forEach(key => {
          console.log(`[Backend API] ${key}:`, allAuthData[key]);
        });
        return false;
      }
      
      console.log('[Backend API] Initialized successfully');
      return true;
    } catch (error) {
      console.error('[Backend API] Error during initialization:', error);
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
        const initialized = await this.initialize();
        if (!initialized) {
          throw new Error('Backend API not initialized or no authentication token');
        }
      }

      if (!this.authToken) {
        throw new Error('No authentication token available');
      }

      console.log('[Backend API] Pushing submission data:', problemData);
      console.log('[Backend API] Raw auth token:', this.authToken);
      console.log('[Backend API] Token length:', this.authToken ? this.authToken.length : 0);
      
      // Use background script to make the fetch call (bypasses CORS)
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'BACKEND_API_FETCH',
          url: `${this.baseURL}/api/submissions`,
          options: {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cookie': `auth_token=${this.authToken}`
            },
            credentials: 'include',
            body: JSON.stringify(problemData)
          }
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });

      if (!response.success) {
        console.error('[Backend API] Push failed:', response.status, response.data);
        throw new Error(`Backend API error: ${response.status} - ${JSON.stringify(response.data)}`);
      }

      console.log('[Backend API] Submission data pushed successfully! Status:', response.status);
      console.log('[Backend API] Backend response:', response.data);
      return { success: true, data: response.data };

    } catch (error) {
      console.error('[Backend API] Error pushing submission data:', error);
      return { success: false, error: error.message };
    }
  }

  // Convert stored problem data to backend API format
  formatProblemDataForBackend(storedProblemData) {
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
        aiAnalysis = null,
        timestamp
      } = storedProblemData;

      // Convert difficulty: 0 -> easy, 1 -> medium, 2 -> hard
      const difficultyMap = { 0: 'easy', 1: 'medium', 2: 'hard' };
      const difficultyStr = difficultyMap[Number(difficulty)] || 'medium';

      // Generate problem slug from URL or name
      let problemSlug = '';
      if (problem_link) {
        const match = problem_link.match(/problems\/([^\/\?]+)/);
        problemSlug = match ? match[1] : name.toLowerCase().replace(/\s+/g, '-');
      } else {
        problemSlug = name.toLowerCase().replace(/\s+/g, '-');
      }

      // Determine language from attempts if available
      const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;
      const language = lastAttempt?.language || 'python';

      // Calculate time taken (in seconds) - sum of all attempt times or default
      const timeTaken = attempts.reduce((sum, attempt) => {
        return sum + (attempt.timeTaken || 0);
      }, 0) || 0;

      // Generate idempotency key from problem slug and timestamp
      const idempotencyKey = `${problemSlug}-${solved.date || Date.now()}`;

      const formattedData = {
        problemSlug: problemSlug,
        platform: platform.toLowerCase(),
        problemTitle: name || 'Unknown Problem',
        difficulty: difficultyStr,
        language: language,
        outcome: solved.value ? 'accepted' : 'attempted',
        idempotencyKey: idempotencyKey,
        happenedAt: solved.date ? new Date(solved.date).toISOString() : new Date().toISOString(),
        deviceId: 1, // Default device ID
        aiAnalysis: aiAnalysis, // Gemini AI analysis if available
        numberOfTries: Number(runCounter) || 1, // Use runCounter (run button presses)
        timeTaken: timeTaken
      };

      console.log('[Backend API] Formatted submission data:', formattedData);
      
      return formattedData;

    } catch (error) {
      console.error('[Backend API] Error formatting submission data:', error);
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

      console.log('[Backend API] Retrieved stored problem data:', storedData);

      // Format data for backend API
      const formattedData = this.formatProblemDataForBackend(storedData);

      // Push to backend
      return await this.pushSubmissionData(formattedData);

    } catch (error) {
      console.error('[Backend API] Error pushing submission:', error);
      return { success: false, error: error.message };
    }
  }
}

// Make BackendAPI available globally
window.BackendAPI = BackendAPI;
console.log(`🔧 [Backend API] BackendAPI class loaded and made available globally`);