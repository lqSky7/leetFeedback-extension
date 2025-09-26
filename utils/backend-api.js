// Backend API utility for DSA to GitHub extension

class BackendAPI {
  constructor() {
    this.baseURL = 'https://leetfeedback-backend.onrender.com';
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

  async pushProblemData(problemData) {
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

      console.log('[Backend API] Pushing problem data:', problemData);
      console.log('[Backend API] Raw auth token:', this.authToken);
      console.log('[Backend API] Token length:', this.authToken ? this.authToken.length : 0);
      
      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`
      };
      console.log('[Backend API] Full Authorization header:', headers.Authorization);
      console.log('[Backend API] Request headers:', headers);

      const response = await fetch(`${this.baseURL}/api/problems/push`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(problemData)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Backend API] Push failed:', response.status, errorText);
        throw new Error(`Backend API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('[Backend API] Problem data pushed successfully! Status:', response.status);
      console.log('[Backend API] Backend response:', result);
      return { success: true, data: result };

    } catch (error) {
      console.error('[Backend API] Error pushing problem data:', error);
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
        ignored = false,
        parent_topic = [],
        problem_link
      } = storedProblemData;

      // Format parent_topic - take first topic as parent_topic, second as grandparent
      const topics = Array.isArray(parent_topic) ? parent_topic : [];
      const parentTopic = topics.length > 0 ? topics[0] : 'Unknown Topic';
      const grandparent = topics.length > 1 ? topics[1] : 'General';

      const formattedData = {
        name: name || 'Unknown Problem',
        platform: platform.toLowerCase(),
        difficulty: Number(difficulty) || 1,
        solved: {
          value: Boolean(solved.value),
          date: Number(solved.date) || 0,
          tries: Number(solved.tries) || 0
        },
        ignored: Boolean(ignored),
        parent_topic: parentTopic,
        grandparent: grandparent,
        problem_link: problem_link || ''
      };

      console.log('[Backend API] Formatted problem data:', formattedData);
      
      // Validate the formatted data matches expected structure
      const expectedFields = ['name', 'platform', 'difficulty', 'solved', 'ignored', 'parent_topic', 'grandparent', 'problem_link'];
      const missingFields = expectedFields.filter(field => !(field in formattedData));
      if (missingFields.length > 0) {
        console.warn('[Backend API] Missing expected fields:', missingFields);
      }
      
      return formattedData;

    } catch (error) {
      console.error('[Backend API] Error formatting problem data:', error);
      throw new Error('Failed to format problem data for backend');
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
      return await this.pushProblemData(formattedData);

    } catch (error) {
      console.error('[Backend API] Error pushing current problem data:', error);
      return { success: false, error: error.message };
    }
  }
}

// Make BackendAPI available globally
window.BackendAPI = BackendAPI;
console.log(`🔧 [Backend API] BackendAPI class loaded and made available globally`);