const _spLogger =
  globalThis.Traverse && globalThis.Traverse.createLogger
    ? globalThis.Traverse.createLogger('Sidepanel')
    : null;

let _spDebugMode = false;

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
  chrome.storage.sync.get(['debug_mode'], (data) => {
    _spDebugMode = data.debug_mode || false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.debug_mode) {
      _spDebugMode = changes.debug_mode.newValue || false;
    }
  });
}

// Debug-aware logging functions for sidepanel
function spLog(...args) {
  if (_spLogger) {
    _spLogger.log(...args);
  } else if (_spDebugMode) {
    console.log('[Sidepanel]', ...args);
  }
}

function spError(...args) {
  if (_spLogger) {
    _spLogger.error(...args);
  } else if (_spDebugMode) {
    console.error('[Sidepanel]', ...args);
  }
}

const LEGACY_ACCOUNT_ID = "internal://legacy-account";

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
    this.initialize();
  }

  async initialize() {
    await this.loadStoredData();
    await this.initializeAuth();
    await this.initializeRecon();
    this.initializeCustomSelects();
    this.setupEventListeners();
    this.updateUI();
    this.updateConnectionStatus();
    this.initializeChromaText();
    this.checkForUpdates();
  }

  initializeChromaText() {
    // ChromaText colors are defined in CSS to match website.
    // The footer wordmark sweeps once on load; freeze it afterwards so toggling
    // between the Home and Settings tabs never replays the animation.
    const wordmark = document.querySelector(".footer-band-wordmark .chroma-text");
    if (!wordmark) return;

    const settle = () => wordmark.classList.add("chroma-settled");
    wordmark.addEventListener("animationend", settle, { once: true });
    // Safety net: hiding the footer mid-sweep cancels the animation, so land on
    // the final state regardless.
    window.setTimeout(settle, 2000);
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

    // Hint prompt settings
    const hintPromptCheckbox = document.getElementById("hint-prompt-enabled");
    if (hintPromptCheckbox) {
      hintPromptCheckbox.addEventListener("change", (e) => {
        this.config.hintPromptEnabled = e.target.checked;
        chrome.storage.sync.set({ hint_prompt_enabled: e.target.checked });
        this.toggleHintPromptConfig(e.target.checked);
        spLog("Hint prompt enabled:", e.target.checked);
      });
    }

    const hintDefaultOptionInput = document.getElementById("hint-default-option");
    if (hintDefaultOptionInput) {
      hintDefaultOptionInput.addEventListener("change", (e) => {
        this.config.hintPromptDefaultOption = e.target.value;
        chrome.storage.sync.set({ hint_prompt_default_option: e.target.value });
        spLog("Hint prompt default option:", e.target.value);
      });
    }

    const hintDurationInput = document.getElementById("hint-prompt-duration");
    if (hintDurationInput) {
      hintDurationInput.addEventListener("change", (e) => {
        const val = Math.max(3, Math.min(60, parseInt(e.target.value, 10) || 10));
        e.target.value = val;
        this.config.hintPromptDuration = val;
        chrome.storage.sync.set({ hint_prompt_duration: val });
        spLog("Hint prompt duration:", val);
      });
    }
  }

  toggleHintPromptConfig(enabled) {
    const section = document.getElementById("hint-prompt-section");
    if (section) {
      section.classList.toggle("disabled-flow", !enabled);
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
    // Primary CTA — opens the website where credentials are created/synced.
    const websiteCta = authSection.querySelector("#auth-website-cta");
    if (websiteCta) {
      websiteCta.addEventListener("click", () => this.openSignIn());
    }

    // "Facing difficulty?" disclosure — reveals the manual credential fallback.
    const disclosureToggle = authSection.querySelector(
      "#auth-disclosure-toggle",
    );
    const disclosurePanel = authSection.querySelector(
      "#auth-disclosure-panel",
    );

    if (disclosureToggle && disclosurePanel) {
      disclosureToggle.addEventListener("click", () => {
        const isOpen = disclosurePanel.classList.toggle("open");
        disclosureToggle.classList.toggle("open", isOpen);
        disclosureToggle.setAttribute("aria-expanded", String(isOpen));

        if (isOpen) {
          const firstInput = disclosurePanel.querySelector("input");
          if (firstInput) firstInput.focus();
        }
      });
    }

    const loginForm = authSection.querySelector("#auth-login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", (event) =>
        this.handleLoginSubmit(event),
      );
    }

    this.initGlowyButtons(authSection);
  }

  /**
   * Vanilla port of the website's GlowyButton hover effect.
   * See website/src/components/ui/GlowyButton.tsx — cursor position is tracked
   * across the pill and a radial glow + border sheen is lerped toward it.
   */
  initGlowyButtons(root = document) {
    const wrappers = root.querySelectorAll(
      ".glowy-button-wrapper:not([data-glow-ready])",
    );

    wrappers.forEach((wrapper) => {
      wrapper.dataset.glowReady = "true";

      const button = wrapper.querySelector(".glowy-button");
      const glowContainer = wrapper.querySelector(
        ".glowy-button-glow-container",
      );
      const borderGlow1 = wrapper.querySelector(
        ".glowy-button-border-glow-blur-1",
      );
      const borderGlow2 = wrapper.querySelector(
        ".glowy-button-border-glow-blur-2",
      );

      if (!button || !glowContainer) return;

      const DEFAULT_OFFSET = 73;
      const MAX_MOVE = 73;
      const LEAVE_DELAY = 400;
      const LERP_FACTOR = 0.35;

      let isHovering = false;
      let currentX = DEFAULT_OFFSET;
      let targetX = DEFAULT_OFFSET;
      let frameId = null;
      let leaveTimer = null;

      const paint = () => {
        currentX += (targetX - currentX) * LERP_FACTOR;
        glowContainer.style.transform = `translate(-50%, -50%) translateX(${currentX}px) translateZ(0)`;

        if (Math.abs(currentX - targetX) > 0.1) {
          frameId = requestAnimationFrame(paint);
        } else {
          frameId = null;
        }
      };

      const start = () => {
        if (!frameId) frameId = requestAnimationFrame(paint);
      };

      glowContainer.style.transform = `translate(-50%, -50%) translateX(${DEFAULT_OFFSET}px) translateZ(0)`;

      wrapper.addEventListener("mouseenter", () => {
        isHovering = true;
        if (leaveTimer) {
          clearTimeout(leaveTimer);
          leaveTimer = null;
        }
        start();
      });

      wrapper.addEventListener("mousemove", (event) => {
        if (!isHovering) return;

        const rect = button.getBoundingClientRect();
        const centerX = rect.width / 2;
        const offsetRatio = (event.clientX - rect.left - centerX) / centerX;
        targetX = offsetRatio * MAX_MOVE;

        if (targetX < 0) {
          const leftRatio = Math.abs(targetX) / MAX_MOVE;
          const leftGlowOpacity = Math.max(
            0,
            Math.pow(leftRatio - 0.4, 2) * 2.5,
          );
          if (borderGlow2) {
            borderGlow2.style.opacity = String(
              Math.min(1, leftGlowOpacity),
            );
          }
          if (borderGlow1) borderGlow1.style.opacity = "0";
        } else {
          if (borderGlow2) borderGlow2.style.opacity = "0";
          if (borderGlow1) {
            borderGlow1.style.opacity = String(targetX / MAX_MOVE);
          }
        }

        start();
      });

      wrapper.addEventListener("mouseleave", () => {
        isHovering = false;
        leaveTimer = setTimeout(() => {
          leaveTimer = null;
          targetX = DEFAULT_OFFSET;
          if (borderGlow1) borderGlow1.style.opacity = "1";
          if (borderGlow2) borderGlow2.style.opacity = "0";
          start();
        }, LEAVE_DELAY);
      });
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
          "gemini_model",
          "avatar_url",
          "hint_prompt_enabled",
          "hint_prompt_default_option",
          "hint_prompt_duration",
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
            githubPushEnabled: data.github_push_enabled === true, // Default false
            timerOverlayEnabled: data.timer_overlay_enabled !== false, // Default true
            geminiModel: data.gemini_model || "gemini-3-flash-preview",
            avatarUrl: data.avatar_url || "",
            hintPromptEnabled: data.hint_prompt_enabled !== false, // Default true
            hintPromptDefaultOption: data.hint_prompt_default_option || "none", // Default 'none'
            hintPromptDuration: typeof data.hint_prompt_duration === 'number' && data.hint_prompt_duration > 0
              ? data.hint_prompt_duration
              : 10, // Default 10s
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

    // Hint prompt settings
    const hintPromptCheckbox = document.getElementById("hint-prompt-enabled");
    if (hintPromptCheckbox) {
      hintPromptCheckbox.checked = this.config.hintPromptEnabled !== false;
    }

    const hintDefaultOptionInput = document.getElementById("hint-default-option");
    const hintDefaultOptionCs = this.customSelects?.['hint-default-option'];
    if (hintDefaultOptionInput) {
      const val = this.config.hintPromptDefaultOption || "none";
      hintDefaultOptionInput.value = val;
      if (hintDefaultOptionCs) hintDefaultOptionCs.setValue(val);
    }

    const hintDurationInput = document.getElementById("hint-prompt-duration");
    if (hintDurationInput) {
      hintDurationInput.value = this.config.hintPromptDuration || 10;
    }

    this.toggleHintPromptConfig(this.config.hintPromptEnabled !== false);

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

      // Direct session in auth_user & auth_token takes precedence if present
      if (result.auth_user && result.auth_token) {
        const accountId = result.auth_active_account_id || (result.auth_user.id ? `backend:${result.auth_user.id}` : 'primary');
        const account = {
          id: accountId,
          user: result.auth_user,
          token: result.auth_token,
          timestamp: result.auth_timestamp || now,
        };
        this.authStatus = {
          isAuthenticated: true,
          user: result.auth_user,
          token: result.auth_token,
          accounts: [account],
          activeAccountId: accountId,
        };
        this.updateAuthSection();
      } else if (
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

      // Hide settings tab section since we are presenting this directly on the home tab dashboard
      if (accountSettingsSec) {
        accountSettingsSec.style.display = "none";
      }

      // Render Home tab profile dashboard (large avatar with refresh, displayName, email and actions)
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
            </div>
          </div>

          <div class="auth-actions" style="margin-top: 8px;">
            <button class="btn btn-secondary" id="sign-out-btn">Sign Out</button>
          </div>
        </div>
      `;

      const signOutBtn = document.getElementById("sign-out-btn");
      if (signOutBtn) {
        signOutBtn.addEventListener("click", () => this.signOut());
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
          <div class="auth-cta">
            <div class="glowy-button-wrapper">
              <div class="glowy-button-border-glow-blur glowy-button-border-glow-blur-1">
                <div class="glowy-button-border-light"></div>
              </div>
              <div class="glowy-button-border-glow-blur glowy-button-border-glow-blur-2">
                <div class="glowy-button-border-light"></div>
              </div>
              <button type="button" class="glowy-button" id="auth-website-cta">
                <span class="glowy-button-glow-container">
                  <span class="glowy-button-glow-inner"></span>
                  <span class="glowy-button-glow-outer"></span>
                </span>
                <span>Login / Register</span>
                <svg class="glowy-button-arrow-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 17 9" aria-hidden="true">
                  <path fill="currentColor" fill-rule="evenodd" d="m12.495 0 4.495 4.495-4.495 4.495-.99-.99 2.805-2.805H0v-1.4h14.31L11.505.99z" clip-rule="evenodd" />
                </svg>
              </button>
            </div>
          </div>

          <div class="auth-disclosure">
            <button type="button" class="auth-disclosure-toggle" id="auth-disclosure-toggle" aria-expanded="false" aria-controls="auth-disclosure-panel">
              <span>Facing difficulty?</span>
              <span class="auth-disclosure-chevron" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6" /></svg>
              </span>
            </button>

            <div class="auth-disclosure-panel" id="auth-disclosure-panel">
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
          </div>
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

  /* ── Platform recon ──
   *
   * The recorder itself lives in the content script (core/recon-controller.js)
   * and reports through chrome.storage.local. This panel only owns the two
   * settings (enabled + ingest token) and the status readout.
   */

  reconKeys() {
    const traverse = globalThis.Traverse;
    const recon = traverse && traverse.config ? traverse.config.recon : null;
    return (recon && recon.keys) || {
      enabled: "recon_enabled",
      token: "recon_ingest_token",
      status: "recon_status",
      bundle: "recon_bundle",
    };
  }

  async initializeRecon() {
    await this.loadReconSettings();
    this.setupReconListeners();
    await this.renderReconStatus();

    // The content script rewrites the status record as it captures; re-render
    // whenever that happens so the panel tracks a live session.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (changes[this.reconKeys().status]) this.renderReconStatus();
    });
  }

  async loadReconSettings() {
    const keys = this.reconKeys();
    const stored = await chrome.storage.local.get([keys.enabled]);

    const enabledEl = document.getElementById("recon-enabled");
    if (enabledEl) enabledEl.checked = stored[keys.enabled] !== false; // default on
  }

  setupReconListeners() {
    const keys = this.reconKeys();

    const enabledEl = document.getElementById("recon-enabled");
    if (enabledEl) {
      enabledEl.addEventListener("change", async (e) => {
        await chrome.storage.local.set({ [keys.enabled]: e.target.checked });
        this.setReconFeedback(e.target.checked ? "Recorder enabled" : "Recorder disabled", "ok");
        await this.renderReconStatus();
      });
    }

    const sendBtn = document.getElementById("recon-send");
    if (sendBtn) sendBtn.addEventListener("click", () => this.sendReconCapture());
  }

  async sendReconCapture() {
    const keys = this.reconKeys();
    const stored = await chrome.storage.local.get([keys.bundle]);
    const bundle = stored[keys.bundle];

    if (!bundle) {
      this.setReconFeedback("Nothing captured yet — open a problem page first", "error");
      return;
    }

    const events = Array.isArray(bundle.network) ? bundle.network.length : 0;
    this.setReconFeedback(`Sending ${events} event(s)…`, "");

    const result = await this.sendMessageToBackground({ type: "RECON_UPLOAD" });

    if (result && result.success) {
      this.setReconFeedback(`Capture sent — ${events} event(s) from ${bundle.platform}`, "ok");
    } else {
      this.setReconFeedback(`Send failed: ${(result && result.error) || "unknown error"}`, "error");
    }

    await this.renderReconStatus();
  }

  async renderReconStatus() {
    const keys = this.reconKeys();
    const stored = await chrome.storage.local.get([keys.status]);
    const status = stored[keys.status] || {};

    // Whether recording is possible comes from the controller, which resolves
    // the stored override *and* the built-in token. Reading the storage key
    // directly would report "no token" for every user who never set one — i.e.
    // all of them, now that the field is gone.
    const hasToken = status.hasToken !== false;

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };

    setText("recon-st-platform", status.platform || status.host || "no tracked site");

    let recorderState;
    if (!hasToken) recorderState = "no token";
    else if (status.excluded) recorderState = "excluded site";
    else if (status.armed) recorderState = "recording";
    else if (status.onProblemPage) recorderState = "idle";
    else recorderState = "not on a problem page";
    setText("recon-st-armed", recorderState);

    setText(
      "recon-st-events",
      typeof status.eventCount === "number"
        ? `${status.eventCount}${status.overflowed ? " (capped)" : ""}`
        : "—"
    );
    setText("recon-st-uploaded", status.uploadedAt ? this.formatRelativeTime(status.uploadedAt) : "never");

    this.renderReconFlows(status.flows || {}, status);
  }

  /**
   * Rendered with DOM APIs rather than innerHTML: the detail line is a verdict
   * string scraped from a third-party page, and must never be interpreted as
   * markup inside the extension's own UI.
   */
  renderReconFlows(flows, status = {}) {
    const container = document.getElementById("recon-flows");
    if (!container) return;

    const labels = {
      "run-pass": "Run — passed",
      "run-fail": "Run — failed",
      "submit-pass": "Submit — accepted",
      "submit-fail": "Submit — rejected",
    };

    container.textContent = "";

    for (const id of Object.keys(labels)) {
      const flow = flows[id] || {};
      const observed = flow.status === "observed";
      const uncertain = flow.status === "uncertain";

      const row = document.createElement("div");
      row.className = `recon-flow${observed ? " done" : uncertain ? " uncertain" : ""}`;

      const dot = document.createElement("span");
      dot.className = "recon-flow-dot";

      const label = document.createElement("span");
      label.textContent = labels[id];

      const detail = document.createElement("span");
      detail.className = "recon-flow-status";
      // "not seen", not "waiting": the four flows describe a complete picture,
      // not a requirement. Saying "waiting" implied the upload was blocked on
      // flows that most platforms will never produce.
      const detailText = observed
        ? (flow.verdict && flow.verdict.status) || "captured"
        : uncertain
          ? "no verdict"
          : "not seen";
      detail.textContent = detailText;
      detail.title = detailText;

      row.append(dot, label, detail);
      container.append(row);
    }

    this.renderReconFlowsSummary(status);
  }

  /**
   * Say plainly what will happen to what has been captured, because the failure
   * this replaced was silent: a capture that never uploaded looked identical to
   * one still in progress.
   */
  renderReconFlowsSummary(status) {
    const el = document.getElementById("recon-flows-summary");
    if (!el) return;

    const count = typeof status.observedFlowCount === "number"
      ? status.observedFlowCount
      : Object.values(status.flows || {}).filter((f) => f && f.status === "observed").length;

    el.classList.remove("is-ready");

    if (!count) {
      el.textContent = "Nothing captured yet — run or submit on this page.";
      return;
    }

    if (status.uploadedAt && !status.uploadPending) {
      el.textContent = `${count} flow${count === 1 ? "" : "s"} captured · uploaded ${this.formatRelativeTime(status.uploadedAt)}`;
      return;
    }

    const timing = status.hasPassFailPair
      ? "uploads in a few seconds"
      : "uploads shortly unless another attempt comes in";
    el.textContent = `${count} flow${count === 1 ? "" : "s"} captured — ${timing}.`;
    el.classList.add("is-ready");
  }

  formatRelativeTime(iso) {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "—";

    const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  setReconFeedback(message, type = "") {
    const el = document.getElementById("recon-feedback");
    if (!el) return;
    el.textContent = message || "";
    el.className = `recon-feedback${type ? ` ${type}` : ""}`;
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
