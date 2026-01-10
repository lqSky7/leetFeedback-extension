class PopupController {
  constructor() {
    this.config = {};
    this.timeTracking = {};
    this.connectionStatus = false;
    this.authStatus = { isAuthenticated: false, user: null, token: null };
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

    // All event listeners set up
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
        
        // Redirect to web app for registration
        if (button.dataset.target === "register") {
          chrome.tabs.create({ url: "https://leet-feedback.vercel.app/login" });
          return;
        }
        
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
      username: formData.get("username")?.toString().trim(),
      password: formData.get("password"),
    };

    if (!payload.username || !payload.password) {
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

    if (tabName === "settings") {
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
        : `<div class="default-avatar"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>`;

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
        <div class="sync-status synced">Connected to LeetFeedback backend</div>
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
              <label for="auth-login-username">Username</label>
              <input type="text" id="auth-login-username" name="username" placeholder="johndoe" autocomplete="username" required />
            </div>
            <div class="field">
              <label for="auth-login-password">Password</label>
              <input type="password" id="auth-login-password" name="password" placeholder="••••••••" autocomplete="current-password" required />
            </div>
            <button type="submit" class="btn btn-primary" id="auth-login-submit">Login</button>
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
}

// Global reference for inline event handlers
let popupController;

// Initialize popup
document.addEventListener("DOMContentLoaded", () => {
  popupController = new PopupController();
});
