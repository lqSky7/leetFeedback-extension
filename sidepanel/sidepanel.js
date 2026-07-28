// Global debug mode cache for sidepanel
let _spDebugMode = false;

// Initialize debug mode cache
chrome.storage.sync.get(['debug_mode'], (data) => {
  _spDebugMode = data.debug_mode || false;
});

// Listen for debug mode changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.debug_mode) {
    _spDebugMode = changes.debug_mode.newValue || false;
  }
});

// Debug-aware logging functions for sidepanel
function spLog(...args) {
  if (_spDebugMode) {
    console.log(...args);
  }
}

function spError(...args) {
  if (_spDebugMode) {
    console.error(...args);
  }
}

const LEGACY_ACCOUNT_ID = "internal://legacy-account";
const ALFA_LEETCODE_API_BASE = "https://alfa-leetcode-api.onrender.com";

/* ── Custom Searchable Select Component ── */
class CustomSelect {
  constructor(wrapperEl) {
    this.wrapper = wrapperEl;
    this.hiddenInput = wrapperEl.querySelector('input[type="hidden"]');
    this.trigger = wrapperEl.querySelector('.custom-select-trigger');
    this.valueDisplay = wrapperEl.querySelector('.custom-select-value');
    this.dropdown = wrapperEl.querySelector('.custom-select-dropdown');
    this.searchInput = wrapperEl.querySelector('.custom-select-search');
    this.optionsContainer = wrapperEl.querySelector('.custom-select-options');
    this.isOpen = false;
    this._bind();
  }

  _bind() {
    this.trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    this.searchInput.addEventListener('input', () => this._filter());
    this.searchInput.addEventListener('click', (e) => e.stopPropagation());

    this.optionsContainer.addEventListener('click', (e) => {
      const opt = e.target.closest('.custom-select-option');
      if (opt && !opt.classList.contains('disabled')) this.select(opt.dataset.value, opt.textContent);
    });

    document.addEventListener('click', (e) => {
      if (!this.wrapper.contains(e.target)) this.close();
    });

    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      if (e.key === 'Enter') {
        const visible = this.optionsContainer.querySelector('.custom-select-option:not([style*="display: none"])');
        if (visible) this.select(visible.dataset.value, visible.textContent);
      }
    });
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    this.isOpen = true;
    this.wrapper.classList.add('open');
    this.searchInput.value = '';
    this._filter();
    requestAnimationFrame(() => this.searchInput.focus());
  }

  close() {
    this.isOpen = false;
    this.wrapper.classList.remove('open');
  }

  select(value, label) {
    this.hiddenInput.value = value;
    this.valueDisplay.textContent = label;
    this.optionsContainer.querySelectorAll('.custom-select-option').forEach(o => o.classList.toggle('selected', o.dataset.value === value));
    this.close();
    this.hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /** Programmatically set value without dispatching change */
  setValue(value) {
    const opt = this.optionsContainer.querySelector(`[data-value="${CSS.escape(value)}"]`);
    if (opt) {
      this.hiddenInput.value = value;
      this.valueDisplay.textContent = opt.textContent;
      this.optionsContainer.querySelectorAll('.custom-select-option').forEach(o => o.classList.toggle('selected', o.dataset.value === value));
    }
  }

  /** Replace all options */
  setOptions(options, selectedValue) {
    this.optionsContainer.innerHTML = '';
    options.forEach(o => {
      const div = document.createElement('div');
      div.className = 'custom-select-option' + (o.value === selectedValue ? ' selected' : '');
      div.dataset.value = o.value;
      div.textContent = o.label;
      this.optionsContainer.appendChild(div);
    });
    const match = options.find(o => o.value === selectedValue);
    if (match) {
      this.hiddenInput.value = match.value;
      this.valueDisplay.textContent = match.label;
    } else if (options.length > 0) {
      this.hiddenInput.value = options[0].value;
      this.valueDisplay.textContent = options[0].label;
    }
  }

  _filter() {
    const q = this.searchInput.value.toLowerCase();
    this.optionsContainer.querySelectorAll('.custom-select-option').forEach(opt => {
      opt.style.display = opt.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  }
}

/** Initialize all custom selects in a container (defaults to document) */
function initAllCustomSelects(root = document) {
  const instances = {};
  root.querySelectorAll('.custom-select').forEach(el => {
    const id = el.dataset.selectId;
    instances[id] = new CustomSelect(el);
  });
  return instances;
}

class PopupController {
  constructor() {
    this.config = {};
    this.connectionStatus = false;
    this.authStatus = {
      isAuthenticated: false,
      user: null,
      token: null,
      accounts: [],
      activeAccountId: null,
    };
    this.pendingLeetcodeImport = null;
    this.initialize();
  }

  async initialize() {
    await this.loadStoredData();
    await this.initializeAuth();
    this.initializeCustomSelects();
    this.setupEventListeners();
    this.updateUI();
    this.updateConnectionStatus();
    this.initializeChromaText();
    this.checkForUpdates();
    this.updateSessionStatus();
  }

  initializeChromaText() {
    // ChromaText colors are defined in CSS to match website
    // No JavaScript override needed
  }

  initializeCustomSelects() {
    this.customSelects = initAllCustomSelects(document);
  }

  setupEventListeners() {
    // Tab navigation
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", (e) => {
        this.switchTab(e.target.dataset.tab);
      });
    });

    // Debounced save for config form
    const debouncedSave = this.debounce(() => this.saveConfiguration(), 500);

    ["token", "repo-url", "owner", "repo", "gemini-key", "branch"].forEach((id) => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener("input", () => {
          if (id === "repo-url") {
            const parsed = this.parseGitHubRepoUrl(element.value.trim());
            if (parsed) {
              const ownerEl = document.getElementById("owner");
              const repoEl = document.getElementById("repo");
              if (ownerEl) ownerEl.value = parsed.owner;
              if (repoEl) repoEl.value = parsed.repo;
            }
          }
          if (id === "gemini-key") {
            const key = element.value.trim();
            if (key) {
              this.fetchGeminiModels(key);
            } else {
              this.toggleGeminiModelField(false);
            }
          }
          debouncedSave();
        });
      }
    });

    const geminiModelInput = document.getElementById("gemini-model");
    if (geminiModelInput) {
      geminiModelInput.addEventListener("change", () => {
        debouncedSave();
      });
    }

    // Toggle password visibility
    const toggleTokenBtn = document.getElementById("toggle-token");
    if (toggleTokenBtn) {
      toggleTokenBtn.addEventListener("click", () => {
        this.togglePasswordVisibility("token", "toggle-token");
      });
    }

    const aiProviderInput = document.getElementById("ai-provider");
    if (aiProviderInput) {
      aiProviderInput.addEventListener("change", (e) => {
        this.config.aiProvider = e.target.value;
        chrome.storage.sync.set({ ai_provider: e.target.value });
        const isGemini = e.target.value === "gemini";
        this.toggleGeminiKeyField(isGemini);
        if (isGemini) {
          const key = document.getElementById("gemini-key")?.value.trim();
          if (key) {
            this.fetchGeminiModels(key);
          }
        }
        this.debounce(() => this.saveConfiguration(), 500)();
      });
    }

    // Toggle Gemini key visibility
    const toggleGeminiBtn = document.getElementById("toggle-gemini");
    if (toggleGeminiBtn) {
      toggleGeminiBtn.addEventListener("click", () => {
        this.togglePasswordVisibility("gemini-key", "toggle-gemini");
      });
    }

    // Token links - open in new tab
    document.querySelectorAll(".token-link").forEach((link) => {
      link.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: e.target.href });
      });
    });

    // GitHub push enabled checkbox - with accordion toggle
    const githubPushCheckbox = document.getElementById("github-push-enabled");
    if (githubPushCheckbox) {
      githubPushCheckbox.addEventListener("change", (e) => {
        this.config.githubPushEnabled = e.target.checked;
        chrome.storage.sync.set({ github_push_enabled: e.target.checked });
        this.toggleGitHubConfig(e.target.checked);
        spLog("GitHub push enabled:", e.target.checked);
      });
    }

    // Timer overlay enabled checkbox
    const timerOverlayCheckbox = document.getElementById("timer-overlay-enabled");
    if (timerOverlayCheckbox) {
      timerOverlayCheckbox.addEventListener("change", (e) => {
        this.config.timerOverlayEnabled = e.target.checked;
        chrome.storage.sync.set({ timer_overlay_enabled: e.target.checked });
        spLog("Timer overlay enabled:", e.target.checked);
      });
    }

    // Debug mode checkbox
    const debugModeCheckbox = document.getElementById("debug-mode");
    if (debugModeCheckbox) {
      debugModeCheckbox.addEventListener("change", (e) => {
        this.config.debugMode = e.target.checked;
        chrome.storage.sync.set({ debug_mode: e.target.checked });
        // Always log debug mode toggle so user can see it working
        console.log("Debug mode enabled:", e.target.checked);
      });
    }

    // All event listeners set up
    const importPreviewBtn = document.getElementById("leetcode-import-preview");
    if (importPreviewBtn) {
      importPreviewBtn.addEventListener("click", () => this.previewLeetcodeImport());
    }

    const importUsernameInput = document.getElementById("leetcode-username");
    if (importUsernameInput) {
      importUsernameInput.addEventListener("input", (event) => {
        chrome.storage.sync.set({
          leetcode_import_username: event.target.value.trim(),
        });
      });
    }

    ["leetcode-import-cancel", "leetcode-import-back"].forEach((id) => {
      const button = document.getElementById(id);
      if (button) {
        button.addEventListener("click", () => this.closeLeetcodeImportModal());
      }
    });

    const importConfirmBtn = document.getElementById("leetcode-import-confirm");
    if (importConfirmBtn) {
      importConfirmBtn.addEventListener("click", () => this.confirmLeetcodeImport());
    }
  }

  toggleGeminiKeyField(show) {
    const field = document.getElementById("gemini-key-field");
    if (field) {
      field.style.display = show ? "" : "none";
    }
    const hasKey = !!document.getElementById("gemini-key")?.value.trim();
    this.toggleGeminiModelField(show && hasKey);
  }

  toggleGeminiModelField(show) {
    const field = document.getElementById("gemini-model-field");
    if (field) {
      field.style.display = show ? "" : "none";
    }
  }

  async fetchGeminiModels(apiKey) {
    if (!apiKey) return;
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }
      const data = await response.json();
      const models = (data.models || [])
        .filter(m => m.supportedGenerationMethods.includes("generateContent"))
        .map(m => ({
          name: m.name.replace("models/", ""),
          displayName: m.displayName || m.name
        }));
      
      // Sort models descending to place the latest models at the top
      const sortedModels = models.sort((a, b) => b.name.localeCompare(a.name));
      
      this.populateGeminiModels(sortedModels);
      this.toggleGeminiModelField(this.config.aiProvider === "gemini");
    } catch (error) {
      console.error("Error fetching Gemini models:", error);
      const select = document.getElementById("gemini-model");
      if (select) {
        select.innerHTML = '<option value="">(Error fetching models)</option>';
      }
      this.toggleGeminiModelField(this.config.aiProvider === "gemini");
    }
  }

  populateGeminiModels(models) {
    const cs = this.customSelects?.['gemini-model'];
    if (!cs) return;
    
    const currentVal = this.config.geminiModel || (models.length > 0 ? models[0].name : "");
    const options = models.map(m => ({ value: m.name, label: m.displayName }));
    cs.setOptions(options, currentVal);
  }

  // Toggle GitHub config accordion visibility
  toggleGitHubConfig(isEnabled) {
    const configFields = document.getElementById("github-config-fields");
    if (configFields) {
      if (isEnabled) {
        configFields.classList.remove("collapsed");
      } else {
        configFields.classList.add("collapsed");
      }
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

  async handleAccountSwitch(event) {
    const accountId = event?.target?.value;
    if (!accountId) return;
    if (typeof extensionAuth === "undefined") {
      this.showMessage("Account switching is not available - authentication service not loaded.", "error");
      return;
    }

    try {
      await extensionAuth.switchAccount(accountId);
      const switchedAccount = extensionAuth
        .getAccounts()
        .find((account) => account.id === accountId);
      const switchedName =
        switchedAccount?.user?.username ||
        switchedAccount?.user?.displayName ||
        switchedAccount?.user?.name ||
        switchedAccount?.user?.email ||
        "User";
      this.showMessage(`Switched to ${switchedName}`, "success");
    } catch (error) {
      this.showMessage(error?.message || "Failed to switch account.", "error");
    }
  }

  toggleAddAccountForm() {
    const panel = document.getElementById("add-account-panel");
    if (!panel) return;
    panel.classList.toggle("active");

    if (!panel.classList.contains("active")) return;
    const usernameInput = panel.querySelector('input[name="username"]');
    if (usernameInput) usernameInput.focus();
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

  /** Parse GitHub repo URL to { owner, repo }. Supports https://github.com/owner/repo and .git suffix. */
  parseGitHubRepoUrl(url) {
    if (!url || typeof url !== "string") return null;
    const trimmed = url.trim();
    const match = trimmed.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
    if (!match) return null;
    return { owner: match[1], repo: match[2].replace(/\.git$/i, "") };
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
          "ai_provider",
          "debug_mode",
          "mistake_tags",
          "github_push_enabled",
          "timer_overlay_enabled",
          "leetcode_import_username",
          "gemini_model",
          "avatar_url",
        ],
        (data) => {
          this.config = {
            token: data.github_token || "",
            owner: data.github_owner || "",
            repo: data.github_repo || "",
            branch: data.github_branch || "main",
            geminiKey: data.gemini_api_key || "",
            aiProvider: data.ai_provider || "g4f",
            debugMode: data.debug_mode || false,
            githubPushEnabled: data.github_push_enabled !== false, // Default true
            timerOverlayEnabled: data.timer_overlay_enabled !== false, // Default true
            leetcodeImportUsername: data.leetcode_import_username || "",
            geminiModel: data.gemini_model || "gemini-3-flash-preview",
            avatarUrl: data.avatar_url || "",
          };
          this.mistakeTags = data.mistake_tags || {};
          resolve();
        },
      );
    });
  }

  updateUI() {
    document.getElementById("token").value = this.config.token;
    const repoUrlEl = document.getElementById("repo-url");
    if (repoUrlEl) {
      if (this.config.owner && this.config.repo) {
        repoUrlEl.value = `https://github.com/${this.config.owner}/${this.config.repo}`;
      } else {
        repoUrlEl.value = this.config.repoUrl || "";
      }
    }
    document.getElementById("owner").value = this.config.owner || "";
    document.getElementById("repo").value = this.config.repo || "";
    document.getElementById("branch").value = this.config.branch;
    document.getElementById("gemini-key").value = this.config.geminiKey;
    document.getElementById("debug-mode").checked = this.config.debugMode;
    const leetcodeUsernameEl = document.getElementById("leetcode-username");
    if (leetcodeUsernameEl) {
      leetcodeUsernameEl.value = this.config.leetcodeImportUsername || "";
    }

    const aiProviderInput = document.getElementById("ai-provider");
    const aiProviderCs = this.customSelects?.['ai-provider'];
    if (aiProviderInput) {
      const val = this.config.aiProvider || "g4f";
      aiProviderInput.value = val;
      if (aiProviderCs) aiProviderCs.setValue(val);
      this.toggleGeminiKeyField(val === "gemini");
      if (this.config.geminiKey && val === "gemini") {
        this.fetchGeminiModels(this.config.geminiKey);
      }
    }

    // New settings
    const githubPushCheckbox = document.getElementById("github-push-enabled");
    const timerOverlayCheckbox = document.getElementById("timer-overlay-enabled");

    if (githubPushCheckbox) {
      githubPushCheckbox.checked = this.config.githubPushEnabled;
    }
    if (timerOverlayCheckbox) {
      timerOverlayCheckbox.checked = this.config.timerOverlayEnabled;
    }

    // Set initial GitHub accordion state
    this.toggleGitHubConfig(this.config.githubPushEnabled);

    // Update auth section
    this.updateAuthSection();
  }

  switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.remove("active");
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add("active");

    // Toggle sliding indicator position class on the container
    const tabsContainer = document.querySelector(".tabs");
    if (tabsContainer) {
      tabsContainer.classList.toggle("settings-active", tabName === "settings");
    }

    // Update tab panels
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.remove("active");
    });
    document.getElementById(tabName).classList.add("active");
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
          ai_provider: formData.aiProvider || "g4f",
          debug_mode: formData.debugMode,
          gemini_model: formData.geminiModel,
        },
        () => { },
      );

      this.config = formData;

      this.refreshAuthConfigSummary();

      setTimeout(() => {
        this.updateConnectionStatus();
      }, 500);
    } catch (error) {
      spError(`Failed to save: ${error.message}`);
    }
  }

  collectFormData() {
    const aiProviderEl = document.getElementById("ai-provider");
    const owner = document.getElementById("owner")?.value.trim() || "";
    const repo = document.getElementById("repo")?.value.trim() || "";
    const repoUrlRaw = document.getElementById("repo-url")?.value.trim() || "";
    return {
      token: document.getElementById("token").value.trim(),
      owner,
      repo,
      repoUrl: repoUrlRaw,
      branch: document.getElementById("branch").value.trim() || "main",
      geminiKey: document.getElementById("gemini-key").value.trim(),
      aiProvider: aiProviderEl ? aiProviderEl.value : "g4f",
      debugMode: document.getElementById("debug-mode").checked,
      geminiModel: document.getElementById("gemini-model")?.value || "gemini-3-flash-preview",
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
      spLog("[Popup] Initializing auth...");

      // Check local storage for cached auth data first
      const result = await chrome.storage.local.get([
        "auth_accounts",
        "auth_active_account_id",
        "auth_user",
        "auth_token",
        "auth_timestamp",
        "firebase_user",
      ]);

      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      const hasStoredAccounts =
        Array.isArray(result.auth_accounts) && result.auth_accounts.length > 0;
      const activeId = hasStoredAccounts
        ? result.auth_active_account_id || result.auth_accounts[0]?.id || null
        : null;
      const activeAccount = hasStoredAccounts
        ? result.auth_accounts.find((account) => account.id === activeId) ||
          result.auth_accounts[0] ||
          null
        : null;
      const activeAccountTimestamp =
        typeof activeAccount?.timestamp === "number" ? activeAccount.timestamp : null;
      const activeAccountCacheAge =
        activeAccountTimestamp !== null ? now - activeAccountTimestamp : maxAge + 1;

      if (
        activeAccount?.user &&
        activeAccount?.token &&
        activeAccountCacheAge < maxAge
      ) {
        this.authStatus = {
          isAuthenticated: true,
          user: activeAccount.user,
          token: activeAccount.token,
          accounts: result.auth_accounts,
          activeAccountId: activeAccount.id || activeId,
        };
        this.updateAuthSection();
      } else if (result.auth_user && result.auth_timestamp) {
        const cacheAge = now - result.auth_timestamp;
        if (cacheAge < maxAge) {
          spLog("[Popup] Found cached backend auth data");
          this.authStatus = {
            isAuthenticated: true,
            user: result.auth_user,
            token: result.auth_token || null,
            accounts: [
              {
                id: LEGACY_ACCOUNT_ID,
                user: result.auth_user,
              },
            ],
            activeAccountId: LEGACY_ACCOUNT_ID,
          };
          this.updateAuthSection();
        }
      } else if (result.firebase_user && result.auth_timestamp) {
        const cacheAge = now - result.auth_timestamp;
        if (cacheAge < maxAge) {
          spLog("[Popup] Found legacy cached auth data");
          this.authStatus = {
            isAuthenticated: true,
            user: result.firebase_user,
            token: result.auth_token || null,
            accounts: [
              {
                id: LEGACY_ACCOUNT_ID,
                user: result.firebase_user,
              },
            ],
            activeAccountId: LEGACY_ACCOUNT_ID,
          };
          this.updateAuthSection();
        }
      }

      // Set up auth utility if available
      if (typeof extensionAuth !== "undefined") {
        spLog("[Popup] Setting up extension auth listener");
        extensionAuth.onAuthStatusChange((authStatus) => {
          spLog("[Popup] Auth status changed:", authStatus);
          this.authStatus = {
            isAuthenticated: authStatus.isAuthenticated,
            user: authStatus.user || null,
            token: authStatus.token || null,
            accounts: Array.isArray(authStatus.accounts)
              ? authStatus.accounts
              : [],
            activeAccountId: authStatus.activeAccountId || null,
          };
          this.updateAuthSection();
          this.updateConnectionStatus();
        });

        // Request fresh auth status
        extensionAuth.requestAuthStatus();
      } else {
        spLog(
          "[Popup] Extension auth not available, updating auth section",
        );
        this.updateAuthSection();
      }

    } catch (error) {
      spError("Error initializing auth:", error);
    }
  }

  async fetchNewCatAvatar() {
    try {
      const response = await fetch("https://api.thecatapi.com/v1/images/search");
      if (!response.ok) throw new Error("Failed to fetch cat image");
      const data = await response.json();
      if (data && data.length > 0 && data[0].url) {
        const newUrl = data[0].url;
        this.config.avatarUrl = newUrl;
        await chrome.storage.sync.set({ avatar_url: newUrl });
        return newUrl;
      }
    } catch (e) {
      console.error("Error fetching cat avatar:", e);
    }
    const fallbackUrl = `https://robohash.org/${encodeURIComponent(this.authStatus.user?.username || "user")}?set=set4`;
    this.config.avatarUrl = fallbackUrl;
    await chrome.storage.sync.set({ avatar_url: fallbackUrl });
    return fallbackUrl;
  }

  updateAuthSection() {
    const authSection = document.getElementById("auth-section");
    if (!authSection) return;

    const accountSettingsSec = document.getElementById("account-settings-section");
    const authSettingsDetails = document.getElementById("auth-settings-details");

    const isAuthenticated =
      this.authStatus?.isAuthenticated && this.authStatus.user;

    if (isAuthenticated) {
      const user = this.authStatus.user || {};
      const accountOptions = (this.authStatus.accounts || []).length > 0
        ? this.authStatus.accounts
        : [{ id: this.authStatus.activeAccountId || "active-account", user }];
      const currentAccountId =
        this.authStatus.activeAccountId || accountOptions[0]?.id;
      const displayName =
        user.username ||
        user.displayName ||
        user.name ||
        user.email ||
        "User";
      const email = user.email || "";

      // Cat profile picture using persisted URL or fallback
      const avatarUrl = this.config.avatarUrl || `https://robohash.org/${encodeURIComponent(displayName)}?set=set4`;
      const avatarMarkup = `<img id="profile-avatar-img" src="${avatarUrl}" alt="${displayName}" />`;

      // Get session status for badge
      const sessionBadge = this.getSessionStatusBadge();

      // Hide settings tab section since we are presenting this directly on the home tab dashboard
      if (accountSettingsSec) {
        accountSettingsSec.style.display = "none";
      }

      // Render Home tab profile dashboard (large avatar with refresh, displayName, email, badge, actions, and switcher)
      authSection.innerHTML = `
        <div class="profile-dashboard">
          <div class="profile-header-card">
            <div class="profile-avatar-large-container" style="position: relative; display: inline-block;">
              <div class="profile-avatar-large">
                ${avatarMarkup}
              </div>
              <button type="button" class="avatar-refresh-btn" id="avatar-refresh-btn" title="Refresh Profile Picture">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              </button>
            </div>
            <div class="profile-info-center">
              <div class="profile-name-large">${displayName}</div>
              ${email ? `<div class="profile-email-large">${email}</div>` : ""}
              <div class="status-badge-container" style="margin-top: 4px;">
                ${sessionBadge}
              </div>
            </div>
          </div>

          <div class="auth-actions" style="margin-top: 6px;">
            <button class="btn btn-secondary" id="add-account-btn">Add Account</button>
            <button class="btn btn-secondary" id="sign-out-btn">Sign Out</button>
          </div>

          <div class="account-controls" style="margin-top: 4px;">
            <label for="active-account-select" style="display: block; font-size: 11px; color: var(--text-muted); margin-bottom: 6px; letter-spacing: 0.06em; text-transform: uppercase;">Active Account</label>
            <div class="custom-select" id="active-account-wrapper" data-select-id="active-account-select">
              <input type="hidden" id="active-account-select" value="" />
              <button type="button" class="custom-select-trigger" aria-haspopup="listbox">
                <span class="custom-select-value">Select account</span>
                <svg class="custom-select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
              <div class="custom-select-dropdown" role="listbox">
                <div class="custom-select-search-wrap">
                  <input type="text" class="custom-select-search" placeholder="Search&hellip;" autocomplete="off" />
                </div>
                <div class="custom-select-options"></div>
              </div>
            </div>
          </div>

          <div class="add-account-panel" id="add-account-panel" style="display: none;">
            <h4 class="account-form-title">Add Another Account</h4>
            <form class="auth-form active" id="auth-add-account-form" data-form="add-account" aria-label="Add another account">
              <div class="field" style="margin-bottom: 10px;">
                <label for="auth-add-username">Username</label>
                <input type="text" id="auth-add-username" name="username" placeholder="johndoe" autocomplete="username" required />
              </div>
              <div class="field" style="margin-bottom: 10px;">
                <label for="auth-add-password">Password</label>
                <input type="password" id="auth-add-password" name="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;" autocomplete="current-password" required />
              </div>
              <button type="submit" class="btn btn-primary">Add Account & Switch</button>
            </form>
            <div class="auth-form-message" id="auth-form-message"></div>
          </div>
        </div>
      `;

      const signOutBtn = document.getElementById("sign-out-btn");
      if (signOutBtn) {
        signOutBtn.addEventListener("click", () => this.signOut());
      }
      // Initialize custom select for account switcher
      const accountWrapper = document.getElementById("active-account-wrapper");
      if (accountWrapper) {
        const cs = new CustomSelect(accountWrapper);
        const options = accountOptions.map(account => {
          const accountName =
            account?.user?.username ||
            account?.user?.displayName ||
            account?.user?.name ||
            account?.user?.email ||
            "User";
          return { value: account.id, label: accountName };
        });
        cs.setOptions(options, currentAccountId);
        // Listen for changes on the hidden input
        const hiddenInput = document.getElementById("active-account-select");
        if (hiddenInput) {
          hiddenInput.addEventListener("change", (event) =>
            this.handleAccountSwitch(event),
          );
        }
      }
      const addAccountBtn = document.getElementById("add-account-btn");
      if (addAccountBtn) {
        addAccountBtn.addEventListener("click", () => this.toggleAddAccountForm());
      }
      const addAccountForm = document.getElementById("auth-add-account-form");
      if (addAccountForm) {
        addAccountForm.addEventListener("submit", (event) =>
          this.handleLoginSubmit(event),
        );
      }
      const refreshBtn = document.getElementById("avatar-refresh-btn");
      if (refreshBtn) {
        refreshBtn.addEventListener("click", async () => {
          refreshBtn.classList.add("spinning");
          const newUrl = await this.fetchNewCatAvatar();
          const avatarImg = document.getElementById("profile-avatar-img");
          if (avatarImg) {
            avatarImg.src = newUrl;
          }
          refreshBtn.classList.remove("spinning");
        });
      }
    } else {
      if (accountSettingsSec) {
        accountSettingsSec.style.display = "none";
      }

      authSection.innerHTML = `
        <div class="auth-login-compact">
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

  // Get session status as a badge element
  getSessionStatusBadge() {
    try {
      // Try to determine session status from stored data
      const token = this.authStatus?.token;
      if (!token) {
        return `<div class="profile-status-badge">Active</div>`;
      }

      // Try to decode JWT for expiration
      let expiresAt = null;
      if (token.includes(".")) {
        try {
          const payload = JSON.parse(atob(token.split(".")[1]));
          if (payload.exp) {
            expiresAt = payload.exp * 1000;
          }
        } catch (e) {
          // Token might not be JWT
        }
      }

      if (expiresAt) {
        const now = Date.now();
        const timeLeft = expiresAt - now;
        const hoursLeft = Math.floor(timeLeft / (1000 * 60 * 60));
        const daysLeft = Math.floor(hoursLeft / 24);

        if (timeLeft < 0) {
          return `<div class="profile-status-badge error">Session expired</div>`;
        } else if (hoursLeft < 24) {
          return `<div class="profile-status-badge warning">Expires in ${hoursLeft}h</div>`;
        } else {
          return `<div class="profile-status-badge">Active (${daysLeft} day${daysLeft !== 1 ? "s" : ""} remaining)</div>`;
        }
      }

      return `<div class="profile-status-badge">Active</div>`;
    } catch (e) {
      return `<div class="profile-status-badge">Active</div>`;
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
      spLog("[Popup] Opening sign in...");

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
      spError("Error opening sign in:", error);
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
      spError("Error opening website:", error);
    }
  }

  async signOut() {
    try {
      if (typeof extensionAuth !== "undefined") {
        await extensionAuth.signOut();
        await extensionAuth.requestAuthStatus();
        this.showMessage("Signed out active account", "success");
        this.showAuthFeedback("success", "Signed out active account.");
      } else {
        // Fallback: clear local storage
        await chrome.storage.local.remove([
          "auth_accounts",
          "auth_active_account_id",
          "auth_user",
          "auth_token",
          "auth_timestamp",
          "firebase_user",
        ]);
        this.authStatus = {
          isAuthenticated: false,
          user: null,
          token: null,
          accounts: [],
          activeAccountId: null,
        };
        this.updateAuthSection();
        this.showMessage("Signed out locally", "success");
        this.showAuthFeedback("success", "Signed out locally.");
      }
    } catch (error) {
      spError("Error signing out:", error);
      // Even if sign out fails, clear local state
      await chrome.storage.local.remove([
        "auth_accounts",
        "auth_active_account_id",
        "auth_user",
        "auth_token",
        "auth_timestamp",
        "firebase_user",
      ]);
      this.authStatus = {
        isAuthenticated: false,
        user: null,
        token: null,
        accounts: [],
        activeAccountId: null,
      };
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

  setLeetcodeImportStatus(type = "", message = "") {
    const status = document.getElementById("leetcode-import-status");
    if (!status) return;

    status.textContent = message || "";
    status.className = "leetcode-import-status";
    if (type && message) {
      status.classList.add("active", type);
    }
  }

  setButtonLoading(button, isLoading, loadingText = "Working...") {
    this.toggleAuthLoading(button, isLoading, loadingText);
  }

  async previewLeetcodeImport() {
    const usernameInput = document.getElementById("leetcode-username");
    const previewButton = document.getElementById("leetcode-import-preview");
    const username = usernameInput?.value.trim();

    if (!this.authStatus?.isAuthenticated || !this.authStatus?.token) {
      this.setLeetcodeImportStatus("error", "Login to Traverse before importing LeetCode data.");
      return;
    }

    if (!username) {
      this.setLeetcodeImportStatus("error", "Enter your LeetCode username.");
      usernameInput?.focus();
      return;
    }

    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(username)) {
      this.setLeetcodeImportStatus("error", "Use a valid LeetCode username.");
      usernameInput?.focus();
      return;
    }

    try {
      await chrome.storage.sync.set({ leetcode_import_username: username });
      this.pendingLeetcodeImport = null;
      this.setButtonLoading(previewButton, true, "Reading LeetCode...");
      this.setLeetcodeImportStatus("info", "Fetching accepted submissions from LeetCode.");

      const bundle = await this.fetchLeetcodeImportBundle(username, (message) => {
        this.setLeetcodeImportStatus("info", message);
      });

      if (bundle.submissions.length === 0) {
        this.setLeetcodeImportStatus("warning", "No solved LeetCode questions were found for this username.");
        return;
      }

      const payload = this.buildLeetcodeImportPayload(username, bundle);
      const existingSolveSlugs = await this.fetchExistingLeetcodeSolveSlugs();
      const originalImportCount = payload.submissions.length;
      payload.submissions = payload.submissions.filter(
        (submission) => !existingSolveSlugs.has(submission.problemSlug)
      );
      const existingInTraverse = originalImportCount - payload.submissions.length;

      if (payload.submissions.length === 0) {
        this.setLeetcodeImportStatus(
          "warning",
          `All ${originalImportCount} solved LeetCode questions are already in Traverse for this account.`
        );
        return;
      }

      this.pendingLeetcodeImport = {
        username,
        payload,
        stats: {
          ...bundle.stats,
          existingInTraverse,
          originalImportCount,
        },
      };
      this.openLeetcodeImportModal(this.pendingLeetcodeImport);
      this.setLeetcodeImportStatus(
        "success",
        `Ready to import ${payload.submissions.length} new solved questions. ${existingInTraverse} already exist in Traverse.`
      );
    } catch (error) {
      spError("[LeetCode Import] Preview failed:", error);
      this.setLeetcodeImportStatus(
        "error",
        error?.message || "Unable to prepare the LeetCode import."
      );
    } finally {
      this.setButtonLoading(previewButton, false);
    }
  }

  async confirmLeetcodeImport() {
    const pendingImport = this.pendingLeetcodeImport;
    const confirmButton = document.getElementById("leetcode-import-confirm");

    if (!pendingImport) {
      this.closeLeetcodeImportModal();
      this.setLeetcodeImportStatus("error", "Import preview expired. Run preview again.");
      return;
    }

    try {
      this.setButtonLoading(confirmButton, true, "Importing...");
      const response = await this.fetchViaBackground(
        `${this.getBackendBaseUrl()}/api/submissions/bulk-import`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.authStatus.token}`,
          },
          body: JSON.stringify(pendingImport.payload),
        },
        60000
      );

      if (!response.success) {
        const errorText = response.data?.error || response.error || `Backend returned ${response.status}`;
        throw new Error(errorText);
      }

      const imported = response.data?.import || {};
      this.closeLeetcodeImportModal();
      this.pendingLeetcodeImport = null;
      this.setLeetcodeImportStatus(
        "success",
        `Imported ${imported.importedSolves || 0} new solves. ${pendingImport.stats.existingInTraverse || 0} were already in Traverse before posting; backend skipped ${imported.skippedExistingSolves || 0} more.`
      );
    } catch (error) {
      spError("[LeetCode Import] Confirm failed:", error);
      this.setLeetcodeImportStatus("error", error?.message || "Import failed.");
    } finally {
      this.setButtonLoading(confirmButton, false);
    }
  }

  getBackendBaseUrl() {
    if (typeof extensionAuth !== "undefined" && typeof extensionAuth.getApiBaseUrl === "function") {
      return extensionAuth.getApiBaseUrl();
    }
    return "https://traverse-backend-api.azurewebsites.net";
  }

  openLeetcodeImportModal(pendingImport) {
    const modal = document.getElementById("leetcode-import-modal");
    const summary = document.getElementById("leetcode-import-summary");
    const grid = document.getElementById("leetcode-import-summary-grid");
    if (!modal || !summary || !grid) return;

    const stats = pendingImport.stats;
    summary.textContent = `Import solved LeetCode data for ${pendingImport.username}?`;
    grid.innerHTML = [
      ["New to import", pendingImport.payload.submissions.length],
      ["Already in Traverse", stats.existingInTraverse || 0],
      ["Duplicates removed", stats.duplicatesRemoved],
      ["Details fetched", stats.detailsFetched],
    ]
      .map(([label, value]) => `
        <div class="import-summary-item">
          <span class="import-summary-value">${value}</span>
          <span class="import-summary-label">${label}</span>
        </div>
      `)
      .join("");

    modal.classList.add("active");
    modal.setAttribute("aria-hidden", "false");
    document.getElementById("leetcode-import-confirm")?.focus();
  }

  closeLeetcodeImportModal() {
    const modal = document.getElementById("leetcode-import-modal");
    if (!modal) return;
    modal.classList.remove("active");
    modal.setAttribute("aria-hidden", "true");
  }

  async fetchLeetcodeImportBundle(username, onProgress) {
    const encodedUsername = encodeURIComponent(username);
    const [profile, solved, languageStats, skillStats, calendar, acceptedRaw] = await Promise.all([
      this.fetchAlfaLeetcode(`${encodedUsername}/profile`, 30000).catch((error) => ({ error: error.message })),
      this.fetchAlfaLeetcode(`${encodedUsername}/solved`, 30000).catch((error) => ({ error: error.message })),
      this.fetchAlfaLeetcode(`${encodedUsername}/language`, 30000).catch((error) => ({ error: error.message })),
      this.fetchAlfaLeetcode(`${encodedUsername}/skill`, 30000).catch((error) => ({ error: error.message })),
      this.fetchAlfaLeetcode(`${encodedUsername}/calendar`, 30000).catch((error) => ({ error: error.message })),
      this.fetchAlfaLeetcode(`${encodedUsername}/acSubmission?limit=5000`, 45000),
    ]);

    const accepted = this.extractSolvedSubmissionCandidates(acceptedRaw);
    const progressCandidates = accepted.length > 0
      ? []
      : this.extractSolvedSubmissionCandidates(
        await this.fetchAlfaLeetcode(`${encodedUsername}/progress`, 30000).catch(() => ({}))
      );
    const baseCandidates = accepted.length > 0 ? accepted : progressCandidates;
    const deduped = this.dedupeLeetcodeSolvedItems(baseCandidates);

    onProgress?.(`Found ${deduped.items.length} unique solved questions. Fetching problem metadata.`);

    const detailResult = await this.fetchLeetcodeQuestionDetails(deduped.items, onProgress);

    return {
      submissions: detailResult.items,
      metadata: {
        profile,
        solved,
        languageStats,
        skillStats,
        calendar,
      },
      stats: {
        duplicatesRemoved: deduped.duplicates,
        detailsFetched: detailResult.detailsFetched,
        detailsFailed: detailResult.detailsFailed,
      },
    };
  }

  async fetchExistingLeetcodeSolveSlugs() {
    const slugs = new Set();
    const limit = 100;
    let offset = 0;

    while (true) {
      const response = await this.fetchViaBackground(
        `${this.getBackendBaseUrl()}/api/solves?platform=leetcode&limit=${limit}&offset=${offset}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.authStatus.token}`,
          },
        },
        30000
      );

      if (!response.success) {
        const errorText = response.data?.error || response.error || `Backend returned ${response.status}`;
        throw new Error(`Could not check existing Traverse solves: ${errorText}`);
      }

      const solves = Array.isArray(response.data?.solves) ? response.data.solves : [];
      solves.forEach((solve) => {
        const slug = solve?.problem?.slug;
        if (slug) slugs.add(this.slugify(slug));
      });

      const total = response.data?.pagination?.total;
      offset += solves.length;

      if (solves.length < limit || (typeof total === "number" && offset >= total)) {
        break;
      }
    }

    return slugs;
  }

  async fetchAlfaLeetcode(path, timeoutMs = 30000) {
    const cleanPath = path.replace(/^\/+/, "");
    const response = await this.fetchViaBackground(
      `${ALFA_LEETCODE_API_BASE}/${cleanPath}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      },
      timeoutMs
    );

    if (!response.success) {
      const errorText = response.data?.error || response.error || `alfa LeetCode API returned ${response.status}`;
      throw new Error(errorText);
    }

    return response.data || {};
  }

  async fetchViaBackground(url, options, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "BACKEND_API_FETCH",
          url,
          options,
          timeoutMs,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!response) {
            reject(new Error("No response from background worker."));
            return;
          }

          resolve(response);
        }
      );
    });
  }

  extractSolvedSubmissionCandidates(payload) {
    const candidates = [];
    const seenArrays = new Set();

    const visit = (value) => {
      if (!value || typeof value !== "object") return;

      if (Array.isArray(value)) {
        if (seenArrays.has(value)) return;
        seenArrays.add(value);

        const arrayLooksRelevant = value.some((item) =>
          item &&
          typeof item === "object" &&
          (item.titleSlug || item.slug || item.title || item.problemTitle)
        );

        if (arrayLooksRelevant) {
          value.forEach((item) => {
            const normalized = this.normalizeLeetcodeCandidate(item);
            if (normalized) candidates.push(normalized);
          });
        }
        return;
      }

      Object.values(value).forEach(visit);
    };

    visit(payload);
    return candidates;
  }

  normalizeLeetcodeCandidate(item) {
    if (!item || typeof item !== "object") return null;

    const rawSlug = item.titleSlug || item.problemSlug || item.slug || item.questionSlug;
    const title = item.title || item.problemTitle || item.questionTitle || rawSlug;
    const slug = rawSlug || this.slugify(title);
    if (!slug) return null;

    const status = (item.statusDisplay || item.status || item.result || "").toString().toLowerCase();
    if (status && !["accepted", "ac", "solved"].some((accepted) => status.includes(accepted))) {
      return null;
    }

    return {
      problemSlug: this.slugify(slug),
      problemTitle: title?.toString() || slug,
      difficulty: this.normalizeLeetcodeDifficulty(item.difficulty),
      language: item.lang || item.language || "unknown",
      timestamp: item.timestamp || item.submittedAt || item.date || null,
      topicTags: Array.isArray(item.topicTags) ? item.topicTags : [],
      questionId: item.questionId || item.id || null,
      frontendQuestionId: item.frontendQuestionId || item.questionFrontendId || null,
    };
  }

  dedupeLeetcodeSolvedItems(items) {
    const bySlug = new Map();
    let duplicates = 0;

    items.forEach((item) => {
      if (!item.problemSlug) return;
      const existing = bySlug.get(item.problemSlug);
      if (!existing) {
        bySlug.set(item.problemSlug, item);
        return;
      }

      duplicates += 1;
      const existingTime = this.timestampToMillis(existing.timestamp);
      const itemTime = this.timestampToMillis(item.timestamp);
      if (itemTime && (!existingTime || itemTime < existingTime)) {
        bySlug.set(item.problemSlug, item);
      }
    });

    return {
      items: Array.from(bySlug.values()),
      duplicates,
    };
  }

  async fetchLeetcodeQuestionDetails(items, onProgress) {
    const enriched = new Array(items.length);
    let cursor = 0;
    let detailsFetched = 0;
    let detailsFailed = 0;
    const concurrency = 3;

    const worker = async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        const item = items[index];

        try {
          const detailPayload = await this.fetchAlfaLeetcode(`select?titleSlug=${encodeURIComponent(item.problemSlug)}`, 15000);
          const detail = this.extractQuestionDetail(detailPayload);
          enriched[index] = this.mergeLeetcodeDetail(item, detail);
          detailsFetched += detail ? 1 : 0;
          detailsFailed += detail ? 0 : 1;
        } catch (error) {
          enriched[index] = item;
          detailsFailed += 1;
        }

        if ((index + 1) % 10 === 0 || index === items.length - 1) {
          onProgress?.(`Fetched metadata for ${index + 1}/${items.length} solved questions.`);
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
    );

    return {
      items: enriched.filter(Boolean),
      detailsFetched,
      detailsFailed,
    };
  }

  extractQuestionDetail(payload) {
    if (!payload || typeof payload !== "object") return null;
    return payload.question || payload.data?.question || payload.data || payload;
  }

  mergeLeetcodeDetail(item, detail) {
    if (!detail || typeof detail !== "object") return item;

    return {
      ...item,
      problemSlug: this.slugify(detail.titleSlug || detail.slug || item.problemSlug),
      problemTitle: detail.title || detail.problemTitle || item.problemTitle,
      difficulty: this.normalizeLeetcodeDifficulty(detail.difficulty || item.difficulty),
      topicTags: Array.isArray(detail.topicTags) ? detail.topicTags : item.topicTags,
      questionId: detail.questionId || item.questionId,
      frontendQuestionId: detail.questionFrontendId || detail.frontendQuestionId || item.frontendQuestionId,
    };
  }

  buildLeetcodeImportPayload(username, bundle) {
    return {
      source: "leetcode",
      username,
      submissions: bundle.submissions.map((item) => {
        const happenedAt = this.timestampToIso(item.timestamp);
        return {
          problemSlug: item.problemSlug,
          problemTitle: item.problemTitle,
          difficulty: this.normalizeLeetcodeDifficulty(item.difficulty),
          language: item.language || "unknown",
          happenedAt,
          timestamp: item.timestamp || null,
          idempotencyKey: `leetcode-import:${item.problemSlug}`,
          topicTags: item.topicTags || [],
          questionId: item.questionId || null,
          frontendQuestionId: item.frontendQuestionId || null,
        };
      }),
      metadata: bundle.metadata,
    };
  }

  normalizeLeetcodeDifficulty(value) {
    const normalized = value?.toString().trim().toLowerCase();
    if (normalized === "easy" || normalized === "medium" || normalized === "hard") {
      return normalized;
    }
    return "medium";
  }

  slugify(value) {
    if (!value) return "";
    return value
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  timestampToMillis(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "string" && Number.isNaN(Number(value))) {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }

    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric < 10000000000 ? numeric * 1000 : numeric;
  }

  timestampToIso(value) {
    const millis = this.timestampToMillis(value);
    const date = millis ? new Date(millis) : new Date();
    return date.toISOString();
  }

  // Check for extension updates from Chrome Web Store
  async checkForUpdates() {
    const updateNotification = document.getElementById("update-notification");
    if (!updateNotification) return;

    try {
      // Check if we should throttle (only check once per day)
      const cacheResult = await chrome.storage.local.get(["update_check_cache"]);
      const cache = cacheResult.update_check_cache;
      const now = Date.now();
      const oneDay = 24 * 60 * 60 * 1000;

      const storeUrl = "https://chromewebstore.google.com/detail/traverse/nnapafjmoelkehjedfgjchoeelgbiama";

      if (cache && cache.timestamp && (now - cache.timestamp) < oneDay) {
        // Use cached latest version but compare against CURRENT manifest version
        const currentVersion = chrome.runtime.getManifest().version;
        const hasUpdate = this.compareVersions(cache.latestVersion, currentVersion) > 0;
        this.renderUpdateNotification(hasUpdate, cache.latestVersion, currentVersion, storeUrl);
        return;
      }

      // Fetch web store page content
      const response = await fetch(storeUrl);

      if (!response.ok) {
        throw new Error(`Chrome Web Store page returned status ${response.status}`);
      }

      const htmlText = await response.text();
      let latestVersion = null;

      // Extract version using regex matching
      const regexMatch = htmlText.match(/\\?"version\\?":\s*\\?"([0-9.]+)\\?"/);
      if (regexMatch) {
        latestVersion = regexMatch[1];
      } else {
        // Fallback to DOM parsing
        const doc = new DOMParser().parseFromString(htmlText, "text/html");
        const divs = Array.from(doc.querySelectorAll("div"));
        const versionDiv = divs.find(el => el.textContent.trim() === "Version");
        if (versionDiv && versionDiv.nextElementSibling) {
          const versionStr = versionDiv.nextElementSibling.textContent.trim();
          if (/^\d+(\.\d+)+$/.test(versionStr)) {
            latestVersion = versionStr;
          }
        }
      }

      if (!latestVersion) {
        throw new Error("Could not parse version from Chrome Web Store");
      }

      const currentVersion = chrome.runtime.getManifest().version;

      // Compare versions
      const hasUpdate = this.compareVersions(latestVersion, currentVersion) > 0;

      // Cache the result
      await chrome.storage.local.set({
        update_check_cache: {
          hasUpdate,
          latestVersion,
          currentVersion,
          releaseUrl: storeUrl,
          timestamp: now
        }
      });

      this.renderUpdateNotification(hasUpdate, latestVersion, currentVersion, storeUrl);

    } catch (error) {
      spError("[Update Check] Error:", error);
      updateNotification.innerHTML = `
        <div class="update-uptodate">
          <span class="update-uptodate-icon">✓</span>
          <span>v${chrome.runtime.getManifest().version}</span>
        </div>
      `;
    }
  }

  renderUpdateNotification(hasUpdate, latestVersion, currentVersion, releaseUrl = "https://chromewebstore.google.com/detail/traverse/nnapafjmoelkehjedfgjchoeelgbiama") {
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
            Update from Chrome Web Store
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
        spLog("[Session] Could not decode token:", e);
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
      spError("[Session Status] Error:", error);
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
