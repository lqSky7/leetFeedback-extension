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

    // Timer state
    this.problemUrl = null;
    this.startTime = null;
    this.pausedTime = 0;
    this.isTabHidden = document.hidden;
    this.tabHiddenAt = null;
    this.isPaused = false;
    this.pausedAt = null;

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
      console.error("[ProblemTimer] Error checking settings:", error);
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

    console.log("[ProblemTimer] Initialized");
  }

  // Start tracking time for a problem
  async startTimer(problemUrl) {
    // Ensure initialization is complete before proceeding
    await this._initPromise;

    if (!problemUrl) {
      console.warn("[ProblemTimer] No problem URL provided");
      return;
    }

    // If same problem, just update overlay
    if (this.problemUrl === problemUrl && this.startTime) {
      console.log("[ProblemTimer] Same problem, continuing timer");
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
      console.log("[ProblemTimer] Started fresh timer for:", problemUrl);
    } else {
      console.log(
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
    this.startTime = Date.now();
    this.pausedTime = 0;
    this.isTabHidden = document.hidden;
    this.tabHiddenAt = null;
    this.isPaused = false;
    this.pausedAt = null;
    console.log("[ProblemTimer] Timer reset");
  }

  // Setup visibility change tracking
  setupVisibilityTracking() {
    document.addEventListener("visibilitychange", async () => {
      if (document.hidden) {
        // Tab is now hidden - record when we started being hidden
        this.isTabHidden = true;
        this.tabHiddenAt = Date.now();
        console.log("[ProblemTimer] Tab hidden, pausing timer");
      } else {
        // Tab is now visible - add the hidden duration to pausedTime (unless paused)
        this.isTabHidden = false;
        if (this.tabHiddenAt && this.startTime && !this.isPaused) {
          const hiddenDuration = Date.now() - this.tabHiddenAt;
          this.pausedTime += hiddenDuration;
          console.log(
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

    const now = Date.now();
    let elapsed = now - this.startTime - this.pausedTime;

    // If currently hidden, don't count the current hidden duration
    if (this.isTabHidden && this.tabHiddenAt) {
      const currentHiddenDuration = now - this.tabHiddenAt;
      elapsed -= currentHiddenDuration;
    }

    // If currently paused, don't count the current paused duration
    if (this.isPaused && this.pausedAt) {
      const currentPausedDuration = now - this.pausedAt;
      elapsed -= currentPausedDuration;
    }

    // Ensure elapsed time is always positive
    if (elapsed < 0) {
      console.warn(
        "[ProblemTimer] Negative elapsed time detected, resetting timer",
      );
      this.startTime = now;
      this.pausedTime = 0;
      this.tabHiddenAt = null;
      return 0;
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

    console.log("[ProblemTimer] Timer reset for current problem");
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
    return this.pausedTime;
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
        console.log(
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

      console.log(
        "[ProblemTimer] Loaded from storage - startTime:",
        this.startTime,
        "pausedTime:",
        this.pausedTime,
        "position:",
        this.currentX,
        this.currentY,
      );
    } catch (error) {
      console.error("[ProblemTimer] Error loading from storage:", error);
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

        await chrome.storage.local.set({ [storageKey]: problemData });
      } catch (error) {
        console.error("[ProblemTimer] Error saving to storage:", error);
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
      console.error("[ProblemTimer] Error saving overlay position:", error);
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
      z-index: 999998;
      background: rgba(0, 0, 0, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 10px 16px;
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
      font-size: 14px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 10px;
      opacity: 0.6;
      transition: opacity 0.2s ease, transform 0.2s ease;
      cursor: move;
      user-select: none;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    `;

    // Timer icon
    const icon = document.createElement("span");
    icon.style.cssText = `font-size: 16px; opacity: 0.8;`;
    icon.textContent = "⏱";

    // Time display
    const timeDisplay = document.createElement("span");
    timeDisplay.id = "leetfeedback-timer-time";
    timeDisplay.style.cssText = `
      min-width: 60px;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.5px;
    `;
    timeDisplay.textContent = "00:00";

    // Pause/Resume button
    const pauseBtn = document.createElement("button");
    pauseBtn.id = "leetfeedback-timer-pause-btn";
    pauseBtn.style.cssText = `
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: rgba(255, 255, 255, 0.6);
      width: 24px;
      height: 24px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    `;
    pauseBtn.textContent = this.isPaused ? "▶" : "⏸";
    pauseBtn.title = this.isPaused ? "Resume timer" : "Pause timer";

    pauseBtn.addEventListener("mouseover", () => {
      pauseBtn.style.background = "rgba(255, 255, 255, 0.2)";
      pauseBtn.style.color = "white";
    });
    pauseBtn.addEventListener("mouseout", () => {
      pauseBtn.style.background = "rgba(255, 255, 255, 0.1)";
      pauseBtn.style.color = "rgba(255, 255, 255, 0.6)";
    });
    pauseBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (this.isPaused) {
        await this.resumeTimer();
      } else {
        await this.pauseTimer();
      }
    });

    // Close button
    const closeBtn = document.createElement("button");
    closeBtn.style.cssText = `
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: rgba(255, 255, 255, 0.6);
      width: 20px;
      height: 20px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      margin-left: 4px;
    `;
    closeBtn.textContent = "×";
    closeBtn.title = "Hide timer (re-enable in extension settings)";

    // Add event listeners instead of inline handlers
    closeBtn.addEventListener("mouseover", () => {
      closeBtn.style.background = "rgba(255, 255, 255, 0.2)";
      closeBtn.style.color = "white";
    });
    closeBtn.addEventListener("mouseout", () => {
      closeBtn.style.background = "rgba(255, 255, 255, 0.1)";
      closeBtn.style.color = "rgba(255, 255, 255, 0.6)";
    });
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.hideOverlay();
      // Disable in settings
      chrome.storage.sync.set({ timer_overlay_enabled: false });
    });

    // Reset button
    const resetBtn = document.createElement("button");
    resetBtn.style.cssText = `
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: rgba(255, 255, 255, 0.6);
      width: 20px;
      height: 20px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    `;
    resetBtn.textContent = "↺";
    resetBtn.title = "Reset timer";

    // Add event listeners instead of inline handlers
    resetBtn.addEventListener("mouseover", () => {
      resetBtn.style.background = "rgba(255, 255, 255, 0.2)";
      resetBtn.style.color = "white";
    });
    resetBtn.addEventListener("mouseout", () => {
      resetBtn.style.background = "rgba(255, 255, 255, 0.1)";
      resetBtn.style.color = "rgba(255, 255, 255, 0.6)";
    });
    resetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.resetTimer();
    });

    this.overlay.appendChild(icon);
    this.overlay.appendChild(timeDisplay);
    this.overlay.appendChild(pauseBtn);
    this.overlay.appendChild(resetBtn);
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
  }
}

// Create singleton and expose globally
window.ProblemTimer = ProblemTimer;

// Auto-initialize
const problemTimer = ProblemTimer.getInstance();

console.log("[ProblemTimer] Problem timer utility loaded");
