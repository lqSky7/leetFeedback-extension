class PopupController {
  constructor() {
    this.config = {};
    this.stats = {};
    this.timeTracking = {};
    this.connectionStatus = false;
  this.authStatus = { isAuthenticated: false, user: null, token: null };
    this.tasks = [];
    this.scheduledTasks = [];
    this.initialize();
  }

  async initialize() {
    await this.loadStoredData();
    await this.initializeAuth();
    this.setupEventListeners();
    this.updateUI();
    this.updateConnectionStatus();
    this.initializePlatformIcons();
  }

  initializePlatformIcons() {
    // Add subtle hover animation to platform icons
    document.querySelectorAll(".platform-icon").forEach((icon) => {
      icon.addEventListener("mouseover", () => {
        setTimeout(() => (icon.style.transform = "scale(1.1)"), 0);
      });
      icon.addEventListener("mouseout", () => {
        setTimeout(() => (icon.style.transform = "scale(1.0)"), 0);
      });
    });
  }

  setupEventListeners() {
    // Tab navigation with animation
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", (e) => {
        const ripple = document.createElement("span");
        ripple.classList.add("tab-ripple");
        e.target.appendChild(ripple);
        setTimeout(() => ripple.remove(), 600);

        this.switchTab(e.target.dataset.tab);
      });
    });

    // Debounced save for config form
    const debouncedSave = this.debounce(() => this.saveConfiguration(), 500);

    ["token", "owner", "repo", "gemini-key", "branch"].forEach((id) => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener("input", () => {
          debouncedSave();
        });
      }
    });

    // Toggle password visibility
    document.getElementById("toggle-token").addEventListener("click", () => {
      this.togglePasswordVisibility("token", "toggle-token");
    });

    // Toggle Gemini key visibility
    document.getElementById("toggle-gemini").addEventListener("click", () => {
      this.togglePasswordVisibility("gemini-key", "toggle-gemini");
    });

    // GitHub token link
    document.querySelector(".token-link").addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: e.target.href });
    });

    // Stats redirect button
    const statsRedirectBtn = document.getElementById("stats-redirect-btn");
    if (statsRedirectBtn) {
      statsRedirectBtn.addEventListener("click", () => {
        chrome.tabs.create({ url: "https://leet-feedback.vercel.app/profile/stats" });
      });
    }

    // Prediction functionality
    const generateBtn = document.getElementById("generate-schedule");
    if (generateBtn) {
      generateBtn.addEventListener("click", () => this.generateSchedule());
    }

    const clearBtn = document.getElementById("clear-schedule");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => this.clearScheduledTasks());
    }

    const focusModeSelect = document.getElementById("focus-mode");
    if (focusModeSelect) {
      focusModeSelect.addEventListener("change", () => this.updateFocusModeDescription());
    }

    const grandparentFilter = document.getElementById("grandparent-filter");
    if (grandparentFilter) {
      grandparentFilter.addEventListener("change", () => this.updateParentTopicOptions());
    }
  }

  setupAuthForms(authSection) {
    const toggleButtons = authSection.querySelectorAll(".auth-toggle-btn");
    const forms = authSection.querySelectorAll(".auth-form");

    const setActiveForm = (target) => {
      toggleButtons.forEach((btn) => {
        if (btn.dataset.target === target) {
          btn.classList.add("active");
        } else {
          btn.classList.remove("active");
        }
      });

      forms.forEach((form) => {
        form.classList.toggle("active", form.dataset.form === target);
      });
    };

    toggleButtons.forEach((button) => {
      button.addEventListener("click", () => {
        if (button.classList.contains("active")) return;
        setActiveForm(button.dataset.target);
        this.showAuthFeedback();
      });
    });

    const loginForm = authSection.querySelector("#auth-login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", (event) =>
        this.handleLoginSubmit(event),
      );
    }

    const registerForm = authSection.querySelector("#auth-register-form");
    if (registerForm) {
      registerForm.addEventListener("submit", (event) =>
        this.handleRegisterSubmit(event),
      );
    }

    const configEditBtn = authSection.querySelector("#auth-config-edit");
    if (configEditBtn) {
      configEditBtn.addEventListener("click", () => {
        this.switchTab("config");
        this.showAuthFeedback(
          "info",
          "Update your GitHub details in the Config tab.",
        );
      });
    }

    this.refreshAuthConfigSummary();
  }

  activateAuthForm(target) {
    const authSection = document.getElementById("auth-section");
    if (!authSection) return;

    const toggleButtons = authSection.querySelectorAll(".auth-toggle-btn");
    const forms = authSection.querySelectorAll(".auth-form");

    toggleButtons.forEach((button) => {
      if (button.dataset.target === target) {
        button.classList.add("active");
      } else {
        button.classList.remove("active");
      }
    });

    forms.forEach((form) => {
      form.classList.toggle("active", form.dataset.form === target);
    });
  }

  async handleLoginSubmit(event) {
    event.preventDefault();

    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);

    const payload = {
      email: formData.get("email")?.toString().trim(),
      password: formData.get("password"),
    };

    if (!payload.email || !payload.password) {
      this.showAuthFeedback("error", "Please fill in all login fields.");
      return;
    }

    try {
      this.toggleAuthLoading(submitBtn, true, "Logging in...");
      const result = await extensionAuth.login(payload);
      const welcomeName =
        result?.user?.username || result?.user?.email || "User";
      this.showAuthFeedback("success", `Welcome back, ${welcomeName}!`);
      form.reset();
    } catch (error) {
      this.showAuthFeedback(
        "error",
        error?.message || "Login failed. Please try again.",
      );
    } finally {
      this.toggleAuthLoading(submitBtn, false);
    }
  }

  async handleRegisterSubmit(event) {
    event.preventDefault();

    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const config = this.collectFormData();

    const payload = {
      username: formData.get("username")?.toString().trim(),
      email: formData.get("email")?.toString().trim(),
      password: formData.get("password"),
      github_username: config.owner?.trim(),
      github_repo: config.repo?.trim(),
      github_branch: config.branch?.trim() || "main",
    };

    if (!payload.username || !payload.email || !payload.password) {
      this.showAuthFeedback("error", "Please complete all required fields.");
      return;
    }

    if (!payload.github_username || !payload.github_repo) {
      this.showAuthFeedback(
        "error",
        "Set your GitHub username and repository in the Config tab before registering.",
      );
      this.refreshAuthConfigSummary();
      return;
    }

    try {
      this.toggleAuthLoading(submitBtn, true, "Creating account...");
      const result = await extensionAuth.register(payload);

      if (result?.token) {
        const displayName =
          result.user?.username || result.user?.email || "User";
        this.showAuthFeedback(
          "success",
          `Account ready, ${displayName}! You're signed in.`,
        );
      } else {
        this.showAuthFeedback(
          "info",
          "Account created. Please log in with your new credentials.",
        );
        this.activateAuthForm("login");
      }

      form.reset();
    } catch (error) {
      this.showAuthFeedback(
        "error",
        error?.message || "Registration failed. Please try again.",
      );
    } finally {
      this.toggleAuthLoading(submitBtn, false);
    }
  }

  toggleAuthLoading(button, isLoading, loadingText = "Working...") {
    if (!button) return;

    if (isLoading) {
      button.dataset.originalText = button.textContent;
      button.textContent = loadingText;
      button.disabled = true;
    } else {
      const original = button.dataset.originalText;
      if (original) {
        button.textContent = original;
        delete button.dataset.originalText;
      }
      button.disabled = false;
    }
  }

  showAuthFeedback(type = "", message = "") {
    const messageElement = document.getElementById("auth-form-message");
    if (!messageElement) return;

    messageElement.textContent = message || "";
    messageElement.className = "auth-form-message";

    if (type && message) {
      messageElement.classList.add(type);
    }
  }

  refreshAuthConfigSummary() {
    const summaryEl = document.getElementById("auth-config-summary");
    if (!summaryEl) return;

    const config = this.collectFormData();
    const owner = config.owner?.trim() || "";
    const repo = config.repo?.trim() || "";
    const branch = config.branch?.trim() || "main";

    const updateValue = (elementId, value, fallback = "Not set") => {
      const el = document.getElementById(elementId);
      if (!el) return;
      const isEmpty = !value;
      el.textContent = isEmpty ? fallback : value;
      el.classList.toggle("empty", isEmpty);
    };

    updateValue("auth-config-username", owner);
    updateValue("auth-config-repo", repo);
    updateValue("auth-config-branch", branch);
  }

  debounce(func, wait) {
    let timeout;
    return function (...args) {
      const context = this;
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(context, args), wait);
    };
  }

  async loadStoredData() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        [
          "github_token",
          "github_owner",
          "github_repo",
          "github_branch",
          "gemini_api_key",
          "debug_mode",
          "dsa_stats",
          "time_tracking",
          "mistake_tags",
        ],
        (data) => {
          this.config = {
            token: data.github_token || "",
            owner: data.github_owner || "",
            repo: data.github_repo || "",
            branch: data.github_branch || "main",
            geminiKey: data.gemini_api_key || "",
            debugMode: data.debug_mode || false,
          };
          this.stats = data.dsa_stats || {};
          this.timeTracking = data.time_tracking || {
            platforms: {
              leetcode: { totalTime: 0, lastActive: null, isActive: false },
              geeksforgeeks: {
                totalTime: 0,
                lastActive: null,
                isActive: false,
              },
              takeuforward: { totalTime: 0, lastActive: null, isActive: false },
            },
            lastUpdated: new Date().toISOString(),
          };
          this.mistakeTags = data.mistake_tags || {};
          resolve();
        },
      );
    });
  }

  updateUI() {
    document.getElementById("token").value = this.config.token;
    document.getElementById("owner").value = this.config.owner;
    document.getElementById("repo").value = this.config.repo;
    document.getElementById("branch").value = this.config.branch;
    document.getElementById("gemini-key").value = this.config.geminiKey;
    document.getElementById("debug-mode").checked = this.config.debugMode;

    this.refreshAuthConfigSummary();
  }

  switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.remove("active");
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add("active");

    // Update tab panels
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.remove("active");
    });
    document.getElementById(tabName).classList.add("active");

    if (tabName === "prediction") {
      this.loadTaskData();
    } else if (tabName === "settings") {
      // Ensure debug checkbox is properly loaded with current value
      document.getElementById("debug-mode").checked =
        this.config.debugMode || false;
      this.updateAuthSection();
      console.log("Settings tab loaded. Debug mode:", this.config.debugMode);
    }
  }

  async saveConfiguration() {
    const formData = this.collectFormData();

    try {
      chrome.storage.sync.set(
        {
          github_token: formData.token,
          github_owner: formData.owner,
          github_repo: formData.repo,
          github_branch: formData.branch,
          gemini_api_key: formData.geminiKey,
          debug_mode: formData.debugMode,
        },
        () => {},
      );

      this.config = formData;

      this.refreshAuthConfigSummary();

      setTimeout(() => {
        this.updateConnectionStatus();
      }, 500);
    } catch (error) {
      console.error(`Failed to save: ${error.message}`);
    }
  }

  collectFormData() {
    return {
      token: document.getElementById("token").value.trim(),
      owner: document.getElementById("owner").value.trim(),
      repo: document.getElementById("repo").value.trim(),
      branch: document.getElementById("branch").value.trim() || "main",
      geminiKey: document.getElementById("gemini-key").value.trim(),
      debugMode: document.getElementById("debug-mode").checked,
    };
  }

  updateConnectionStatus() {
    const statusDot = document.getElementById("status-dot");
    const statusText = document.getElementById("status-text");

    const isConfigured =
      this.config.token && this.config.owner && this.config.repo;

    if (isConfigured && this.connectionStatus) {
      statusDot.classList.add("connected");
      statusText.textContent = "Connected";
    } else if (isConfigured) {
      statusDot.classList.remove("connected");
      statusText.textContent = "Configured";
    } else {
      statusDot.classList.remove("connected");
      statusText.textContent = "Disconnected";
    }
  }

  async loadStatistics() {
    try {
      const result = await chrome.storage.sync.get(["dsa_stats"]);
      this.stats = result.dsa_stats || {};

      let totalSolved = 0;
      let leetcodeCount = 0;
      let geeksforgeeksCount = 0;
      let takeuforwardCount = 0;

      Object.entries(this.stats).forEach(([platform, data]) => {
        const count = data.solved || 0;
        totalSolved += count;

        if (platform === "leetcode") leetcodeCount = count;
        if (platform === "geeksforgeeks") geeksforgeeksCount = count;
        if (platform === "takeuforward") takeuforwardCount = count;
      });

      document.getElementById("total-solved").textContent = totalSolved;
      document.getElementById("leetcode-count").textContent = leetcodeCount;
      document.getElementById("geeksforgeeks-count").textContent =
        geeksforgeeksCount;
      document.getElementById("takeuforward-count").textContent =
        takeuforwardCount;

      const weekCount = this.calculateThisWeekCount();
      document.getElementById("this-week").textContent = weekCount;

      this.updateRecentActivity();
      this.loadMistakeTags();
    } catch (error) {
      console.error("Error loading statistics:", error);
    }
  }

  async loadMistakeTags() {
    try {
      const result = await chrome.storage.sync.get(["mistake_tags"]);
      this.mistakeTags = result.mistake_tags || {};

      this.updateMistakeTagsUI();
    } catch (error) {
      console.error("Error loading mistake tags:", error);
    }
  }

  updateMistakeTagsUI() {
    const tagsChart = document.getElementById("tags-chart");

    if (
      !this.mistakeTags.tagCounts ||
      Object.keys(this.mistakeTags.tagCounts).length === 0
    ) {
      tagsChart.innerHTML =
        '<div class="tags-empty">No mistake analysis data yet</div>';
      return;
    }

    // Sort tags by count (most common first)
    const sortedTags = Object.entries(this.mistakeTags.tagCounts)
      .sort(([, a], [, b]) => b - a)
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
    tagsHTML += "</div>";

    tagsChart.innerHTML = tagsHTML;
  }

  async loadTimeTracking() {
    try {
      // Get the latest time tracking data
      const response = await this.sendMessageToBackground({
        type: "getTimeTracking",
      });

      if (response.success) {
        this.timeTracking = response.timeTracking;
        this.updateTimeTrackingUI();
      }
    } catch (error) {
      console.error("Error loading time tracking data:", error);
    }
  }

  updateTimeTrackingUI() {
    const { platforms } = this.timeTracking;

    // Update platform times
    document.getElementById("leetcode-time").textContent = this.formatTime(
      platforms.leetcode.totalTime,
    );
    document.getElementById("geeksforgeeks-time").textContent = this.formatTime(
      platforms.geeksforgeeks.totalTime,
    );
    document.getElementById("takeuforward-time").textContent = this.formatTime(
      platforms.takeuforward.totalTime,
    );

    // Calculate and update total time
    const totalTime = Object.values(platforms).reduce(
      (sum, platform) => sum + platform.totalTime,
      0,
    );
    document.getElementById("total-time").textContent =
      this.formatTime(totalTime);

    // Create time chart visualization
    this.createTimeChart();
  }

  createTimeChart() {
    const chartElement = document.getElementById("time-chart");
    const { platforms } = this.timeTracking;

    // Get time values
    const leetcodeTime = platforms.leetcode.totalTime;
    const geeksforgeeksTime = platforms.geeksforgeeks.totalTime;
    const takeuforwardTime = platforms.takeuforward.totalTime;
    const totalTime = leetcodeTime + geeksforgeeksTime + takeuforwardTime;

    // Don't display chart if no time tracked yet
    if (totalTime === 0) {
      chartElement.innerHTML =
        '<div class="time-chart-empty">Tracking time spent on DSA platforms</div>';
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
    if (!milliseconds || milliseconds < 1000) return "0h";

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
    Object.values(this.stats).forEach((data) => {
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
    const activityList = document.getElementById("activity-list");

    const activities = [];
    Object.entries(this.stats).forEach(([platform, data]) => {
      if (data.lastSolved) {
        activities.push({
          platform,
          date: new Date(data.lastSolved),
        });
      }
    });

    activities.sort((a, b) => b.date - a.date);

    if (activities.length === 0) {
      activityList.innerHTML =
        '<div class="activity-empty">No recent activity</div>';
      return;
    }

    activityList.innerHTML = "";
    activities.slice(0, 3).forEach((activity) => {
      const item = document.createElement("div");
      item.className = "activity-item";

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

    if (input.type === "password") {
      input.type = "text";
      toggleBtn.textContent = "Hide";
    } else {
      input.type = "password";
      toggleBtn.textContent = "Show";
    }
  }

  async sendMessageToBackground(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, resolve);
    });
  }

  // Authentication methods
  async initializeAuth() {
    try {
      console.log("[Popup] Initializing auth...");

      // Check local storage for cached auth data first
      const result = await chrome.storage.local.get([
        "auth_user",
        "auth_token",
        "auth_timestamp",
        "firebase_user",
      ]);

      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      if (result.auth_user && result.auth_timestamp) {
        const cacheAge = now - result.auth_timestamp;
        if (cacheAge < maxAge) {
          console.log("[Popup] Found cached backend auth data");
          this.authStatus = {
            isAuthenticated: true,
            user: result.auth_user,
            token: result.auth_token || null,
          };
          this.updateAuthSection();
        }
      } else if (result.firebase_user && result.auth_timestamp) {
        const cacheAge = now - result.auth_timestamp;
        if (cacheAge < maxAge) {
          console.log("[Popup] Found legacy cached auth data");
          this.authStatus = {
            isAuthenticated: true,
            user: result.firebase_user,
            token: result.auth_token || null,
          };
          this.updateAuthSection();
        }
      }

      // Set up auth utility if available
      if (typeof extensionAuth !== "undefined") {
        console.log("[Popup] Setting up extension auth listener");
        extensionAuth.onAuthStatusChange((authStatus) => {
          console.log("[Popup] Auth status changed:", authStatus);
          this.authStatus = {
            isAuthenticated: authStatus.isAuthenticated,
            user: authStatus.user || null,
            token: authStatus.token || null,
          };
          this.updateAuthSection();
        });

        // Request fresh auth status
        extensionAuth.requestAuthStatus();
      } else {
        console.log(
          "[Popup] Extension auth not available, updating auth section",
        );
        this.updateAuthSection();
      }

      // Listen for auth updates from background script
      chrome.runtime.onMessage.addListener((message) => {
        if (message.type === "AUTH_UPDATE") {
          console.log("[Popup] Received auth update from background:", message);
          this.authStatus = {
            isAuthenticated: message.isAuthenticated,
            user: message.user,
            token: this.authStatus.token || null,
          };
          this.updateAuthSection();
        }
      });
    } catch (error) {
      console.error("Error initializing auth:", error);
    }
  }

  updateAuthSection() {
    const authSection = document.getElementById("auth-section");
    if (!authSection) return;

    const isAuthenticated =
      this.authStatus?.isAuthenticated && this.authStatus.user;

    if (isAuthenticated) {
      const user = this.authStatus.user || {};
      const displayName =
        user.username ||
        user.displayName ||
        user.name ||
        user.email ||
        "User";
      const emailRow = user.email
        ? `<div class="auth-user-email">${user.email}</div>`
        : "";
      const avatarMarkup = user.photoURL
        ? `<img src="${user.photoURL}" alt="${displayName}" />`
        : `<div class="default-avatar">👤</div>`;

      const metaItems = [];
      const githubUsername = user.github_username || user.githubUsername;
      const githubRepo = user.github_repo || user.githubRepo;
      const githubBranch = user.github_branch || user.githubBranch;

      if (githubUsername || githubRepo) {
        metaItems.push(`
          <div class="auth-meta-item">
            <span class="auth-meta-label">GitHub</span>
            <span class="auth-meta-value">${githubUsername || "N/A"}${githubRepo ? `/${githubRepo}` : ""}</span>
          </div>
        `);
      }

      if (githubBranch) {
        metaItems.push(`
          <div class="auth-meta-item">
            <span class="auth-meta-label">Branch</span>
            <span class="auth-meta-value">${githubBranch}</span>
          </div>
        `);
      }

      const tokenPreview =
        this.authStatus.token && this.authStatus.token.length > 12
          ? `${this.authStatus.token.slice(0, 6)}…${this.authStatus.token.slice(-4)}`
          : this.authStatus.token || "Active";

      metaItems.push(`
        <div class="auth-meta-item">
          <span class="auth-meta-label">Session</span>
          <span class="auth-meta-value">${tokenPreview}</span>
        </div>
      `);

      const metaHtml =
        metaItems.length > 0
          ? `<div class="auth-meta">${metaItems.join("")}</div>`
          : "";

      authSection.innerHTML = `
        <div class="auth-user">
          <div class="auth-avatar">
            ${avatarMarkup}
          </div>
          <div class="auth-user-info">
            <div class="auth-user-name">${displayName}</div>
            ${emailRow}
            <div class="auth-provider">Backend session active</div>
          </div>
        </div>
        ${metaHtml}
        <div class="auth-actions">
          <button class="btn btn-primary" id="website-btn">Website</button>
          <button class="btn sign-out" id="sign-out-btn">Sign Out</button>
        </div>
        <div class="sync-status synced">✓ Connected to LeetFeedback backend</div>
      `;

      const websiteBtn = document.getElementById("website-btn");
      const signOutBtn = document.getElementById("sign-out-btn");

      if (websiteBtn) {
        websiteBtn.addEventListener("click", () => this.openWebsite());
      }
      if (signOutBtn) {
        signOutBtn.addEventListener("click", () => this.signOut());
      }
    } else {
      authSection.innerHTML = `
        <div class="auth-card">
          <div class="auth-toggle">
            <button class="auth-toggle-btn active" data-target="login">Login</button>
            <button class="auth-toggle-btn" data-target="register">Register</button>
          </div>
          <form class="auth-form active" id="auth-login-form" data-form="login">
            <div class="field">
              <label for="auth-login-email">Email</label>
              <input type="email" id="auth-login-email" name="email" placeholder="admin@example.com" autocomplete="email" required />
            </div>
            <div class="field">
              <label for="auth-login-password">Password</label>
              <input type="password" id="auth-login-password" name="password" placeholder="••••••••" autocomplete="current-password" required />
            </div>
            <button type="submit" class="btn btn-primary" id="auth-login-submit">Login</button>
          </form>
          <form class="auth-form" id="auth-register-form" data-form="register">
            <div class="field">
              <label for="auth-register-username">Username</label>
              <input type="text" id="auth-register-username" name="username" placeholder="admin" required />
            </div>
            <div class="field">
              <label for="auth-register-email">Email</label>
              <input type="email" id="auth-register-email" name="email" placeholder="admin@example.com" required />
            </div>
            <div class="field">
              <label for="auth-register-password">Password</label>
              <input type="password" id="auth-register-password" name="password" placeholder="Create a password" autocomplete="new-password" required />
            </div>
            <div class="auth-config-summary" id="auth-config-summary">
              <div class="auth-config-item">
                <span class="auth-config-label">GitHub Username</span>
                <span class="auth-config-value" id="auth-config-username"></span>
              </div>
              <div class="auth-config-item">
                <span class="auth-config-label">Repository</span>
                <span class="auth-config-value" id="auth-config-repo"></span>
              </div>
              <div class="auth-config-item">
                <span class="auth-config-label">Branch</span>
                <span class="auth-config-value" id="auth-config-branch"></span>
              </div>
            </div>
            <div class="auth-config-note">
              Managed from the Config tab.
              <button type="button" class="auth-config-edit" id="auth-config-edit">Open Config</button>
            </div>
            <button type="submit" class="btn btn-primary" id="auth-register-submit">Create Account</button>
          </form>
          <div class="auth-form-message" id="auth-form-message"></div>
        </div>
      `;

      this.setupAuthForms(authSection);
      this.showAuthFeedback();
    }
  }

  getProviderName(provider) {
    switch (provider) {
      case "google.com":
        return "Google";
      case "apple.com":
        return "Apple";
      default:
        return provider || "Unknown";
    }
  }

  async openSignIn() {
    try {
      console.log("[Popup] Opening sign in...");

      if (typeof extensionAuth !== "undefined") {
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
          "http://localhost:5173",
          "http://localhost:3000",
          "https://leetfeedback.vercel.app",
        ];

        chrome.tabs.create({
          url: urls[0], // Try localhost first
          active: true,
        });
      }
    } catch (error) {
      console.error("Error opening sign in:", error);
      this.showMessage("Failed to open sign in. Please try again.", "error");
    }
  }

  async openWebsite() {
    try {
      // Try to find existing tab first
      const tabs = await chrome.tabs.query({
        url: ["https://leet-feedback.vercel.app/*"],
      });

      if (tabs.length > 0) {
        // Focus existing tab
        chrome.tabs.update(tabs[0].id, { active: true });
        chrome.windows.update(tabs[0].windowId, { focused: true });
      } else {
        // Create new tab
        chrome.tabs.create({
          url: "https://leet-feedback.vercel.app",
          active: true,
        });
      }
    } catch (error) {
      console.error("Error opening website:", error);
    }
  }

  async signOut() {
    try {
      if (typeof extensionAuth !== "undefined") {
        await extensionAuth.signOut();
        // Update local auth status
        this.authStatus = { isAuthenticated: false, user: null, token: null };
        this.updateAuthSection();
        this.showMessage("Signed out successfully", "success");
        this.showAuthFeedback("success", "Signed out successfully.");
      } else {
        // Fallback: clear local storage
        await chrome.storage.local.remove([
          "auth_user",
          "auth_token",
          "auth_timestamp",
          "firebase_user",
        ]);
        this.authStatus = { isAuthenticated: false, user: null, token: null };
        this.updateAuthSection();
        this.showMessage("Signed out locally", "success");
        this.showAuthFeedback("success", "Signed out locally.");
      }
    } catch (error) {
      console.error("Error signing out:", error);
      // Even if sign out fails, clear local state
      await chrome.storage.local.remove([
        "auth_user",
        "auth_token",
        "auth_timestamp",
        "firebase_user",
      ]);
      this.authStatus = { isAuthenticated: false, user: null, token: null };
      this.updateAuthSection();
      this.showMessage(
        "Failed to sign out from website, but cleared local session.",
        "warning",
      );
      this.showAuthFeedback(
        "warning",
        "Failed to sign out remotely. Local session cleared.",
      );
    }
  }

  // Prediction functionality methods
  async loadTaskData() {
    try {
      const response = await fetch("../data.json");
      if (!response.ok) {
        throw new Error(`Failed to load tasks: ${response.status}`);
      }
      this.tasks = await response.json();

      // Load saved ignore status
      await this.loadTaskIgnoreStatus();

      console.log(`Loaded ${this.tasks.length} tasks for prediction`);
      this.updateTaskStatistics();
      this.populateFilterOptions();

      // Load and display saved scheduled tasks if they exist
      const hasSavedTasks = await this.loadScheduledTasks();
      if (hasSavedTasks && this.scheduledTasks.length > 0) {
        await this.displayScheduledTasks();
        this.updateScheduledCount();
        this.showPredictionResults(true);
      }

      // Update button text based on whether we have saved tasks
      this.updateGenerateButtonText();
    } catch (error) {
      console.error("Error loading task data:", error);
      this.showPredictionError(`Failed to load tasks: ${error.message}`);
    }
  }

  populateFilterOptions() {
    const grandparentSelect = document.getElementById("grandparent-filter");
    const parentSelect = document.getElementById("parent-filter");
    if (!grandparentSelect || !parentSelect) return;

    // Get unique grandparents and parent topics
    const grandparents = [...new Set(this.tasks.map(task => task.grandparent))].sort();
    const parentTopics = [...new Set(this.tasks.map(task => task.parent_topic))].sort();

    // Populate grandparent filter
    grandparentSelect.innerHTML = '<option value="">All Categories</option>';
    grandparents.forEach(gp => {
      const option = document.createElement("option");
      option.value = gp;
      option.textContent = gp;
      grandparentSelect.appendChild(option);
    });

    // Populate parent topic filter
    parentSelect.innerHTML = '<option value="">All Topics</option>';
    parentTopics.forEach(pt => {
      const option = document.createElement("option");
      option.value = pt;
      option.textContent = pt;
      parentSelect.appendChild(option);
    });
  }

  updateParentTopicOptions() {
    const grandparentSelect = document.getElementById("grandparent-filter");
    const parentSelect = document.getElementById("parent-filter");
    if (!grandparentSelect || !parentSelect) return;

    const selectedGrandparents = Array.from(grandparentSelect.selectedOptions)
      .map(option => option.value)
      .filter(value => value !== "");

    let availableParents;
    if (selectedGrandparents.length > 0) {
      availableParents = [...new Set(
        this.tasks
          .filter(task => selectedGrandparents.includes(task.grandparent))
          .map(task => task.parent_topic)
      )].sort();
    } else {
      availableParents = [...new Set(this.tasks.map(task => task.parent_topic))].sort();
    }

    const currentValue = parentSelect.value;
    parentSelect.innerHTML = '<option value="">All Topics</option>';
    
    availableParents.forEach(pt => {
      const option = document.createElement("option");
      option.value = pt;
      option.textContent = pt;
      if (pt === currentValue) option.selected = true;
      parentSelect.appendChild(option);
    });
  }

  updateTaskStatistics() {
    if (typeof window.PredictionAlgorithm !== "object") return;

    const stats = window.PredictionAlgorithm.getTaskStatistics(this.tasks);
    
    document.getElementById("total-tasks").textContent = stats.total;
    document.getElementById("active-tasks").textContent = stats.active;
    document.getElementById("solved-tasks").textContent = stats.solved;
    document.getElementById("unsolved-tasks").textContent = stats.unsolved;
    document.getElementById("ignored-tasks").textContent = stats.ignored;

    const statsSection = document.getElementById("prediction-stats");
    if (statsSection) {
      statsSection.style.display = "block";
    }
  }

  updateFocusModeDescription() {
    const focusMode = parseInt(document.getElementById("focus-mode").value) || 1;
    const descElement = document.getElementById("focus-description");
    if (!descElement) return;

    const descriptions = {
      0: "100% revision problems",
      1: "70% revision problems, 30% new problems",
      2: "30% revision problems, 70% new problems",
      3: "100% new problems"
    };

    descElement.textContent = descriptions[focusMode] || descriptions[1];
  }

  async generateSchedule() {
    if (!this.tasks.length) {
      this.showPredictionError("No tasks loaded. Please try refreshing the extension.");
      return;
    }

    // Check if prediction functions are available
    if (typeof window.PredictionAlgorithm !== "object" || 
        typeof window.PredictionAlgorithm.scheduleToday !== "function") {
      this.showPredictionError("Prediction algorithm not loaded. Please try refreshing.");
      return;
    }

    try {
      this.showPredictionLoading(true);
      this.hidePredictionError();

      const targetCount = parseInt(document.getElementById("target-count").value) || 10;
      const focusMode = parseInt(document.getElementById("focus-mode").value) || 1;

      // Add small delay to show loading state
      await new Promise(resolve => setTimeout(resolve, 300));

      // Generate schedule using the prediction algorithm
      const grandparentSelect = document.getElementById("grandparent-filter");
      const selectedGrandparents = Array.from(grandparentSelect.selectedOptions)
        .map(option => option.value)
        .filter(value => value !== "");

      const filters = {
        grandparent: selectedGrandparents.length > 0 ? selectedGrandparents : null,
        parent_topic: document.getElementById("parent-filter").value || null,
      };

      this.scheduledTasks = window.PredictionAlgorithm.scheduleToday(
        this.tasks,
        targetCount,
        focusMode,
        filters
      );

      // Save the generated schedule to storage
      await this.saveScheduledTasks();

      // Update button text to indicate schedule is saved
      this.updateGenerateButtonText();

      await this.displayScheduledTasks();
      this.updateScheduledCount();
    } catch (error) {
      console.error("Error generating schedule:", error);
      this.showPredictionError(`Schedule generation failed: ${error.message}`);
    } finally {
      this.showPredictionLoading(false);
    }
  }

  async displayScheduledTasks() {
    const taskList = document.getElementById("task-list");
    const timestampElement = document.getElementById("schedule-timestamp");
    if (!taskList) return;

    taskList.innerHTML = "";

    if (this.scheduledTasks.length === 0) {
      taskList.innerHTML = `
        <div class="task-item">
          <span class="task-name">No tasks to schedule with current settings.</span>
        </div>
      `;
      if (timestampElement) timestampElement.textContent = "";
      this.showPredictionResults(true);
      return;
    }

    // Show timestamp if we have saved schedule data
    if (timestampElement) {
      try {
        const data = await chrome.storage.local.get(["scheduledTasksData"]);
        if (data.scheduledTasksData && data.scheduledTasksData.generatedAt) {
          const generatedAt = new Date(data.scheduledTasksData.generatedAt);
          const now = new Date();
          const diffMs = now - generatedAt;
          const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
          const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

          let timeString = "";
          if (diffHours > 0) {
            timeString = `${diffHours}h ${diffMinutes}m ago`;
          } else if (diffMinutes > 0) {
            timeString = `${diffMinutes}m ago`;
          } else {
            timeString = "just now";
          }

          timestampElement.textContent = `(generated ${timeString})`;
        } else {
          timestampElement.textContent = "";
        }
      } catch (error) {
        console.error("Error loading timestamp:", error);
        timestampElement.textContent = "";
      }
    }

    this.scheduledTasks.forEach((task, index) => {
      const taskItem = document.createElement("div");
      taskItem.className = "task-item";

      const originalIndex = this.tasks.findIndex(t => 
        t.name === task.name && 
        t.grandparent === task.grandparent && 
        t.parent_topic === task.parent_topic
      );

      const difficultyBadge = task.difficulty === 0 ? "easy" : 
                             task.difficulty === 1 ? "medium" : "hard";
      const typeBadge = task.solved.value ? "revision" : "new";

      taskItem.innerHTML = `
        <span class="task-name">${task.name}</span>
        <div class="task-meta">
          <span class="task-badge badge-${difficultyBadge}">
            ${task.difficulty === 0 ? "Easy" : task.difficulty === 1 ? "Medium" : "Hard"}
          </span>
          <span class="task-badge badge-${typeBadge}">
            ${task.solved.value ? "Revision" : "New"}
          </span>
          ${task.problem_link ? 
            `<button class="link-button" data-link="${task.problem_link}" title="Open problem link">🔗</button>` : ""
          }
          <button class="ignore-button" data-task-index="${originalIndex}" title="Ignore this task">−</button>
        </div>
      `;

      // Add event listener for ignore button
      const ignoreBtn = taskItem.querySelector(".ignore-button");
      ignoreBtn.addEventListener("click", () => {
        this.ignoreTask(originalIndex);
      });

      // Add event listener for link button
      const linkBtn = taskItem.querySelector(".link-button");
      if (linkBtn) {
        linkBtn.addEventListener("click", () => {
          window.open(task.problem_link, "_blank");
        });
      }

      taskList.appendChild(taskItem);
    });

    this.showPredictionResults(true);
  }

  updateScheduledCount() {
    const scheduledCount = document.getElementById("scheduled-count");
    if (scheduledCount) {
      scheduledCount.textContent = this.scheduledTasks.length;
    }
  }

  showPredictionLoading(show) {
    const loadingElement = document.getElementById("prediction-loading");
    if (loadingElement) {
      loadingElement.style.display = show ? "flex" : "none";
    }
  }

  showPredictionResults(show) {
    const resultsElement = document.getElementById("prediction-results");
    if (resultsElement) {
      resultsElement.style.display = show ? "block" : "none";
    }
  }

  showPredictionError(message) {
    const errorElement = document.getElementById("prediction-error");
    const errorText = errorElement?.querySelector(".error-text");

    if (errorElement && errorText) {
      errorText.textContent = message;
      errorElement.style.display = "flex";
    }
  }

  hidePredictionError() {
    const errorElement = document.getElementById("prediction-error");
    if (errorElement) {
      errorElement.style.display = "none";
    }
  }

  async ignoreTask(taskIndex) {
    if (taskIndex < 0 || taskIndex >= this.tasks.length) return;

    try {
      // Toggle ignore status
      this.tasks[taskIndex].ignored = !this.tasks[taskIndex].ignored;
      
      // Save to storage
      await this.saveTasksData();
      
      // Update statistics
      this.updateTaskStatistics();
      
      // Regenerate and display schedule
      await this.generateSchedule();
    } catch (error) {
      console.error("Error ignoring task:", error);
    }
  }

  async clearScheduledTasks() {
    try {
      await chrome.storage.local.remove(["scheduledTasksData"]);
      this.scheduledTasks = [];
      this.updateScheduledCount();
      this.showPredictionResults(false);
      this.updateGenerateButtonText();
    } catch (error) {
      console.error("Error clearing scheduled tasks:", error);
    }
  }

  updateGenerateButtonText() {
    const button = document.getElementById("generate-schedule");
    if (!button) return;

    const hasSavedTasks = this.scheduledTasks && this.scheduledTasks.length > 0;

    if (hasSavedTasks) {
      button.innerHTML = `
        <span class="btn-icon">🔄</span>
        Update Schedule
      `;
      button.title = "Update your saved schedule with new settings";
    } else {
      button.innerHTML = `
        <span class="btn-icon">🔮</span>
        Generate Schedule
      `;
      button.title = "Generate a new schedule";
    }
  }

  async loadScheduledTasks() {
    try {
      const data = await chrome.storage.local.get(["scheduledTasksData"]);
      if (data.scheduledTasksData) {
        const scheduleData = data.scheduledTasksData;
        this.scheduledTasks = scheduleData.scheduledTasks || [];

        // Restore filter settings if they exist
        if (scheduleData.targetCount) {
          const targetInput = document.getElementById("target-count");
          if (targetInput) targetInput.value = scheduleData.targetCount;
        }

        if (scheduleData.focusMode !== undefined) {
          const focusSelect = document.getElementById("focus-mode");
          if (focusSelect) focusSelect.value = scheduleData.focusMode;
          this.updateFocusModeDescription();
        }

        return true;
      }
      return false;
    } catch (error) {
      console.error("Error loading scheduled tasks:", error);
      return false;
    }
  }

  async saveScheduledTasks() {
    try {
      const targetCount = parseInt(document.getElementById("target-count").value) || 10;
      const focusMode = parseInt(document.getElementById("focus-mode").value) || 1;

      const grandparentSelect = document.getElementById("grandparent-filter");
      const selectedGrandparents = Array.from(grandparentSelect.selectedOptions)
        .map(option => option.value)
        .filter(value => value !== "");

      const scheduleData = {
        scheduledTasks: this.scheduledTasks,
        generatedAt: new Date().toISOString(),
        targetCount,
        focusMode,
        filters: {
          grandparent: selectedGrandparents,
          parent_topic: document.getElementById("parent-filter").value || null,
        }
      };

      await chrome.storage.local.set({ scheduledTasksData: scheduleData });
    } catch (error) {
      console.error("Error saving scheduled tasks:", error);
    }
  }

  async saveTasksData() {
    try {
      await chrome.storage.local.set({ tasksData: this.tasks });
    } catch (error) {
      console.error("Error saving tasks data:", error);
    }
  }

  async loadTaskIgnoreStatus() {
    try {
      const data = await chrome.storage.local.get(["tasksData"]);
      if (data.tasksData && Array.isArray(data.tasksData)) {
        // Merge ignore status from saved data
        data.tasksData.forEach((savedTask, index) => {
          if (this.tasks[index] && savedTask.ignored !== undefined) {
            this.tasks[index].ignored = savedTask.ignored;
          }
        });
      }
    } catch (error) {
      console.error("Error loading task ignore status:", error);
    }
  }
}

// Global reference for inline event handlers
let popupController;

// Initialize popup
document.addEventListener("DOMContentLoaded", () => {
  popupController = new PopupController();
});
