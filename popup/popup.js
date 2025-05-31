class PopupController {
  constructor() {
    this.config = {};
    this.stats = {};
    this.connectionStatus = false;
    this.initialize();
  }

  async initialize() {
    await this.loadStoredData();
    this.setupEventListeners();
    this.updateUI();
    this.updateConnectionStatus();
    this.loadStatistics();
  }

  setupEventListeners() {
    // Tab navigation
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
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
      this.togglePasswordVisibility();
    });

    // Real-time validation
    ['token', 'owner', 'repo'].forEach(id => {
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
        'debug_mode',
        'dsa_stats'
      ], (data) => {
        this.config = {
          token: data.github_token || '',
          owner: data.github_owner || '',
          repo: data.github_repo || '',
          branch: data.github_branch || 'main',
          debugMode: data.debug_mode || false
        };
        this.stats = data.dsa_stats || {};
        resolve();
      });
    });
  }

  updateUI() {
    document.getElementById('token').value = this.config.token;
    document.getElementById('owner').value = this.config.owner;
    document.getElementById('repo').value = this.config.repo;
    document.getElementById('branch').value = this.config.branch;
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
    }
  }

  async saveConfiguration() {
    const formData = this.collectFormData();
    
    if (!this.validateFormData(formData)) {
      return;
    }

    try {
      await chrome.storage.sync.set({
        github_token: formData.token,
        github_owner: formData.owner,
        github_repo: formData.repo,
        github_branch: formData.branch,
        debug_mode: formData.debugMode
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

    } catch (error) {
      console.error('Error loading statistics:', error);
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

  togglePasswordVisibility() {
    const tokenInput = document.getElementById('token');
    const toggleBtn = document.getElementById('toggle-token');

    if (tokenInput.type === 'password') {
      tokenInput.type = 'text';
      toggleBtn.textContent = 'Hide';
    } else {
      tokenInput.type = 'password';
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
}

// Initialize popup
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});