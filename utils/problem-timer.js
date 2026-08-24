// ProblemTimer - Unified time tracking utility for DSA problems
// Handles visibility tracking, pausedTime calculation, and timer overlay display
// Used by content scripts (leetcode.js, takeuforward.js, geeksforgeeks.js)

class ProblemTimer {
  constructor() {
    // Singleton pattern
    if (window._problemTimerInstance) {
      return window._problemTimerInstance;
    }
    window._problemTimerInstance = this;

    // Debug-aware logging
    this._log = (...args) => {
      if (typeof DSAUtils !== 'undefined' && DSAUtils.getDebugMode && DSAUtils.getDebugMode()) {
        console.log(...args);
      }
    };
    this._error = (...args) => {
      if (typeof DSAUtils !== 'undefined' && DSAUtils.getDebugMode && DSAUtils.getDebugMode()) {
        console.error(...args);
      }
    };
    this._warn = (...args) => {
      if (typeof DSAUtils !== 'undefined' && DSAUtils.getDebugMode && DSAUtils.getDebugMode()) {
        console.warn(...args);
      }
    };

    // Timer state
    this.problemUrl = null;
    this.startTime = null;
    this.pausedTime = 0;
    this.isTabHidden = document.hidden;
    this.tabHiddenAt = null;
    this.isPaused = false;
    this.pausedAt = null;
    this.lastSaveTime = 0;

    // Overlay state
    this.overlay = null;
    this.displayIntervalId = null;
    this.isEnabled = true;

    // Dragging state
    this.isDragging = false;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    this.currentX = window.innerWidth - 220; // Default to bottom-right
    this.currentY = window.innerHeight - 120;

    // Drag cleanup functions
    this._dragMouseMoveHandler = null;
    this._dragMouseUpHandler = null;

    // Initialize
    this._initPromise = this.init();
    this._saveQueue = Promise.resolve(); // Queue for serializing storage writes
  }

  static getInstance() {
    if (!window._problemTimerInstance) {
      window._problemTimerInstance = new ProblemTimer();
    }
    return window._problemTimerInstance;
  }

  async init() {
    // Check if timer overlay is enabled in settings
    try {
      const result = await chrome.storage.sync.get(["timer_overlay_enabled"]);
      this.isEnabled = result.timer_overlay_enabled !== false; // Default to true

      // Load saved position
      const positionResult = await chrome.storage.local.get([
        "timer_overlay_position",
      ]);
      if (positionResult.timer_overlay_position) {
        this.currentX = positionResult.timer_overlay_position.x;
        this.currentY = positionResult.timer_overlay_position.y;
      }
    } catch (error) {
      this._error("[ProblemTimer] Error checking settings:", error);
    }

    // Setup visibility tracking
    this.setupVisibilityTracking();

    // Setup window resize handling
    window.addEventListener("resize", () => {
      if (this.overlay) {
        this.constrainToViewport();
      }
    });

    // Listen for setting changes
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync" && changes.timer_overlay_enabled) {
        this.isEnabled = changes.timer_overlay_enabled.newValue !== false;
        if (this.isEnabled && this.problemUrl) {
          this.showOverlay();
        } else {
          this.hideOverlay();
        }
      }
    });

    this._log("[ProblemTimer] Initialized");
  }

  // Start tracking time for a problem
  async startTimer(problemUrl) {
    // Ensure initialization is complete before proceeding
    await this._initPromise;

    if (!problemUrl) {
      this._warn("[ProblemTimer] No problem URL provided");
      return;
    }

    // If same problem, just update overlay
    if (this.problemUrl === problemUrl && this.startTime) {
      this._log("[ProblemTimer] Same problem, continuing timer");
      if (this.isEnabled) this.showOverlay();
      return;
    }

    this.problemUrl = problemUrl;

    // Try to load existing time data from storage
    await this.loadFromStorage();

    // If no existing data, start fresh
    if (!this.startTime) {
      this.startTime = Date.now();
      this.pausedTime = 0;
      this._log("[ProblemTimer] Started fresh timer for:", problemUrl);
    } else {
      this._log(
        "[ProblemTimer] Resumed timer for:",
        problemUrl,
        "- elapsed:",
        this.getElapsedActiveTime(),
        "ms",
      );
    }

    // Save initial state to storage
    await this.saveToStorage();

    // Show overlay if enabled
    if (this.isEnabled) {
      this.showOverlay();
    }
  }

  // Reset timer (called when navigating to a new problem)
  reset() {
    this.problemUrl = null; // Clear so subsequent startTimer will reload storage
    this.startTime = Date.now();
    this.pausedTime = 0;
    this.isTabHidden = document.hidden;
    this.tabHiddenAt = null;
    this.isPaused = false;
    this.pausedAt = null;
    this._log("[ProblemTimer] Timer reset");
  }

  // Setup visibility change tracking
  setupVisibilityTracking() {
    document.addEventListener("visibilitychange", async () => {
      if (document.hidden) {
        // Tab is now hidden - record when we started being hidden
        this.isTabHidden = true;
        this.tabHiddenAt = Date.now();
        this._log("[ProblemTimer] Tab hidden, pausing timer");
      } else {
        // Tab is now visible - add the hidden duration to pausedTime (unless paused)
        this.isTabHidden = false;
        if (this.tabHiddenAt && this.startTime && !this.isPaused) {
          const hiddenDuration = Date.now() - this.tabHiddenAt;
          this.pausedTime += hiddenDuration;
          this._log(
            `[ProblemTimer] Tab visible, was hidden for ${Math.floor(hiddenDuration / 1000)}s, total paused: ${Math.floor(this.pausedTime / 1000)}s`,
          );
          // Save updated pausedTime to storage
          await this.saveToStorage();
        }
        this.tabHiddenAt = null;
      }
    });
  }

  // Get current elapsed active time in milliseconds
  getElapsedActiveTime() {
    if (!this.startTime) return 0;

    // If currently paused, elapsed active time is frozen at the moment of pause
    if (this.isPaused && this.pausedAt) {
      const elapsed = this.pausedAt - this.startTime - this.pausedTime;
      return Math.max(0, elapsed);
    }

    const now = Date.now();
    let elapsed = now - this.startTime - this.pausedTime;

    // If currently hidden, don't count the current hidden duration
    if (this.isTabHidden && this.tabHiddenAt) {
      const currentHiddenDuration = now - this.tabHiddenAt;
      elapsed -= currentHiddenDuration;
    }

    // Ensure elapsed time is always positive
    if (elapsed < 0) {
      this._warn(
        "[ProblemTimer] Negative elapsed time detected, resetting timer",
      );
      this.startTime = now;
      this.pausedTime = 0;
      this.tabHiddenAt = null;
      return 0;
    }

    // Hard cap at 2 hours for all platforms
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000; // 7,200,000 milliseconds
    if (elapsed > TWO_HOURS_MS) {
      return TWO_HOURS_MS;
    }

    return elapsed;
  }

  // Reset timer for current problem (called from overlay or when navigating to new problem)
  async resetTimer() {
    this.startTime = Date.now();
    this.pausedTime = 0;
    this.isTabHidden = document.hidden;
    this.tabHiddenAt = null;
    this.isPaused = false;
    this.pausedAt = null;

    // Save reset state to storage
    await this.saveToStorage();

    // Update display immediately
    this.updateDisplay();

    this._log("[ProblemTimer] Timer reset for current problem");
  }

  // Pause the timer (does not change startTime, accumulates pausedAt until resumed)
  async pauseTimer() {
    if (this.isPaused) return;
    this.isPaused = true;
    this.pausedAt = Date.now();

    // Prevent rapid toggle while we persist the change
    const btn = document.getElementById("leetfeedback-timer-pause-btn");
    if (btn) btn.disabled = true;

    await this.saveToStorage();

    if (btn) btn.disabled = false;
    this.updatePauseButton();
    this.updateDisplay();
  }

  // Resume the timer and add paused duration to pausedTime
  async resumeTimer() {
    if (!this.isPaused) return;
    const now = Date.now();
    const pauseDuration = now - (this.pausedAt || now);
    this.pausedTime += pauseDuration;
    this.isPaused = false;
    this.pausedAt = null;

    // Prevent rapid toggle while we persist the change
    const btn = document.getElementById("leetfeedback-timer-pause-btn");
    if (btn) btn.disabled = true;

    await this.saveToStorage();

    if (btn) btn.disabled = false;
    this.updatePauseButton();
    this.updateDisplay();
  }

  updatePauseButton() {
    const btn = document.getElementById("leetfeedback-timer-pause-btn");
    if (!btn) return;
    btn.textContent = this.isPaused ? "▶" : "⏸";
    btn.title = this.isPaused ? "Resume timer" : "Pause timer";
    btn.setAttribute(
      "aria-label",
      this.isPaused ? "Resume timer" : "Pause timer",
    );
    btn.setAttribute("aria-pressed", this.isPaused ? "true" : "false");
    if (this.overlay) {
      this.overlay.style.opacity = this.isPaused ? "0.45" : "0.6";
    }
  }

  // Get values for content scripts to use when saving problem data
  getStartTime() {
    return this.startTime;
  }

  getPausedTime() {
    let total = this.pausedTime;
    // Include the ongoing pause duration if currently paused
    if (this.isPaused && this.pausedAt) {
      total += Date.now() - this.pausedAt;
    }
    return total;
  }

  // Load time data from storage
  async loadFromStorage() {
    if (!this.problemUrl) return;

    try {
      // Check if browser was restarted
      const sessionResult = await chrome.storage.local.get([
        "browser_session_restarted",
        "session_start_time",
      ]);

      if (sessionResult.browser_session_restarted) {
        this._log(
          "[ProblemTimer] Browser session restarted - resetting timer",
        );
        // Clear the restart flag
        await chrome.storage.local.remove(["browser_session_restarted"]);
        // Don't load old timer data, start fresh
        return;
      }

      const storageKey = `problem_data_${this.problemUrl}`;
      const result = await chrome.storage.local.get([storageKey]);
      const problemData = result[storageKey] || {};

      const isSolved = problemData.solved && problemData.solved.value;
      const now = Date.now();
      const lastActiveTime = problemData.lastActiveTime || 0;
      const lastTimestamp = problemData.timestamp ? new Date(problemData.timestamp).getTime() : 0;
      const referenceTime = lastActiveTime || lastTimestamp;

      const INACTIVITY_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours

      if (isSolved || (referenceTime && (now - referenceTime > INACTIVITY_TIMEOUT))) {
        this._log("[ProblemTimer] Solved or inactive for too long. Starting fresh timer.");
        this.startTime = null;
        this.pausedTime = 0;
        this.isPaused = false;
        this.pausedAt = null;
        return;
      }

      // If resuming within timeout, adjust pausedTime for offline/closed tab duration
      if (referenceTime && !problemData.isPaused) {
        const offlineDuration = now - referenceTime;
        if (offlineDuration > 0) {
          this.startTime = problemData.problemStartTime;
          this.pausedTime = (problemData.pausedTime || 0) + offlineDuration;
          this.isPaused = !!problemData.isPaused;
          this.pausedAt = problemData.pausedAt || null;
          this._log(`[ProblemTimer] Adjusted pausedTime by ${Math.floor(offlineDuration / 1000)}s for offline duration`);
          return;
        }
      }

      this.startTime = problemData.problemStartTime;
      this.pausedTime = problemData.pausedTime || 0;
      this.isPaused = !!problemData.isPaused;
      this.pausedAt = problemData.pausedAt || null;

      // Load overlay position
      const positionResult = await chrome.storage.local.get([
        "timer_overlay_position",
      ]);
      if (positionResult.timer_overlay_position) {
        this.currentX = positionResult.timer_overlay_position.x;
        this.currentY = positionResult.timer_overlay_position.y;
      }

      this._log(
        "[ProblemTimer] Loaded from storage - startTime:",
        this.startTime,
        "pausedTime:",
        this.pausedTime,
        "position:",
        this.currentX,
        this.currentY,
      );
    } catch (error) {
      this._error("[ProblemTimer] Error loading from storage:", error);
    }
  }

  // Save time data to storage
  async saveToStorage() {
    if (!this.problemUrl) return;

    // Snapshot the state now so queued saves reflect the state at the time
    // the operation was requested instead of reading current state later.
    const snapshot = {
      problemStartTime: this.startTime,
      pausedTime: this.pausedTime,
      isPaused: this.isPaused,
      pausedAt: this.isPaused ? this.pausedAt : null,
      lastActiveTime: Date.now()
    };

    // Queue the save operation to prevent race conditions (uses snapshot)
    this._saveQueue = this._saveQueue.then(async () => {
      try {
        const storageKey = `problem_data_${this.problemUrl}`;
        const result = await chrome.storage.local.get([storageKey]);
        const problemData = result[storageKey] || {};

        problemData.problemStartTime = snapshot.problemStartTime;
        problemData.pausedTime = snapshot.pausedTime;
        problemData.isPaused = snapshot.isPaused;
        problemData.pausedAt = snapshot.isPaused ? snapshot.pausedAt : null;
        problemData.lastActiveTime = snapshot.lastActiveTime;

        await chrome.storage.local.set({ [storageKey]: problemData });
      } catch (error) {
        this._error("[ProblemTimer] Error saving to storage:", error);
      }
    });

    // Wait for this save operation to complete
    await this._saveQueue;
  }

  // Save overlay position to storage (only when position changes)
  async saveOverlayPosition() {
    try {
      await chrome.storage.local.set({
        timer_overlay_position: { x: this.currentX, y: this.currentY },
      });
    } catch (error) {
      this._error("[ProblemTimer] Error saving overlay position:", error);
    }
  }

  // ========== OVERLAY METHODS ==========

  showOverlay() {
    if (this.overlay) return; // Already showing

    this.createOverlay();
    this.startDisplayUpdate();
  }

  hideOverlay() {
    // Clean up any active drag operation
    if (this.isDragging) {
      this.isDragging = false;
      if (this._dragMouseMoveHandler) {
        document.removeEventListener("mousemove", this._dragMouseMoveHandler);
        this._dragMouseMoveHandler = null;
      }
      if (this._dragMouseUpHandler) {
        document.removeEventListener("mouseup", this._dragMouseUpHandler);
        this._dragMouseUpHandler = null;
      }
    }

    if (this.displayIntervalId) {
      clearInterval(this.displayIntervalId);
      this.displayIntervalId = null;
    }

    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
      this.overlay = null;
    }
  }

  createOverlay() {
    if (this.overlay) return;

    this.overlay = document.createElement("div");
    this.overlay.id = "leetfeedback-timer-overlay";
    this.overlay.style.cssText = `
      position: fixed;
      top: ${this.currentY}px;
      left: ${this.currentX}px;
      z-index: 2147483647;
      background: rgba(10, 10, 10, 0.9);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: 10px;
      padding: 0 0 0 14px;
      color: #FFFFFF;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      height: 38px;
      opacity: 0.75;
      transition: opacity 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
      cursor: move;
      user-select: none;
      box-shadow: none;
      overflow: hidden;
    `;

    // Timer icon
    const icon = document.createElement("span");
    icon.style.cssText = `
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #276EF1;
      margin-right: 10px;
      flex-shrink: 0;
    `;

    // Time display
    const timeDisplay = document.createElement("span");
    timeDisplay.id = "leetfeedback-timer-time";
    timeDisplay.style.cssText = `
      min-width: 58px;
      font-variant-numeric: tabular-nums;
      font-family: -apple-system, BlinkMacSystemFont, 'SFMono-Regular', Consolas, monospace;
      letter-spacing: 0.5px;
      margin-right: 12px;
      flex-shrink: 0;
      color: #FFFFFF;
    `;
    timeDisplay.textContent = "00:00";

    // Dividers
    const createDivider = () => {
      const div = document.createElement("div");
      div.style.cssText = `
        width: 1px;
        height: 100%;
        background: rgba(255, 255, 255, 0.12);
        flex-shrink: 0;
      `;
      return div;
    };

    // Pause/Resume button
    const pauseBtn = document.createElement("button");
    pauseBtn.id = "leetfeedback-timer-pause-btn";
    pauseBtn.style.cssText = `
      background: transparent;
      border: none;
      color: #A6A6A6;
      height: 100%;
      padding: 0 14px;
      cursor: pointer;
      font-size: 11px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
      flex-shrink: 0;
    `;
    pauseBtn.textContent = this.isPaused ? "▶" : "⏸";
    pauseBtn.title = this.isPaused ? "Resume timer" : "Pause timer";

    pauseBtn.addEventListener("mouseover", () => {
      pauseBtn.style.background = "rgba(255, 255, 255, 0.1)";
      pauseBtn.style.color = "#FFFFFF";
    });
    pauseBtn.addEventListener("mouseout", () => {
      pauseBtn.style.background = "transparent";
      pauseBtn.style.color = "#A6A6A6";
    });
    pauseBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (this.isPaused) {
        await this.resumeTimer();
      } else {
        await this.pauseTimer();
      }
    });

    // Reset button
    const resetBtn = document.createElement("button");
    resetBtn.style.cssText = `
      background: transparent;
      border: none;
      color: #A6A6A6;
      height: 100%;
      padding: 0 14px;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
      flex-shrink: 0;
    `;
    resetBtn.textContent = "↺";
    resetBtn.title = "Reset timer";

    resetBtn.addEventListener("mouseover", () => {
      resetBtn.style.background = "rgba(255, 255, 255, 0.1)";
      resetBtn.style.color = "#FFFFFF";
    });
    resetBtn.addEventListener("mouseout", () => {
      resetBtn.style.background = "transparent";
      resetBtn.style.color = "#A6A6A6";
    });
    resetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.resetTimer();
    });

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.style.cssText = `
      background: transparent;
      border: none;
      color: #8A8A8A;
      height: 100%;
      padding: 0 14px;
      cursor: pointer;
      font-size: 15px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s ease;
      flex-shrink: 0;
    `;
    closeBtn.textContent = "×";
    closeBtn.title = "Hide timer (re-enable in extension settings)";

    closeBtn.addEventListener("mouseover", () => {
      closeBtn.style.background = "rgba(255, 255, 255, 0.1)";
      closeBtn.style.color = "#FFFFFF";
    });
    closeBtn.addEventListener("mouseout", () => {
      closeBtn.style.background = "transparent";
      closeBtn.style.color = "#8A8A8A";
    });
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hideOverlay();
      chrome.storage.sync.set({ timer_overlay_enabled: false });
    });

    this.overlay.appendChild(icon);
    this.overlay.appendChild(timeDisplay);
    this.overlay.appendChild(createDivider());
    this.overlay.appendChild(pauseBtn);
    this.overlay.appendChild(createDivider());
    this.overlay.appendChild(resetBtn);
    this.overlay.appendChild(createDivider());
    this.overlay.appendChild(closeBtn);

    // Add drag functionality
    this.setupDragging();

    // Reflect paused state in the UI
    this.updatePauseButton();

    // Hover effects using event listeners instead of inline handlers
    this.overlay.addEventListener("mouseover", () => {
      this.overlay.style.opacity = "1";
      this.overlay.style.transform = "scale(1.02)";
    });
    this.overlay.addEventListener("mouseout", () => {
      this.overlay.style.opacity = "0.6";
      this.overlay.style.transform = "scale(1)";
    });

    document.body.appendChild(this.overlay);
  }

  setupDragging() {
    const handleMouseDown = (e) => {
      if (e.target.tagName === "BUTTON") return; // Don't drag when clicking buttons

      this.isDragging = true;
      const rect = this.overlay.getBoundingClientRect();
      this.dragOffsetX = e.clientX - rect.left;
      this.dragOffsetY = e.clientY - rect.top;

      this.overlay.style.transition = "none"; // Disable transition during drag
      this.overlay.style.opacity = "1";
      this.overlay.style.transform = "scale(1.05)";
      this.overlay.style.cursor = "grabbing";

      // Store handler references for cleanup
      this._dragMouseMoveHandler = handleMouseMove;
      this._dragMouseUpHandler = handleMouseUp;

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);

      e.preventDefault();
    };

    const handleMouseMove = (e) => {
      if (!this.isDragging) return;

      let newX = e.clientX - this.dragOffsetX;
      let newY = e.clientY - this.dragOffsetY;

      // Keep overlay within viewport bounds
      const rect = this.overlay.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width;
      const maxY = window.innerHeight - rect.height;

      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY));

      this.currentX = newX;
      this.currentY = newY;

      this.overlay.style.left = `${newX}px`;
      this.overlay.style.top = `${newY}px`;
    };

    const handleMouseUp = async () => {
      if (!this.isDragging) return;

      this.isDragging = false;
      this.overlay.style.transition = "opacity 0.2s ease, transform 0.2s ease";
      this.overlay.style.cursor = "move";
      this.overlay.style.opacity = "0.6";
      this.overlay.style.transform = "scale(1)";

      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);

      // Clear handler references
      this._dragMouseMoveHandler = null;
      this._dragMouseUpHandler = null;

      // Save new position
      await this.saveOverlayPosition();
    };

    this.overlay.addEventListener("mousedown", handleMouseDown);
  }

  constrainToViewport() {
    if (!this.overlay) return;

    const rect = this.overlay.getBoundingClientRect();
    let newX = this.currentX;
    let newY = this.currentY;

    const maxX = window.innerWidth - rect.width;
    const maxY = window.innerHeight - rect.height;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    if (newX !== this.currentX || newY !== this.currentY) {
      this.currentX = newX;
      this.currentY = newY;
      this.overlay.style.left = `${newX}px`;
      this.overlay.style.top = `${newY}px`;
      this.saveOverlayPosition(); // Save constrained position
    }
  }

  startDisplayUpdate() {
    if (this.displayIntervalId) return;

    // Update every second
    this.displayIntervalId = setInterval(() => {
      this.updateDisplay();
    }, 1000);

    // Update immediately
    this.updateDisplay();
  }

  updateDisplay() {
    if (!this.overlay || !this.startTime) return;

    const timeDisplay = document.getElementById("leetfeedback-timer-time");
    if (!timeDisplay) return;

    const elapsed = this.getElapsedActiveTime();
    const seconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    let timeStr;
    if (hours > 0) {
      timeStr = `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    } else {
      timeStr = `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    }

    timeDisplay.textContent = timeStr;

    // Periodically update lastActiveTime in storage (once per minute) to prevent session timeouts
    const now = Date.now();
    if (!this.lastSaveTime || now - this.lastSaveTime > 60000) { // 1 minute
      this.lastSaveTime = now;
      this.saveToStorage().catch(err => this._error("[ProblemTimer] Periodical save failed:", err));
    }
  }
}

// Create singleton and expose globally
window.ProblemTimer = ProblemTimer;

// Auto-initialize
const problemTimer = ProblemTimer.getInstance();

// ProblemTimer utility loaded
