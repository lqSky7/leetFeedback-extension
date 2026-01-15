class PopupController {
  constructor() {
    this.config = {};
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
    this.initializeChromaText();
    this.checkForUpdates();
    this.updateSessionStatus();
  }

  initializeChromaText() {
    // ChromaText colors are defined in CSS to match website
    // No JavaScript override needed
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

    // GitHub push enabled checkbox
    const githubPushCheckbox = document.getElementById("github-push-enabled");
    if (githubPushCheckbox) {
      githubPushCheckbox.addEventListener("change", (e) => {
        this.config.githubPushEnabled = e.target.checked;
        chrome.storage.sync.set({ github_push_enabled: e.target.checked });
        console.log("GitHub push enabled:", e.target.checked);
      });
    }

    // Timer overlay enabled checkbox
    const timerOverlayCheckbox = document.getElementById("timer-overlay-enabled");
    if (timerOverlayCheckbox) {
      timerOverlayCheckbox.addEventListener("change", (e) => {
        this.config.timerOverlayEnabled = e.target.checked;
        chrome.storage.sync.set({ timer_overlay_enabled: e.target.checked });
        console.log("Timer overlay enabled:", e.target.checked);
      });
    }

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
          "mistake_tags",
          "github_push_enabled",
          "timer_overlay_enabled",
        ],
        (data) => {
          this.config = {
            token: data.github_token || "",
            owner: data.github_owner || "",
            repo: data.github_repo || "",
            branch: data.github_branch || "main",
            geminiKey: data.gemini_api_key || "",
            debugMode: data.debug_mode || false,
            githubPushEnabled: data.github_push_enabled !== false, // Default true
            timerOverlayEnabled: data.timer_overlay_enabled !== false, // Default true
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

    // New settings
    const githubPushCheckbox = document.getElementById("github-push-enabled");
    const timerOverlayCheckbox = document.getElementById("timer-overlay-enabled");

    if (githubPushCheckbox) {
      githubPushCheckbox.checked = this.config.githubPushEnabled;
    }
    if (timerOverlayCheckbox) {
      timerOverlayCheckbox.checked = this.config.timerOverlayEnabled;
    }

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
        () => { },
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

    // Check backend authentication status instead of GitHub config
    const isConnected = this.authStatus?.isAuthenticated;

    if (isConnected) {
      statusDot.classList.add("connected");
      statusText.textContent = "Connected";
    } else {
      statusDot.classList.remove("connected");
      statusText.textContent = "Not Connected";
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
          this.updateConnectionStatus();
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

  // Check for extension updates from GitHub releases
  async checkForUpdates() {
    const updateNotification = document.getElementById("update-notification");
    if (!updateNotification) return;

    try {
      // Check if we should throttle (only check once per day)
      const cacheResult = await chrome.storage.local.get(["update_check_cache"]);
      const cache = cacheResult.update_check_cache;
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;

      if (cache && cache.timestamp && (now - cache.timestamp) < oneDay) {
        // Use cached latest version but compare against CURRENT manifest version
        const currentVersion = chrome.runtime.getManifest().version;
        const hasUpdate = this.compareVersions(cache.latestVersion, currentVersion) > 0;
        this.renderUpdateNotification(hasUpdate, cache.latestVersion, currentVersion);
        return;
      }

      // Fetch latest release from GitHub
      const response = await fetch(
        "https://api.github.com/repos/lqSky7/leetFeedback-extension/releases/latest",
        { headers: { Accept: "application/vnd.github.v3+json" } }
      );

      if (!response.ok) {
        throw new Error(`GitHub API returned ${response.status}`);
      }

      const release = await response.json();
      const latestVersion = release.tag_name.replace(/^v/, "");
      const currentVersion = chrome.runtime.getManifest().version;

      // Compare versions
      const hasUpdate = this.compareVersions(latestVersion, currentVersion) > 0;

      // Cache the result
      await chrome.storage.local.set({
        update_check_cache: {
          hasUpdate,
          latestVersion,
          currentVersion,
          releaseUrl: release.html_url,
          timestamp: now
        }
      });

      this.renderUpdateNotification(hasUpdate, latestVersion, currentVersion, release.html_url);

    } catch (error) {
      console.error("[Update Check] Error:", error);
      updateNotification.innerHTML = `
        <div class="update-uptodate">
          <span class="update-uptodate-icon">✓</span>
          <span>v${chrome.runtime.getManifest().version}</span>
        </div>
      `;
    }
  }

  renderUpdateNotification(hasUpdate, latestVersion, currentVersion, releaseUrl = "https://github.com/lqSky7/leetFeedback-extension/releases") {
    const updateNotification = document.getElementById("update-notification");
    if (!updateNotification) return;

    if (hasUpdate) {
      updateNotification.classList.add("has-update");
      updateNotification.innerHTML = `
        <div class="update-available">
          <div class="update-version-info">
            <span class="update-current">Current: v${currentVersion}</span>
            <span class="update-latest">v${latestVersion} available</span>
          </div>
          <a href="${releaseUrl}" target="_blank" class="update-link">
            Download Update
          </a>
        </div>
      `;
    } else {
      updateNotification.classList.remove("has-update");
      updateNotification.innerHTML = `
        <div class="update-uptodate">
          <span class="update-uptodate-icon">✓</span>
          <span>Up to date (v${currentVersion})</span>
        </div>
      `;
    }
  }

  compareVersions(a, b) {
    const partsA = a.split(".").map(Number);
    const partsB = b.split(".").map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      if (numA > numB) return 1;
      if (numA < numB) return -1;
    }
    return 0;
  }

  // Check session/cookie expiration status
  async updateSessionStatus() {
    const sessionStatus = document.getElementById("session-status");
    if (!sessionStatus) return;

    try {
      const result = await chrome.storage.local.get(["auth_token", "auth_timestamp", "auth_user"]);

      if (!result.auth_token || !result.auth_user) {
        // Not logged in - hide session status
        sessionStatus.style.display = "none";
        return;
      }

      sessionStatus.style.display = "block";

      // Try to decode JWT to get expiration
      let expiresAt = null;
      try {
        const token = result.auth_token;
        if (token && token.includes(".")) {
          const payload = JSON.parse(atob(token.split(".")[1]));
          if (payload.exp) {
            expiresAt = payload.exp * 1000; // Convert to ms
          }
        }
      } catch (e) {
        // Token might not be JWT or is malformed
        console.log("[Session] Could not decode token:", e);
      }

      // Fallback: estimate expiration from auth_timestamp (assume 7 days)
      if (!expiresAt && result.auth_timestamp) {
        expiresAt = result.auth_timestamp + (7 * 24 * 60 * 60 * 1000);
      }

      if (expiresAt) {
        const now = Date.now();
        const timeLeft = expiresAt - now;
        const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
        const daysLeft = Math.floor(hoursLeft / 24);

        if (timeLeft < 0) {
          // Expired
          sessionStatus.className = "session-status error";
          sessionStatus.innerHTML = `
            <div class="session-status-label">Session Status</div>
            <div class="session-status-value">Session expired</div>
            <div class="session-status-action">
              <button class="btn btn-primary" id="relogin-btn">Login Again</button>
            </div>
          `;
          document.getElementById("relogin-btn")?.addEventListener("click", () => {
            chrome.tabs.create({ url: "https://leet-feedback.vercel.app/login" });
          });
        } else if (hoursLeft < 24) {
          // Expiring soon (less than 24 hours)
          sessionStatus.className = "session-status warning";
          sessionStatus.innerHTML = `
            <div class="session-status-label">Session Status</div>
            <div class="session-status-value">Expires in ${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""}</div>
            <div class="session-status-action">
              <button class="btn btn-primary" id="refresh-session-btn">Refresh Session</button>
            </div>
          `;
          document.getElementById("refresh-session-btn")?.addEventListener("click", () => {
            chrome.tabs.create({ url: "https://leet-feedback.vercel.app/login" });
          });
        } else {
          // Session is healthy
          sessionStatus.className = "session-status";
          sessionStatus.innerHTML = `
            <div class="session-status-label">Session Status</div>
            <div class="session-status-value">Active (${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining)</div>
          `;
        }
      } else {
        // Can't determine expiration
        sessionStatus.className = "session-status";
        sessionStatus.innerHTML = `
          <div class="session-status-label">Session Status</div>
          <div class="session-status-value">Active</div>
        `;
      }
    } catch (error) {
      console.error("[Session Status] Error:", error);
      sessionStatus.style.display = "none";
    }
  }
}

// Global reference for inline event handlers
let popupController;

// Initialize popup
document.addEventListener("DOMContentLoaded", () => {
  popupController = new PopupController();
});
