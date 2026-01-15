// Timer Overlay utility for DSA to GitHub extension
// Displays elapsed time on current problem in bottom-right corner

class TimerOverlay {
    constructor() {
        this.overlay = null;
        this.intervalId = null;
        this.startTime = null;
        this.pausedTime = 0;
        this.isVisible = false;
        this.isDragging = false;
        this.isEnabled = false;
        this.init();
    }

    async init() {
        // Check if timer overlay is enabled in settings
        try {
            const result = await chrome.storage.sync.get(['timer_overlay_enabled']);
            this.isEnabled = result.timer_overlay_enabled !== false; // Default to true

            if (this.isEnabled) {
                await this.loadProblemTime();
                this.createOverlay();
                this.startTimer();
            }
        } catch (error) {
            console.error('[Timer Overlay] Error initializing:', error);
        }

        // Listen for setting changes
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync' && changes.timer_overlay_enabled) {
                this.isEnabled = changes.timer_overlay_enabled.newValue !== false;
                if (this.isEnabled) {
                    this.loadProblemTime().then(() => {
                        this.createOverlay();
                        this.startTimer();
                    });
                } else {
                    this.hide();
                }
            }
        });
    }

    async loadProblemTime() {
        try {
            const problemUrl = this.getCurrentProblemUrl();
            if (!problemUrl) return;

            const storageKey = `problem_data_${problemUrl}`;
            const result = await chrome.storage.local.get([storageKey]);
            const problemData = result[storageKey];

            if (problemData && problemData.problemStartTime) {
                this.startTime = problemData.problemStartTime;
                this.pausedTime = problemData.pausedTime || 0;
            } else {
                this.startTime = Date.now();
            }
        } catch (error) {
            console.error('[Timer Overlay] Error loading problem time:', error);
            this.startTime = Date.now();
        }
    }

    getCurrentProblemUrl() {
        const url = window.location.href;
        const match = url.match(/\/problems\/([^\/\?]+)/);
        return match ? match[1] : null;
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
        icon.style.cssText = `
      font-size: 16px;
      opacity: 0.8;
    `;
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
            this.hide();
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
        this.isVisible = true;
    }

    startTimer() {
        if (this.intervalId) return;

        this.intervalId = setInterval(() => {
            this.updateDisplay();
        }, 1000);

        // Update immediately
        this.updateDisplay();
    }

    updateDisplay() {
        if (!this.overlay || !this.startTime) return;

        const timeDisplay = document.getElementById('leetfeedback-timer-time');
        if (!timeDisplay) return;

        const elapsed = Date.now() - this.startTime - this.pausedTime;
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

    hide() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }

        if (this.overlay && this.overlay.parentNode) {
            this.overlay.parentNode.removeChild(this.overlay);
            this.overlay = null;
        }

        this.isVisible = false;
    }

    show() {
        if (!this.isEnabled) return;

        this.loadProblemTime().then(() => {
            this.createOverlay();
            this.startTimer();
        });
    }
}

// Initialize timer overlay
window.LeetFeedbackTimer = new TimerOverlay();
console.log('[Timer Overlay] Timer overlay utility loaded');
