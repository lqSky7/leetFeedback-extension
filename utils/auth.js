// Authentication utility for Chrome extension to communicate with website
class ExtensionAuth {
  constructor() {
    this.websiteUrl = this.getWebsiteUrl();
    this.user = null;
    this.isAuthenticated = false;
    this.authStatusCallbacks = [];
  }

  getWebsiteUrl() {
    // Try to determine the website URL based on environment
    // Check if we're in development or production
    const isDev = chrome.runtime.getManifest().version_name === 'dev' || 
                  chrome.runtime.getURL('').includes('chrome-extension://');
    
    // For development, try localhost first
    if (isDev) {
      return 'http://localhost:5173'; // Vite dev server default port
    }
    
    // For production
    return 'https://leetfeedback.vercel.app';
  }

  // Initialize auth system
  async init() {
    try {
      // Check local storage for cached auth data
      const result = await chrome.storage.local.get(['firebase_user', 'auth_timestamp']);
      
      if (result.firebase_user && result.auth_timestamp) {
        // Check if cached data is not too old (24 hours)
        const now = Date.now();
        const cacheAge = now - result.auth_timestamp;
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        if (cacheAge < maxAge) {
          this.user = result.firebase_user;
          this.isAuthenticated = true;
          this.notifyAuthStatus();
          return;
        }
      }

      // Request fresh auth status from website
      await this.requestAuthStatus();
    } catch (error) {
      console.error('Error initializing auth:', error);
    }
  }

  // Request auth status from the website
  async requestAuthStatus() {
    try {
      // Try both localhost and production URLs
      const urls = [
        'http://localhost:5173/*',
        'http://localhost:3000/*',
        'https://leetfeedback.vercel.app/*',
        'https://*.vercel.app/*',
        'https://*.netlify.app/*'
      ];
      
      let foundTab = null;
      for (const url of urls) {
        const tabs = await chrome.tabs.query({ url });
        if (tabs.length > 0) {
          foundTab = tabs[0];
          this.websiteUrl = new URL(foundTab.url).origin;
          break;
        }
      }
      
      if (foundTab) {
        // Website is open, request auth status
        chrome.tabs.sendMessage(foundTab.id, {
          type: 'AUTH_STATUS_REQUEST'
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.log('Content script not loaded yet, checking storage...');
            this.checkLocalStorage();
            return;
          }
          if (response && response.type === 'AUTH_STATUS_RESPONSE') {
            this.updateAuthStatus(response.isAuthenticated, response.user);
          }
        });
      } else {
        // Website is not open, check local storage
        this.checkLocalStorage();
      }
    } catch (error) {
      console.error('Error requesting auth status:', error);
      this.checkLocalStorage();
    }
  }

  // Check local storage for cached auth data
  async checkLocalStorage() {
    try {
      const result = await chrome.storage.local.get(['firebase_user', 'auth_timestamp']);
      
      if (result.firebase_user && result.auth_timestamp) {
        const now = Date.now();
        const cacheAge = now - result.auth_timestamp;
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        if (cacheAge < maxAge) {
          this.updateAuthStatus(true, result.firebase_user);
          return;
        }
      }
      
      // No valid cached data
      this.updateAuthStatus(false, null);
    } catch (error) {
      console.error('Error checking local storage:', error);
      this.updateAuthStatus(false, null);
    }
  }

  // Update authentication status
  updateAuthStatus(isAuthenticated, user) {
    this.isAuthenticated = isAuthenticated;
    this.user = user;

    // Cache the auth data
    if (isAuthenticated && user) {
      chrome.storage.local.set({
        firebase_user: user,
        auth_timestamp: Date.now()
      });
    } else {
      chrome.storage.local.remove(['firebase_user', 'auth_timestamp']);
    }

    // Notify all callbacks
    this.notifyAuthStatus();
  }

  // Add callback for auth status changes
  onAuthStatusChange(callback) {
    this.authStatusCallbacks.push(callback);
    
    // Immediately call with current status
    callback({
      isAuthenticated: this.isAuthenticated,
      user: this.user
    });

    // Return unsubscribe function
    return () => {
      const index = this.authStatusCallbacks.indexOf(callback);
      if (index > -1) {
        this.authStatusCallbacks.splice(index, 1);
      }
    };
  }

  // Notify all callbacks of auth status
  notifyAuthStatus() {
    this.authStatusCallbacks.forEach(callback => {
      try {
        callback({
          isAuthenticated: this.isAuthenticated,
          user: this.user
        });
      } catch (error) {
        console.error('Error in auth status callback:', error);
      }
    });
  }

  // Open website for sign in
  async openSignIn() {
    try {
      // Try to find existing tab first
      const existingTabs = await chrome.tabs.query({ 
        url: [
          'http://localhost:5173/*',
          'http://localhost:3000/*',
          'https://leetfeedback.vercel.app/*'
        ]
      });
      
      if (existingTabs.length > 0) {
        // Focus existing tab
        await chrome.tabs.update(existingTabs[0].id, { active: true });
        await chrome.windows.update(existingTabs[0].windowId, { focused: true });
        
        // Check auth status after focusing
        setTimeout(() => {
          this.requestAuthStatus();
        }, 1000);
        
        return existingTabs[0];
      } else {
        // Create new tab
        const tab = await chrome.tabs.create({
          url: this.websiteUrl,
          active: true
        });

        // Listen for auth changes after opening the website
        setTimeout(() => {
          this.requestAuthStatus();
        }, 3000); // Give more time for page to load

        return tab;
      }
    } catch (error) {
      console.error('Error opening sign in:', error);
      throw error;
    }
  }

  // Sign out
  async signOut() {
    try {
      // Clear local auth data
      await chrome.storage.local.remove(['firebase_user', 'auth_timestamp']);
      
      // Update status
      this.updateAuthStatus(false, null);

      // If website is open, try to sign out there too
      const tabs = await chrome.tabs.query({ url: `${this.websiteUrl}/*` });
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SIGN_OUT_REQUEST'
        });
      }
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  }

  // Get current user
  getCurrentUser() {
    return this.user;
  }

  // Check if authenticated
  isUserAuthenticated() {
    return this.isAuthenticated;
  }

  // Get user display name
  getUserDisplayName() {
    if (!this.user) return null;
    return this.user.displayName || this.user.email || 'User';
  }

  // Get user profile picture
  getUserProfilePicture() {
    if (!this.user) return null;
    return this.user.photoURL;
  }

  // Get user email
  getUserEmail() {
    if (!this.user) return null;
    return this.user.email;
  }

  // Get auth provider
  getAuthProvider() {
    if (!this.user) return null;
    const provider = this.user.provider;
    if (provider === 'google.com') return 'Google';
    if (provider === 'apple.com') return 'Apple';
    return provider;
  }
}

// Create singleton instance
const extensionAuth = new ExtensionAuth();

// Initialize on load
extensionAuth.init();

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = extensionAuth;
} else {
  window.extensionAuth = extensionAuth;
}