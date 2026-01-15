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

        // Overlay state
        this.overlay = null;
        this.displayIntervalId = null;
        this.isEnabled = true;

        // Initialize
        this.init();
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
            const result = await chrome.storage.sync.get(['timer_overlay_enabled']);
            this.isEnabled = result.timer_overlay_enabled !== false; // Default to true
        } catch (error) {
            console.error('[ProblemTimer] Error checking settings:', error);
        }

        // Setup visibility tracking
        this.setupVisibilityTracking();

        // Listen for setting changes
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync' && changes.timer_overlay_enabled) {
                this.isEnabled = changes.timer_overlay_enabled.newValue !== false;
                if (this.isEnabled && this.problemUrl) {
                    this.showOverlay();
                } else {
                    this.hideOverlay();
                }
            }
        });

        console.log('[ProblemTimer] Initialized');
    }

    // Start tracking time for a problem
    async startTimer(problemUrl) {
        if (!problemUrl) {
            console.warn('[ProblemTimer] No problem URL provided');
            return;
        }

        // If same problem, just update overlay
        if (this.problemUrl === problemUrl && this.startTime) {
            console.log('[ProblemTimer] Same problem, continuing timer');
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
            console.log('[ProblemTimer] Started fresh timer for:', problemUrl);
        } else {
            console.log('[ProblemTimer] Resumed timer for:', problemUrl,
                '- elapsed:', this.getElapsedActiveTime(), 'ms');
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
        console.log('[ProblemTimer] Timer reset');
    }

    // Setup visibility change tracking
    setupVisibilityTracking() {
        document.addEventListener('visibilitychange', async () => {
            if (document.hidden) {
                // Tab is now hidden - record when we started being hidden
                this.isTabHidden = true;
                this.tabHiddenAt = Date.now();
                console.log('[ProblemTimer] Tab hidden, pausing timer');
            } else {
                // Tab is now visible - add the hidden duration to pausedTime
                this.isTabHidden = false;
                if (this.tabHiddenAt && this.startTime) {
                    const hiddenDuration = Date.now() - this.tabHiddenAt;
                    this.pausedTime += hiddenDuration;
                    console.log(`[ProblemTimer] Tab visible, was hidden for ${Math.floor(hiddenDuration / 1000)}s, total paused: ${Math.floor(this.pausedTime / 1000)}s`);
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
        return Date.now() - this.startTime - this.pausedTime;
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
            const storageKey = `problem_data_${this.problemUrl}`;
            const result = await chrome.storage.local.get([storageKey]);
            const problemData = result[storageKey];

            if (problemData && problemData.problemStartTime) {
                this.startTime = problemData.problemStartTime;
                this.pausedTime = problemData.pausedTime || 0;
                console.log('[ProblemTimer] Loaded from storage - startTime:', this.startTime, 'pausedTime:', this.pausedTime);
            }
        } catch (error) {
            console.error('[ProblemTimer] Error loading from storage:', error);
        }
    }

    // Save time data to storage
    async saveToStorage() {
        if (!this.problemUrl) return;

        try {
            const storageKey = `problem_data_${this.problemUrl}`;
            const result = await chrome.storage.local.get([storageKey]);
            const problemData = result[storageKey] || {};

            problemData.problemStartTime = this.startTime;
            problemData.pausedTime = this.pausedTime;

            await chrome.storage.local.set({ [storageKey]: problemData });
        } catch (error) {
            console.error('[ProblemTimer] Error saving to storage:', error);
        }
    }

    // ========== OVERLAY METHODS ==========

    showOverlay() {
        if (this.overlay) return; // Already showing

        this.createOverlay();
        this.startDisplayUpdate();
    }

    hideOverlay() {
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

        this.overlay = document.createElement('div');
        this.overlay.id = 'leetfeedback-timer-overlay';
        this.overlay.style.cssText = `
      position: fixed;
      bottom: 80px;
      right: 20px;
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
      cursor: default;
      user-select: none;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
    `;

        // Timer icon
        const icon = document.createElement('span');
        icon.style.cssText = `font-size: 16px; opacity: 0.8;`;
        icon.textContent = '⏱';

        // Time display
        const timeDisplay = document.createElement('span');
        timeDisplay.id = 'leetfeedback-timer-time';
        timeDisplay.style.cssText = `
      min-width: 60px;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.5px;
    `;
        timeDisplay.textContent = '00:00';

        // Close button
        const closeBtn = document.createElement('button');
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
        closeBtn.textContent = '×';
        closeBtn.title = 'Hide timer (re-enable in extension settings)';
        closeBtn.onmouseover = () => {
            closeBtn.style.background = 'rgba(255, 255, 255, 0.2)';
            closeBtn.style.color = 'white';
        };
        closeBtn.onmouseout = () => {
            closeBtn.style.background = 'rgba(255, 255, 255, 0.1)';
            closeBtn.style.color = 'rgba(255, 255, 255, 0.6)';
        };
        closeBtn.onclick = (e) => {
            e.stopPropagation();
            this.hideOverlay();
            // Disable in settings
            chrome.storage.sync.set({ timer_overlay_enabled: false });
        };

        this.overlay.appendChild(icon);
        this.overlay.appendChild(timeDisplay);
        this.overlay.appendChild(closeBtn);

        // Hover effects
        this.overlay.onmouseover = () => {
            this.overlay.style.opacity = '1';
            this.overlay.style.transform = 'scale(1.02)';
        };
        this.overlay.onmouseout = () => {
            this.overlay.style.opacity = '0.6';
            this.overlay.style.transform = 'scale(1)';
        };

        document.body.appendChild(this.overlay);
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

        const timeDisplay = document.getElementById('leetfeedback-timer-time');
        if (!timeDisplay) return;

        const elapsed = this.getElapsedActiveTime();
        const seconds = Math.floor(elapsed / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        let timeStr;
        if (hours > 0) {
            timeStr = `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        } else {
            timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
        }

        timeDisplay.textContent = timeStr;
    }
}

// Create singleton and expose globally
window.ProblemTimer = ProblemTimer;

// Auto-initialize
const problemTimer = ProblemTimer.getInstance();

console.log('[ProblemTimer] Problem timer utility loaded');
