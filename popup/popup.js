class PopupController {
  constructor() {
    this.config = {};
    this.stats = {};
    this.timeTracking = {};
    this.connectionStatus = false;
    this.authStatus = { isAuthenticated: false, user: null };
    this.initialize();
  }

  async initialize() {
    await this.loadStoredData();
    await this.initializeAuth();
    this.setupEventListeners();
    this.updateUI();
    this.updateConnectionStatus();
    this.loadStatistics();
    this.loadTimeTracking();
    this.initializePlatformIcons();
    
    // Set up timer to refresh time tracking data
    this.timeTrackingInterval = setInterval(() => {
      this.loadTimeTracking();
    }, 30000); // Update every 30 seconds
  }
  
  initializePlatformIcons() {
    // Add subtle hover animation to platform icons
    document.querySelectorAll('.platform-icon').forEach(icon => {
      icon.addEventListener('mouseover', () => {
        setTimeout(() => icon.style.transform = 'scale(1.1)', 0);
      });
      icon.addEventListener('mouseout', () => {
        setTimeout(() => icon.style.transform = 'scale(1.0)', 0);
      });
    });
  }

  setupEventListeners() {
    // Tab navigation with animation
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        // Add ripple effect to tab clicks
        const ripple = document.createElement('span');
        ripple.classList.add('tab-ripple');
        e.target.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);
        
        this.switchTab(e.target.dataset.tab);
      });
    });

    // Form submission
    document.getElementById('config-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveConfiguration();
    });

    // Test connection
    document.getElementById('test-btn').addEventListener('click', () => {
      this.testConnection();
    });

    // Toggle password visibility
    document.getElementById('toggle-token').addEventListener('click', () => {
      this.togglePasswordVisibility('token', 'toggle-token');
    });

    // Toggle Gemini key visibility
    document.getElementById('toggle-gemini').addEventListener('click', () => {
      this.togglePasswordVisibility('gemini-key', 'toggle-gemini');
    });

    // Real-time validation
    ['token', 'owner', 'repo', 'gemini-key'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => {
        this.clearMessages();
      });
    });

    // GitHub token link
    document.querySelector('.token-link').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: e.target.href });
    });
  }

  async loadStoredData() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([
        'github_token',
        'github_owner', 
        'github_repo',
        'github_branch',
        'gemini_api_key',
        'debug_mode',
        'dsa_stats',
        'time_tracking',
        'mistake_tags'
      ], (data) => {
        this.config = {
          token: data.github_token || '',
          owner: data.github_owner || '',
          repo: data.github_repo || '',
          branch: data.github_branch || 'main',
          geminiKey: data.gemini_api_key || '',
          debugMode: data.debug_mode || false
        };
        this.stats = data.dsa_stats || {};
        this.timeTracking = data.time_tracking || {
          platforms: {
            leetcode: { totalTime: 0, lastActive: null, isActive: false },
            geeksforgeeks: { totalTime: 0, lastActive: null, isActive: false },
            takeuforward: { totalTime: 0, lastActive: null, isActive: false }
          },
          lastUpdated: new Date().toISOString()
        };
        this.mistakeTags = data.mistake_tags || {};
        resolve();
      });
    });
  }

  updateUI() {
    document.getElementById('token').value = this.config.token;
    document.getElementById('owner').value = this.config.owner;
    document.getElementById('repo').value = this.config.repo;
    document.getElementById('branch').value = this.config.branch;
    document.getElementById('gemini-key').value = this.config.geminiKey;
    document.getElementById('debug-mode').checked = this.config.debugMode;
  }

  switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab').forEach(tab => {
      tab.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update tab panels
    document.querySelectorAll('.tab-panel').forEach(panel => {
      panel.classList.remove('active');
    });
    document.getElementById(tabName).classList.add('active');

    if (tabName === 'stats') {
      this.loadStatistics();
    } else if (tabName === 'settings') {
      // Ensure debug checkbox is properly loaded with current value
      document.getElementById('debug-mode').checked = this.config.debugMode || false;
      this.updateAuthSection();
      console.log('Settings tab loaded. Debug mode:', this.config.debugMode);
    }
  }

  async saveConfiguration() {
    const formData = this.collectFormData();
    
    if (!this.validateFormData(formData)) {
      return;
    }

    try {
      chrome.storage.sync.set({
        github_token: formData.token,
        github_owner: formData.owner,
        github_repo: formData.repo,
        github_branch: formData.branch,
        gemini_api_key: formData.geminiKey,
        debug_mode: formData.debugMode
      }, () => {
      });

      this.config = formData;
      this.showMessage('Configuration saved successfully', 'success');
      
      setTimeout(() => {
        this.updateConnectionStatus();
      }, 500);

    } catch (error) {
      this.showMessage(`Failed to save: ${error.message}`, 'error');
    }
  }

  collectFormData() {
    return {
      token: document.getElementById('token').value.trim(),
      owner: document.getElementById('owner').value.trim(),
      repo: document.getElementById('repo').value.trim(),
      branch: document.getElementById('branch').value || 'main',
      geminiKey: document.getElementById('gemini-key').value.trim(),
      debugMode: document.getElementById('debug-mode').checked
    };
  }

  validateFormData(data) {
    if (!data.token || !data.owner || !data.repo) {
      this.showMessage('All fields are required', 'error');
      return false;
    }

    if (!data.token.match(/^gh[ps]_[a-zA-Z0-9]{36,}$/)) {
      this.showMessage('Invalid token format', 'error');
      return false;
    }

    if (!data.owner.match(/^[a-zA-Z0-9]([a-zA-Z0-9-]){0,38}$/)) {
      this.showMessage('Invalid username format', 'error');
      return false;
    }

    if (!data.repo.match(/^[a-zA-Z0-9._-]+$/)) {
      this.showMessage('Invalid repository name', 'error');
      return false;
    }

    return true;
  }

  async testConnection() {
    const formData = this.collectFormData();
    
    if (!this.validateFormData(formData)) {
      return;
    }

    const testBtn = document.getElementById('test-btn');
    const originalText = testBtn.textContent;
    testBtn.disabled = true;
    testBtn.textContent = 'Testing...';

    try {
      const response = await this.sendMessageToBackground({
        type: 'testGitHubConnection',
        token: formData.token,
        owner: formData.owner,
        repo: formData.repo
      });

      if (response.success) {
        this.showMessage(`Connected as ${response.user.login}`, 'success');
        this.connectionStatus = true;
        this.updateConnectionStatus();
      } else {
        this.showMessage(`Connection failed: ${response.error}`, 'error');
        this.connectionStatus = false;
        this.updateConnectionStatus();
      }

    } catch (error) {
      this.showMessage(`Test failed: ${error.message}`, 'error');
      this.connectionStatus = false;
      this.updateConnectionStatus();
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = originalText;
    }
  }

  updateConnectionStatus() {
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');

    const isConfigured = this.config.token && this.config.owner && this.config.repo;
    
    if (isConfigured && this.connectionStatus) {
      statusDot.classList.add('connected');
      statusText.textContent = 'Connected';
    } else if (isConfigured) {
      statusDot.classList.remove('connected');
      statusText.textContent = 'Configured';
    } else {
      statusDot.classList.remove('connected');
      statusText.textContent = 'Disconnected';
    }
  }

  async loadStatistics() {
    try {
      const result = await chrome.storage.sync.get(['dsa_stats']);
      this.stats = result.dsa_stats || {};

      let totalSolved = 0;
      let leetcodeCount = 0;
      let geeksforgeeksCount = 0;
      let takeuforwardCount = 0;

      Object.entries(this.stats).forEach(([platform, data]) => {
        const count = data.solved || 0;
        totalSolved += count;

        if (platform === 'leetcode') leetcodeCount = count;
        if (platform === 'geeksforgeeks') geeksforgeeksCount = count;
        if (platform === 'takeuforward') takeuforwardCount = count;
      });

      document.getElementById('total-solved').textContent = totalSolved;
      document.getElementById('leetcode-count').textContent = leetcodeCount;
      document.getElementById('geeksforgeeks-count').textContent = geeksforgeeksCount;
      document.getElementById('takeuforward-count').textContent = takeuforwardCount;

      const weekCount = this.calculateThisWeekCount();
      document.getElementById('this-week').textContent = weekCount;

      this.updateRecentActivity();
      this.loadMistakeTags();

    } catch (error) {
      console.error('Error loading statistics:', error);
    }
  }

  async loadMistakeTags() {
    try {
      const result = await chrome.storage.sync.get(['mistake_tags']);
      this.mistakeTags = result.mistake_tags || {};

      this.updateMistakeTagsUI();
    } catch (error) {
      console.error('Error loading mistake tags:', error);
    }
  }

  updateMistakeTagsUI() {
    const tagsChart = document.getElementById('tags-chart');
    
    if (!this.mistakeTags.tagCounts || Object.keys(this.mistakeTags.tagCounts).length === 0) {
      tagsChart.innerHTML = '<div class="tags-empty">No mistake analysis data yet</div>';
      return;
    }

    // Sort tags by count (most common first)
    const sortedTags = Object.entries(this.mistakeTags.tagCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 8); // Show top 8 tags

    let tagsHTML = '<div class="tags-grid">';
    sortedTags.forEach(([tag, count]) => {
      tagsHTML += `
        <div class="tag-item">
          <div class="tag-name">${tag}</div>
          <div class="tag-count">${count}</div>
        </div>
      `;
    });
    tagsHTML += '</div>';

    tagsChart.innerHTML = tagsHTML;
  }
  
  async loadTimeTracking() {
    try {
      // Get the latest time tracking data
      const response = await this.sendMessageToBackground({
        type: 'getTimeTracking'
      });
      
      if (response.success) {
        this.timeTracking = response.timeTracking;
        this.updateTimeTrackingUI();
      }
    } catch (error) {
      console.error('Error loading time tracking data:', error);
    }
  }
  
  updateTimeTrackingUI() {
    const { platforms } = this.timeTracking;
    
    // Update platform times
    document.getElementById('leetcode-time').textContent = this.formatTime(platforms.leetcode.totalTime);
    document.getElementById('geeksforgeeks-time').textContent = this.formatTime(platforms.geeksforgeeks.totalTime);
    document.getElementById('takeuforward-time').textContent = this.formatTime(platforms.takeuforward.totalTime);
    
    // Calculate and update total time
    const totalTime = Object.values(platforms).reduce((sum, platform) => sum + platform.totalTime, 0);
    document.getElementById('total-time').textContent = this.formatTime(totalTime);
    
    // Create time chart visualization
    this.createTimeChart();
  }
  
  createTimeChart() {
    const chartElement = document.getElementById('time-chart');
    const { platforms } = this.timeTracking;
    
    // Get time values
    const leetcodeTime = platforms.leetcode.totalTime;
    const geeksforgeeksTime = platforms.geeksforgeeks.totalTime;
    const takeuforwardTime = platforms.takeuforward.totalTime;
    const totalTime = leetcodeTime + geeksforgeeksTime + takeuforwardTime;
    
    // Don't display chart if no time tracked yet
    if (totalTime === 0) {
      chartElement.innerHTML = '<div class="time-chart-empty">Tracking time spent on DSA platforms</div>';
      return;
    }
    
    // Calculate percentages
    const leetcodePercent = (leetcodeTime / totalTime) * 100;
    const geeksforgeeksPercent = (geeksforgeeksTime / totalTime) * 100;
    const takeuforwardPercent = (takeuforwardTime / totalTime) * 100;
    
    // Create bar chart HTML with staggered animations - white bars as requested
    const chartHtml = `
      <div class="chart-bars">
        <div class="chart-bar-container">
          <div class="chart-bar leetcode" style="width: ${leetcodePercent}%; animation-delay: 0.1s;"></div>
          <div class="chart-label">LeetCode: ${this.formatTime(leetcodeTime)}</div>
        </div>
        <div class="chart-bar-container">
          <div class="chart-bar gfg" style="width: ${geeksforgeeksPercent}%; animation-delay: 0.2s;"></div>
          <div class="chart-label">GFG: ${this.formatTime(geeksforgeeksTime)}</div>
        </div>
        <div class="chart-bar-container">
          <div class="chart-bar tuf" style="width: ${takeuforwardPercent}%; animation-delay: 0.3s;"></div>
          <div class="chart-label">TUF: ${this.formatTime(takeuforwardTime)}</div>
        </div>
      </div>
    `;
    
    chartElement.innerHTML = chartHtml;
  }
  
  formatTime(milliseconds) {
    if (!milliseconds || milliseconds < 1000) return '0h';
    
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m`;
    } else {
      return `${seconds}s`;
    }
  }

  calculateThisWeekCount() {
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    weekStart.setHours(0, 0, 0, 0);

    let weekCount = 0;
    Object.values(this.stats).forEach(data => {
      if (data.lastSolved) {
        const solvedDate = new Date(data.lastSolved);
        if (solvedDate >= weekStart) {
          weekCount += 1;
        }
      }
    });

    return weekCount;
  }

  updateRecentActivity() {
    const activityList = document.getElementById('activity-list');
    
    const activities = [];
    Object.entries(this.stats).forEach(([platform, data]) => {
      if (data.lastSolved) {
        activities.push({
          platform,
          date: new Date(data.lastSolved)
        });
      }
    });

    activities.sort((a, b) => b.date - a.date);

    if (activities.length === 0) {
      activityList.innerHTML = '<div class="activity-empty">No recent activity</div>';
      return;
    }

    activityList.innerHTML = '';
    activities.slice(0, 3).forEach(activity => {
      const item = document.createElement('div');
      item.className = 'activity-item';
      
      const timeAgo = this.formatTimeAgo(activity.date);
      
      item.innerHTML = `
        <span class="activity-platform">${activity.platform}</span>
        <span class="activity-time">${timeAgo}</span>
      `;
      
      activityList.appendChild(item);
    });
  }

  formatTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 60) {
      return `${diffMins}m`;
    } else if (diffHours < 24) {
      return `${diffHours}h`;
    } else if (diffDays < 7) {
      return `${diffDays}d`;
    } else {
      return date.toLocaleDateString();
    }
  }
  
  // Clean up timers when popup is closed
  disconnected() {
    if (this.timeTrackingInterval) {
      clearInterval(this.timeTrackingInterval);
    }
  }

  togglePasswordVisibility(inputId, buttonId) {
    const input = document.getElementById(inputId);
    const toggleBtn = document.getElementById(buttonId);
    
    if (input.type === 'password') {
      input.type = 'text';
      toggleBtn.textContent = 'Hide';
    } else {
      input.type = 'password';
      toggleBtn.textContent = 'Show';
    }
  }

  showMessage(text, type) {
    const messagesContainer = document.getElementById('messages');
    
    const message = document.createElement('div');
    message.className = `message ${type}`;
    message.textContent = text;
    
    messagesContainer.innerHTML = '';
    messagesContainer.appendChild(message);
    
    setTimeout(() => {
      message.remove();
    }, 3000);
  }

  clearMessages() {
    document.getElementById('messages').innerHTML = '';
  }

  async sendMessageToBackground(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, resolve);
    });
  }

  // Authentication methods
  async initializeAuth() {
    try {
      console.log('[Popup] Initializing auth...');
      
      // Check local storage for cached auth data first
      const result = await chrome.storage.local.get(['firebase_user', 'auth_timestamp']);
      if (result.firebase_user && result.auth_timestamp) {
        const now = Date.now();
        const cacheAge = now - result.auth_timestamp;
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        
        if (cacheAge < maxAge) {
          console.log('[Popup] Found valid cached auth data');
          this.authStatus = {
            isAuthenticated: true,
            user: result.firebase_user
          };
          this.updateAuthSection();
        }
      }
      
      // Set up auth utility if available
      if (typeof extensionAuth !== 'undefined') {
        console.log('[Popup] Setting up extension auth listener');
        extensionAuth.onAuthStatusChange((authStatus) => {
          console.log('[Popup] Auth status changed:', authStatus);
          this.authStatus = authStatus;
          this.updateAuthSection();
        });
        
        // Request fresh auth status
        extensionAuth.requestAuthStatus();
      } else {
        console.log('[Popup] Extension auth not available, updating auth section');
        this.updateAuthSection();
      }
      
      // Listen for auth updates from background script
      chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'AUTH_UPDATE') {
          console.log('[Popup] Received auth update from background:', message);
          this.authStatus = {
            isAuthenticated: message.isAuthenticated,
            user: message.user
          };
          this.updateAuthSection();
        }
      });
      
    } catch (error) {
      console.error('Error initializing auth:', error);
    }
  }

  updateAuthSection() {
    const authSection = document.getElementById('auth-section');
    if (!authSection) return;

    if (this.authStatus.isAuthenticated && this.authStatus.user) {
      // User is signed in
      const user = this.authStatus.user;
      const displayName = user.displayName || user.email || 'User';
      const provider = this.getProviderName(user.provider);
      
      authSection.innerHTML = `
        <div class="auth-user">
          <div class="auth-avatar">
            ${user.photoURL 
              ? `<img src="${user.photoURL}" alt="${displayName}" />`
              : `<div class="default-avatar">👤</div>`
            }
          </div>
          <div class="auth-user-info">
            <div class="auth-user-name">${displayName}</div>
            <div class="auth-user-email">${user.email || ''}</div>
            <div class="auth-provider">via ${provider}</div>
          </div>
        </div>
        <div class="auth-actions">
          <button class="btn btn-primary" id="website-btn">Website</button>
          <button class="btn sign-out" id="sign-out-btn">Sign Out</button>
        </div>
        <div class="sync-status synced">✓ Synced with website</div>
      `;
      
      // Add event listeners for the buttons
      const websiteBtn = document.getElementById('website-btn');
      const signOutBtn = document.getElementById('sign-out-btn');
      
      if (websiteBtn) {
        websiteBtn.addEventListener('click', () => this.openWebsite());
      }
      if (signOutBtn) {
        signOutBtn.addEventListener('click', () => this.signOut());
      }
    } else {
      // User is not signed in
      authSection.innerHTML = `
        <div class="auth-sign-in">
          <div class="auth-sign-in-text">
            Sign in to sync your progress across devices and access premium features.
          </div>
          <button class="btn btn-primary" id="sign-in-btn">Sign In</button>
          <div class="sync-status">Not synced</div>
        </div>
      `;
      
      // Add event listener for sign in button
      const signInBtn = document.getElementById('sign-in-btn');
      if (signInBtn) {
        signInBtn.addEventListener('click', () => this.openSignIn());
      }
    }
  }

  getProviderName(provider) {
    switch (provider) {
      case 'google.com':
        return 'Google';
      case 'apple.com':
        return 'Apple';
      default:
        return provider || 'Unknown';
    }
  }

  async openSignIn() {
    try {
      console.log('[Popup] Opening sign in...');
      
      if (typeof extensionAuth !== 'undefined') {
        await extensionAuth.openSignIn();
        
        // Set up periodic check for auth status after opening website
        const checkInterval = setInterval(async () => {
          await extensionAuth.requestAuthStatus();
        }, 2000);
        
        // Stop checking after 30 seconds
        setTimeout(() => {
          clearInterval(checkInterval);
        }, 30000);
        
      } else {
        // Fallback: try different URLs for development/production
        const urls = [
          'http://localhost:5173',
          'http://localhost:3000', 
          'https://leetfeedback.vercel.app'
        ];
        
        chrome.tabs.create({
          url: urls[0], // Try localhost first
          active: true
        });
      }
    } catch (error) {
      console.error('Error opening sign in:', error);
      this.showMessage('Failed to open sign in. Please try again.', 'error');
    }
  }

  async openWebsite() {
    try {
      // Try to find existing tab first
      const tabs = await chrome.tabs.query({ 
        url: [
          'https://leet-feedback.vercel.app/*'
        ]
      });
      
      if (tabs.length > 0) {
        // Focus existing tab
        chrome.tabs.update(tabs[0].id, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
      } else {
        // Create new tab
        chrome.tabs.create({
          url: 'https://leet-feedback.vercel.app',
          active: true
        });
      }
    } catch (error) {
      console.error('Error opening website:', error);
    }
  }

  async signOut() {
    try {
      if (typeof extensionAuth !== 'undefined') {
        await extensionAuth.signOut();
        // Update local auth status
        this.authStatus = { isAuthenticated: false, user: null };
        this.updateAuthSection();
        this.showMessage('Signed out successfully', 'success');
      } else {
        // Fallback: clear local storage
        await chrome.storage.local.remove(['firebase_user', 'auth_timestamp']);
        this.authStatus = { isAuthenticated: false, user: null };
        this.updateAuthSection();
        this.showMessage('Signed out locally', 'success');
      }
    } catch (error) {
      console.error('Error signing out:', error);
      // Even if sign out fails, clear local state
      await chrome.storage.local.remove(['firebase_user', 'auth_timestamp']);
      this.authStatus = { isAuthenticated: false, user: null };
      this.updateAuthSection();
      this.showMessage('Failed to sign out from website, but cleared local session.', 'warning');
    }
  }
}

// Global reference for inline event handlers
let popupController;

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  popupController = new PopupController();
});