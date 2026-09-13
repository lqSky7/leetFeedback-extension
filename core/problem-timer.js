// Traverse — ProblemTimer: per-problem active-time tracking + the floating overlay.
//
// Active time excludes time the tab spent hidden and time the user explicitly
// paused. State is persisted into the same `problem_data_<key>` record the
// adapters use (via SessionStore) so a reload resumes where the user left off,
// and is capped at 2 hours — the same cap the backend client applies when
// reporting `timeTaken`.
//
// Singleton, exposed as `window.ProblemTimer` and `T.ProblemTimer`.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});
  const logger = T.createLogger ? T.createLogger('timer') : { log() {}, warn() {}, error() {} };

  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const INACTIVITY_TIMEOUT_MS = 2 * 60 * 60 * 1000;
  const PERIODIC_SAVE_MS = 60000;

  class ProblemTimer {
    constructor() {
      if (window._problemTimerInstance) return window._problemTimerInstance;
      window._problemTimerInstance = this;

      this.problemUrl = null;
      this.startTime = null;
      this.pausedTime = 0;
      this.isTabHidden = document.hidden;
      this.tabHiddenAt = null;
      this.isPaused = false;
      this.pausedAt = null;
      this.lastSaveTime = 0;

      this.overlay = null;
      this.displayIntervalId = null;
      this.isEnabled = true;

      this.isDragging = false;
      this.dragOffsetX = 0;
      this.dragOffsetY = 0;
      this.currentX = window.innerWidth - 220;
      this.currentY = window.innerHeight - 120;

      this._dragMouseMoveHandler = null;
      this._dragMouseUpHandler = null;

      this._saveQueue = Promise.resolve();
      this._initPromise = this.init();
    }

    static getInstance() {
      if (!window._problemTimerInstance) window._problemTimerInstance = new ProblemTimer();
      return window._problemTimerInstance;
    }

    async init() {
      const keys = T.config.keys;
      try {
        const settings = await chrome.storage.sync.get([keys.timerOverlayEnabled]);
        this.isEnabled = settings[keys.timerOverlayEnabled] !== false;

        const stored = await chrome.storage.local.get([keys.timerOverlayPosition]);
        if (stored[keys.timerOverlayPosition]) {
          this.currentX = stored[keys.timerOverlayPosition].x;
          this.currentY = stored[keys.timerOverlayPosition].y;
        }
      } catch (error) {
        logger.error('init failed:', error);
      }

      this.setupVisibilityTracking();

      window.addEventListener('resize', () => {
        if (this.overlay) this.constrainToViewport();
      });

      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes[keys.timerOverlayEnabled]) {
          this.isEnabled = changes[keys.timerOverlayEnabled].newValue !== false;
          if (this.isEnabled && this.problemUrl) {
            this.showOverlay();
          } else {
            this.hideOverlay();
          }
        }
      });

      logger.log('initialized');
    }

    /* ── tracking ── */

    async startTimer(problemUrl) {
      await this._initPromise;

      if (!problemUrl) {
        logger.warn('no problem key provided');
        return;
      }

      // Same problem (SPA re-render): keep the existing timer running.
      if (this.problemUrl === problemUrl && this.startTime) {
        if (this.isEnabled) this.showOverlay();
        return;
      }

      this.problemUrl = problemUrl;
      await this.loadFromStorage();

      if (!this.startTime) {
        this.startTime = Date.now();
        this.pausedTime = 0;
        logger.log('started fresh timer for', problemUrl);
      } else {
        logger.log('resumed timer, elapsed', this.getElapsedActiveTime(), 'ms');
      }

      await this.saveToStorage();
      if (this.isEnabled) this.showOverlay();
    }

    /** Called when navigating to a different problem (the URL is set next). */
    reset() {
      this.problemUrl = null;
      this.startTime = Date.now();
      this.pausedTime = 0;
      this.isTabHidden = document.hidden;
      this.tabHiddenAt = null;
      this.isPaused = false;
      this.pausedAt = null;
      logger.log('timer reset');
    }

    /** Reset the timer for the problem already being tracked. */
    async resetTimer() {
      this.startTime = Date.now();
      this.pausedTime = 0;
      this.isTabHidden = document.hidden;
      this.tabHiddenAt = null;
      this.isPaused = false;
      this.pausedAt = null;

      await this.saveToStorage();
      this.updateDisplay();
      logger.log('timer reset for current problem');
    }

    setupVisibilityTracking() {
      document.addEventListener('visibilitychange', async () => {
        if (document.hidden) {
          this.isTabHidden = true;
          this.tabHiddenAt = Date.now();
          logger.log('tab hidden, pausing');
          return;
        }

        this.isTabHidden = false;
        if (this.tabHiddenAt && this.startTime && !this.isPaused) {
          const hiddenFor = Date.now() - this.tabHiddenAt;
          this.pausedTime += hiddenFor;
          logger.log(`tab visible again, hidden ${Math.floor(hiddenFor / 1000)}s`);
          await this.saveToStorage();
        }
        this.tabHiddenAt = null;
      });
    }

    /** Active elapsed milliseconds (hidden time and pauses excluded, capped). */
    getElapsedActiveTime() {
      if (!this.startTime) return 0;

      if (this.isPaused && this.pausedAt) {
        return Math.max(0, this.pausedAt - this.startTime - this.pausedTime);
      }

      const now = Date.now();
      let elapsed = now - this.startTime - this.pausedTime;
      if (this.isTabHidden && this.tabHiddenAt) elapsed -= now - this.tabHiddenAt;

      if (elapsed < 0) {
        logger.warn('negative elapsed time, resetting timer');
        this.startTime = now;
        this.pausedTime = 0;
        this.tabHiddenAt = null;
        return 0;
      }

      return Math.min(elapsed, TWO_HOURS_MS);
    }

    async pauseTimer() {
      if (this.isPaused) return;
      this.isPaused = true;
      this.pausedAt = Date.now();

      const btn = document.getElementById('leetfeedback-timer-pause-btn');
      if (btn) btn.disabled = true;
      await this.saveToStorage();
      if (btn) btn.disabled = false;

      this.updatePauseButton();
      this.updateDisplay();
    }

    async resumeTimer() {
      if (!this.isPaused) return;
      const now = Date.now();
      this.pausedTime += now - (this.pausedAt || now);
      this.isPaused = false;
      this.pausedAt = null;

      const btn = document.getElementById('leetfeedback-timer-pause-btn');
      if (btn) btn.disabled = true;
      await this.saveToStorage();
      if (btn) btn.disabled = false;

      this.updatePauseButton();
      this.updateDisplay();
    }

    updatePauseButton() {
      const btn = document.getElementById('leetfeedback-timer-pause-btn');
      if (!btn) return;
      btn.textContent = this.isPaused ? '▶' : '⏸';
      btn.title = this.isPaused ? 'Resume timer' : 'Pause timer';
      btn.setAttribute('aria-label', this.isPaused ? 'Resume timer' : 'Pause timer');
      btn.setAttribute('aria-pressed', this.isPaused ? 'true' : 'false');
      if (this.overlay) this.overlay.style.opacity = this.isPaused ? '0.45' : '0.6';
    }

    /** Values the adapters persist alongside the tracking state. */
    getStartTime() {
      return this.startTime;
    }

    getPausedTime() {
      let total = this.pausedTime;
      if (this.isPaused && this.pausedAt) total += Date.now() - this.pausedAt;
      return total;
    }

    /* ── persistence ── */

    async loadFromStorage() {
      if (!this.problemUrl) return;
      const keys = T.config.keys;

      try {
        // A browser restart invalidates every in-flight timer.
        const session = await chrome.storage.local.get([keys.browserSessionRestarted]);
        if (session[keys.browserSessionRestarted]) {
          logger.log('browser restarted — starting fresh');
          await chrome.storage.local.remove([keys.browserSessionRestarted]);
          return;
        }

        const problemData = (await T.sessionStore.getProblemData(this.problemUrl)) || {};
        const now = Date.now();
        const lastActiveTime = problemData.lastActiveTime || 0;
        const lastTimestamp = problemData.timestamp ? new Date(problemData.timestamp).getTime() : 0;
        const referenceTime = lastActiveTime || lastTimestamp;

        const solved = problemData.solved && problemData.solved.value;
        if (solved || (referenceTime && now - referenceTime > INACTIVITY_TIMEOUT_MS)) {
          logger.log('solved or inactive too long — starting fresh');
          this.startTime = null;
          this.pausedTime = 0;
          this.isPaused = false;
          this.pausedAt = null;
          return;
        }

        // Resuming within the window: treat the offline gap as paused time.
        if (referenceTime && !problemData.isPaused) {
          const offlineDuration = now - referenceTime;
          if (offlineDuration > 0) {
            this.startTime = problemData.problemStartTime;
            this.pausedTime = (problemData.pausedTime || 0) + offlineDuration;
            this.isPaused = !!problemData.isPaused;
            this.pausedAt = problemData.pausedAt || null;
            logger.log(`adjusted pausedTime by ${Math.floor(offlineDuration / 1000)}s for offline gap`);
            return;
          }
        }

        this.startTime = problemData.problemStartTime;
        this.pausedTime = problemData.pausedTime || 0;
        this.isPaused = !!problemData.isPaused;
        this.pausedAt = problemData.pausedAt || null;
      } catch (error) {
        logger.error('loadFromStorage failed:', error);
      }
    }

    /**
     * Persist the current timer state. Snapshots first, then queues, so two
     * rapid saves cannot interleave a read-modify-write on the same record.
     */
    async saveToStorage() {
      if (!this.problemUrl) return;

      const snapshot = {
        problemStartTime: this.startTime,
        pausedTime: this.pausedTime,
        isPaused: this.isPaused,
        pausedAt: this.isPaused ? this.pausedAt : null,
        lastActiveTime: Date.now(),
      };

      this._saveQueue = this._saveQueue.then(async () => {
        try {
          await T.sessionStore.setProblemData(this.problemUrl, snapshot);
        } catch (error) {
          logger.error('saveToStorage failed:', error);
        }
      });

      await this._saveQueue;
    }

    async saveOverlayPosition() {
      try {
        await chrome.storage.local.set({
          [T.config.keys.timerOverlayPosition]: { x: this.currentX, y: this.currentY },
        });
      } catch (error) {
        logger.error('saveOverlayPosition failed:', error);
      }
    }

    /* ── overlay ── */

    showOverlay() {
      if (this.overlay) return;
      this.createOverlay();
      this.startDisplayUpdate();
    }

    hideOverlay() {
      if (this.isDragging) {
        this.isDragging = false;
        if (this._dragMouseMoveHandler) {
          document.removeEventListener('mousemove', this._dragMouseMoveHandler);
          this._dragMouseMoveHandler = null;
        }
        if (this._dragMouseUpHandler) {
          document.removeEventListener('mouseup', this._dragMouseUpHandler);
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

      const overlay = document.createElement('div');
      overlay.id = 'leetfeedback-timer-overlay';
      overlay.style.cssText = `
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

      const icon = document.createElement('span');
      icon.style.cssText = `
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #276EF1;
      margin-right: 10px;
      flex-shrink: 0;
    `;

      const timeDisplay = document.createElement('span');
      timeDisplay.id = 'leetfeedback-timer-time';
      timeDisplay.style.cssText = `
      min-width: 58px;
      font-variant-numeric: tabular-nums;
      font-family: -apple-system, BlinkMacSystemFont, 'SFMono-Regular', Consolas, monospace;
      letter-spacing: 0.5px;
      margin-right: 12px;
      flex-shrink: 0;
      color: #FFFFFF;
    `;
      timeDisplay.textContent = '00:00';

      const createDivider = () => {
        const div = document.createElement('div');
        div.style.cssText = `
        width: 1px;
        height: 100%;
        background: rgba(255, 255, 255, 0.12);
        flex-shrink: 0;
      `;
        return div;
      };

      const makeButton = (text, title, fontSize, idleColor, onClick) => {
        const btn = document.createElement('button');
        btn.style.cssText = `
        background: transparent;
        border: none;
        color: ${idleColor};
        height: 100%;
        padding: 0 14px;
        cursor: pointer;
        font-size: ${fontSize};
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
        flex-shrink: 0;
      `;
        btn.textContent = text;
        btn.title = title;
        btn.addEventListener('mouseover', () => {
          btn.style.background = 'rgba(255, 255, 255, 0.1)';
          btn.style.color = '#FFFFFF';
        });
        btn.addEventListener('mouseout', () => {
          btn.style.background = 'transparent';
          btn.style.color = idleColor;
        });
        btn.addEventListener('click', (event) => {
          event.stopPropagation();
          onClick();
        });
        return btn;
      };

      const pauseBtn = makeButton(
        this.isPaused ? '▶' : '⏸',
        this.isPaused ? 'Resume timer' : 'Pause timer',
        '11px',
        '#A6A6A6',
        () => (this.isPaused ? this.resumeTimer() : this.pauseTimer())
      );
      pauseBtn.id = 'leetfeedback-timer-pause-btn';

      const resetBtn = makeButton('↺', 'Reset timer', '12px', '#A6A6A6', () => this.resetTimer());
      const closeBtn = makeButton('×', 'Hide timer (re-enable in extension settings)', '15px', '#8A8A8A', () => {
        this.hideOverlay();
        chrome.storage.sync.set({ [T.config.keys.timerOverlayEnabled]: false });
      });

      overlay.appendChild(icon);
      overlay.appendChild(timeDisplay);
      overlay.appendChild(createDivider());
      overlay.appendChild(pauseBtn);
      overlay.appendChild(createDivider());
      overlay.appendChild(resetBtn);
      overlay.appendChild(createDivider());
      overlay.appendChild(closeBtn);

      this.overlay = overlay;
      this.setupDragging();
      this.updatePauseButton();

      overlay.addEventListener('mouseover', () => {
        overlay.style.opacity = '1';
        overlay.style.transform = 'scale(1.02)';
      });
      overlay.addEventListener('mouseout', () => {
        overlay.style.opacity = '0.6';
        overlay.style.transform = 'scale(1)';
      });

      document.body.appendChild(overlay);
    }

    setupDragging() {
      const handleMouseDown = (event) => {
        if (event.target.tagName === 'BUTTON') return;

        this.isDragging = true;
        const rect = this.overlay.getBoundingClientRect();
        this.dragOffsetX = event.clientX - rect.left;
        this.dragOffsetY = event.clientY - rect.top;

        this.overlay.style.transition = 'none';
        this.overlay.style.opacity = '1';
        this.overlay.style.transform = 'scale(1.05)';
        this.overlay.style.cursor = 'grabbing';

        this._dragMouseMoveHandler = handleMouseMove;
        this._dragMouseUpHandler = handleMouseUp;

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        event.preventDefault();
      };

      const handleMouseMove = (event) => {
        if (!this.isDragging) return;

        const rect = this.overlay.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width;
        const maxY = window.innerHeight - rect.height;

        this.currentX = Math.max(0, Math.min(event.clientX - this.dragOffsetX, maxX));
        this.currentY = Math.max(0, Math.min(event.clientY - this.dragOffsetY, maxY));

        this.overlay.style.left = `${this.currentX}px`;
        this.overlay.style.top = `${this.currentY}px`;
      };

      const handleMouseUp = async () => {
        if (!this.isDragging) return;

        this.isDragging = false;
        this.overlay.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        this.overlay.style.cursor = 'move';
        this.overlay.style.opacity = '0.6';
        this.overlay.style.transform = 'scale(1)';

        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        this._dragMouseMoveHandler = null;
        this._dragMouseUpHandler = null;

        await this.saveOverlayPosition();
      };

      this.overlay.addEventListener('mousedown', handleMouseDown);
    }

    constrainToViewport() {
      if (!this.overlay) return;

      const rect = this.overlay.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width;
      const maxY = window.innerHeight - rect.height;
      const newX = Math.max(0, Math.min(this.currentX, maxX));
      const newY = Math.max(0, Math.min(this.currentY, maxY));

      if (newX !== this.currentX || newY !== this.currentY) {
        this.currentX = newX;
        this.currentY = newY;
        this.overlay.style.left = `${newX}px`;
        this.overlay.style.top = `${newY}px`;
        this.saveOverlayPosition();
      }
    }

    startDisplayUpdate() {
      if (this.displayIntervalId) return;
      this.displayIntervalId = setInterval(() => this.updateDisplay(), 1000);
      this.updateDisplay();
    }

    updateDisplay() {
      if (!this.overlay || !this.startTime) return;

      const timeDisplay = document.getElementById('leetfeedback-timer-time');
      if (!timeDisplay) return;

      const seconds = Math.floor(this.getElapsedActiveTime() / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);

      timeDisplay.textContent =
        hours > 0
          ? `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
          : `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

      // Heartbeat so a long-open problem is not treated as inactive.
      const now = Date.now();
      if (!this.lastSaveTime || now - this.lastSaveTime > PERIODIC_SAVE_MS) {
        this.lastSaveTime = now;
        this.saveToStorage().catch((error) => logger.error('periodic save failed:', error));
      }
    }
  }

  T.ProblemTimer = ProblemTimer;
  window.ProblemTimer = ProblemTimer;

  // Auto-instantiate so the overlay and visibility tracking are live as soon as
  // the content script loads.
  ProblemTimer.getInstance();
})();
