// Hint / assistance self-report prompt for Traverse (leetFeedback-extension)
//
// Shown immediately after an accepted submission and BEFORE the backend push,
// so the answer travels inside the same /api/submissions request. The backend
// stores it on the submission and the revision scheduler uses it to discount
// assisted solves (a solution found with the editorial is not evidence of
// durable recall).
//
// Redesigned with:
// - Completely grayscale visual language (zero color accents)
// - Centered in viewport with semi-transparent backdrop
// - Centered header: "Did you use any Hint?" + translucent warning "This action will have consequences"
// - Top-right circular countdown timer (customizable duration, default 10s)
// - 3 horizontally laid out boxes with large, prominent icons
// - Configurable in extension settings (enabled toggle, default option, timer duration)

class HintPrompt {
    constructor() {
        this.card = null;
        this.backdrop = null;
        this.resolveFn = null;
        this.timerIntervalId = null;
        this.keyHandler = null;
    }

    static get LEVELS() {
        return [
            {
                value: 'none',
                label: 'I solved it myself',
                icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="12 2 15 8.5 22 12 15 15.5 12 22 9 15.5 2 12 9 8.5 12 2"/>
                    <polygon points="12 6 16 12 12 18 8 12 12 6"/>
                    <circle cx="12" cy="12" r="1.5"/>
                </svg>`
            },
            {
                value: 'hint',
                label: 'Minor Hint',
                icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="9.5"/>
                    <ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(-30 12 12)"/>
                    <ellipse cx="12" cy="12" rx="9.5" ry="3.8" transform="rotate(30 12 12)"/>
                    <circle cx="12" cy="12" r="1.8"/>
                </svg>`
            },
            {
                value: 'solution',
                label: 'Full solution',
                icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="12 2 21 7.2 21 16.8 12 22 3 16.8 3 7.2 12 2"/>
                    <line x1="12" y1="12" x2="21" y2="7.2"/>
                    <line x1="12" y1="12" x2="3" y2="7.2"/>
                    <line x1="12" y1="12" x2="12" y2="22"/>
                    <polygon points="12 7.5 16 9.8 16 14.2 12 16.5 8 14.2 8 9.8 12 7.5"/>
                </svg>`
            }
        ];
    }

    /**
     * Read configuration from chrome.storage.sync
     * @returns {Promise<{ enabled: boolean, defaultOption: 'none'|'hint'|'solution', duration: number }>}
     */
    async _loadConfig() {
        return new Promise((resolve) => {
            if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
                chrome.storage.sync.get(
                    ['hint_prompt_enabled', 'hint_prompt_default_option', 'hint_prompt_duration'],
                    (data) => {
                        const enabled = data.hint_prompt_enabled !== false;
                        const defaultOption = ['none', 'hint', 'solution'].includes(data.hint_prompt_default_option)
                            ? data.hint_prompt_default_option
                            : 'none';
                        const duration = typeof data.hint_prompt_duration === 'number' && data.hint_prompt_duration > 0
                            ? data.hint_prompt_duration
                            : 10;
                        resolve({ enabled, defaultOption, duration });
                    }
                );
            } else {
                resolve({ enabled: true, defaultOption: 'none', duration: 10 });
            }
        });
    }

    /**
     * Ask the user how much help they used.
     * @param {{ timeoutMs?: number }} [options]
     * @returns {Promise<'none'|'hint'|'solution'>} never rejects
     */
    async ask(options = {}) {
        const config = await this._loadConfig();

        // If the user disabled the hint confirmation flow in settings,
        // automatically resolve immediately with the configured default option.
        if (!config.enabled) {
            return config.defaultOption;
        }

        const durationSeconds = typeof options.timeoutMs === 'number' && options.timeoutMs > 0
            ? Math.round(options.timeoutMs / 1000)
            : config.duration;

        // A second submission while a prompt is open: settle the old one first
        this._settle(config.defaultOption);

        HintPrompt.injectStyles();

        return new Promise((resolve) => {
            this.resolveFn = resolve;
            this._build(durationSeconds, config.defaultOption);
        });
    }

    _build(durationSeconds, defaultOption) {
        // Semi-transparent backdrop overlay
        const backdrop = document.createElement('div');
        backdrop.className = 'leetfeedback-hint-backdrop';
        backdrop.onclick = () => this._settle(defaultOption);

        // Centered modal card
        const card = document.createElement('div');
        card.className = 'leetfeedback-hint-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-modal', 'true');
        card.setAttribute('aria-label', 'Did you use any Hint?');

        // Circular countdown timer on top right
        const timerWrap = document.createElement('div');
        timerWrap.className = 'lfb-hint-timer-wrap';
        timerWrap.setAttribute('title', `Auto-selecting in ${durationSeconds}s`);

        const timerRadius = 14;
        const circumference = 2 * Math.PI * timerRadius; // ~87.96

        timerWrap.innerHTML = `
            <svg class="lfb-hint-timer-svg" viewBox="0 0 36 36" width="36" height="36">
                <circle class="lfb-hint-timer-bg" cx="18" cy="18" r="${timerRadius}" />
                <circle class="lfb-hint-timer-progress" cx="18" cy="18" r="${timerRadius}" style="stroke-dasharray: ${circumference}; stroke-dashoffset: 0;" />
                <text class="lfb-hint-timer-text" x="18" y="18">${durationSeconds}</text>
            </svg>
        `;

        // Top middle centered header
        const header = document.createElement('div');
        header.className = 'lfb-hint-header';

        const title = document.createElement('div');
        title.className = 'lfb-hint-title';
        title.textContent = 'Did you use any Hint?';

        const warning = document.createElement('div');
        warning.className = 'lfb-hint-warning';
        warning.textContent = 'This action will have consequences';

        header.appendChild(title);
        header.appendChild(warning);

        // 3 horizontally laid out boxes
        const actions = document.createElement('div');
        actions.className = 'lfb-hint-actions';

        HintPrompt.LEVELS.forEach((level) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'lfb-hint-btn';
            btn.dataset.level = level.value;

            const iconWrap = document.createElement('div');
            iconWrap.className = 'lfb-hint-icon-wrap';
            iconWrap.innerHTML = level.icon;

            const label = document.createElement('span');
            label.className = 'lfb-hint-btn-label';
            label.textContent = level.label;

            btn.appendChild(iconWrap);
            btn.appendChild(label);
            btn.onclick = (e) => {
                e.stopPropagation();
                this._settle(level.value);
            };
            actions.appendChild(btn);
        });

        card.appendChild(timerWrap);
        card.appendChild(header);
        card.appendChild(actions);

        document.body.appendChild(backdrop);
        document.body.appendChild(card);
        this.backdrop = backdrop;
        this.card = card;

        // Keyboard navigation & shortcuts:
        // Escape -> default option
        // 1 -> none, 2 -> hint, 3 -> solution
        this.keyHandler = (event) => {
            if (event.key === 'Escape') {
                this._settle(defaultOption);
            } else if (event.key === '1') {
                this._settle('none');
            } else if (event.key === '2') {
                this._settle('hint');
            } else if (event.key === '3') {
                this._settle('solution');
            }
        };
        document.addEventListener('keydown', this.keyHandler, true);

        // Animate entrance
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (this.backdrop) this.backdrop.classList.add('lfb-hint-visible');
                if (this.card) this.card.classList.add('lfb-hint-visible');
            });
        });

        // Run countdown timer
        const totalDurationMs = durationSeconds * 1000;
        const startTime = Date.now();
        const progressCircle = timerWrap.querySelector('.lfb-hint-timer-progress');
        const textEl = timerWrap.querySelector('.lfb-hint-timer-text');

        this.timerIntervalId = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const remainingMs = Math.max(0, totalDurationMs - elapsed);
            const remainingSeconds = Math.ceil(remainingMs / 1000);

            if (progressCircle) {
                const fraction = remainingMs / totalDurationMs;
                const offset = circumference * (1 - fraction);
                progressCircle.style.strokeDashoffset = `${offset}px`;
            }
            if (textEl) {
                textEl.textContent = `${remainingSeconds}`;
            }

            if (remainingMs <= 0) {
                this._settle(defaultOption);
            }
        }, 50);
    }

    _settle(level) {
        if (!this.resolveFn) return;

        const resolve = this.resolveFn;
        this.resolveFn = null;

        if (this.timerIntervalId) {
            clearInterval(this.timerIntervalId);
            this.timerIntervalId = null;
        }
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler, true);
            this.keyHandler = null;
        }

        const backdrop = this.backdrop;
        const card = this.card;
        this.backdrop = null;
        this.card = null;

        if (backdrop) backdrop.classList.remove('lfb-hint-visible');
        if (card) card.classList.remove('lfb-hint-visible');

        setTimeout(() => {
            if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
            if (card && card.parentNode) card.parentNode.removeChild(card);
        }, 220);

        resolve(level);
    }

    static injectStyles() {
        if (document.getElementById('leetfeedback-hint-styles')) return;
        const style = document.createElement('style');
        style.id = 'leetfeedback-hint-styles';
        style.textContent = `
            /* Backdrop overlay - completely grayscale, transparent without blurring the page */
            .leetfeedback-hint-backdrop {
                position: fixed !important;
                top: 0 !important;
                left: 0 !important;
                right: 0 !important;
                bottom: 0 !important;
                background: rgba(0, 0, 0, 0.45) !important;
                z-index: 99999998 !important;
                opacity: 0;
                transition: opacity 0.2s ease !important;
                pointer-events: auto !important;
            }
            .leetfeedback-hint-backdrop.lfb-hint-visible {
                opacity: 1 !important;
            }

            /* Center screen popup card - completely grayscale, blurs only its own background */
            .leetfeedback-hint-card {
                position: fixed !important;
                top: 50% !important;
                left: 50% !important;
                transform: translate(-50%, -50%) scale(0.96) !important;
                width: 600px !important;
                max-width: calc(100vw - 32px) !important;
                background: rgba(14, 14, 14, 0.65) !important;
                backdrop-filter: blur(28px) saturate(180%) !important;
                -webkit-backdrop-filter: blur(28px) saturate(180%) !important;
                border: 1px solid rgba(255, 255, 255, 0.14) !important;
                border-radius: 10px !important;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 255, 255, 0.06) !important;
                padding: 26px 28px 24px 28px !important;
                box-sizing: border-box !important;
                z-index: 99999999 !important;
                color: #FFFFFF !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
                opacity: 0;
                transition: opacity 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
                pointer-events: auto !important;
                user-select: none !important;
            }
            .leetfeedback-hint-card.lfb-hint-visible {
                opacity: 1 !important;
                transform: translate(-50%, -50%) scale(1) !important;
            }

            /* Top right circular countdown timer */
            .lfb-hint-timer-wrap {
                position: absolute !important;
                top: 20px !important;
                right: 22px !important;
                width: 34px !important;
                height: 34px !important;
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                cursor: default !important;
            }
            .lfb-hint-timer-svg {
                width: 34px !important;
                height: 34px !important;
                transform: rotate(-90deg) !important;
            }
            .lfb-hint-timer-bg {
                fill: none !important;
                stroke: rgba(255, 255, 255, 0.12) !important;
                stroke-width: 2.2 !important;
            }
            .lfb-hint-timer-progress {
                fill: none !important;
                stroke: rgba(255, 255, 255, 0.85) !important;
                stroke-width: 2.2 !important;
                stroke-linecap: round !important;
                transition: stroke-dashoffset 0.06s linear !important;
            }
            .lfb-hint-timer-text {
                transform: rotate(90deg) !important;
                transform-origin: 18px 18px !important;
                fill: #FFFFFF !important;
                font-size: 11px !important;
                font-weight: 700 !important;
                text-anchor: middle !important;
                dominant-baseline: central !important;
                font-family: -apple-system, BlinkMacSystemFont, 'SFMono-Regular', Consolas, monospace !important;
            }

            /* Top middle header */
            .lfb-hint-header {
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                text-align: center !important;
                padding: 0 40px !important;
            }
            .lfb-hint-title {
                font-size: 18px !important;
                font-weight: 700 !important;
                line-height: 1.3 !important;
                color: #FFFFFF !important;
                margin: 0 !important;
                letter-spacing: -0.01em !important;
            }
            .lfb-hint-warning {
                font-size: 11px !important;
                font-weight: 400 !important;
                line-height: 1.4 !important;
                color: rgba(255, 255, 255, 0.42) !important;
                margin-top: 5px !important;
                letter-spacing: 0.02em !important;
            }

            /* 3 horizontally laid out options */
            .lfb-hint-actions {
                display: flex !important;
                flex-direction: row !important;
                gap: 14px !important;
                margin-top: 24px !important;
                align-items: stretch !important;
            }
            .lfb-hint-btn {
                flex: 1 !important;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: center !important;
                padding: 20px 12px 16px 12px !important;
                background: rgba(255, 255, 255, 0.025) !important;
                border: 1px solid rgba(255, 255, 255, 0.09) !important;
                border-radius: 8px !important;
                color: #FFFFFF !important;
                font-family: inherit !important;
                cursor: pointer !important;
                transition: background 0.15s ease, border-color 0.15s ease !important;
                outline: none !important;
                box-sizing: border-box !important;
            }
            .lfb-hint-btn:hover,
            .lfb-hint-btn:focus-visible {
                background: rgba(255, 255, 255, 0.055) !important;
                border-color: rgba(255, 255, 255, 0.2) !important;
                box-shadow: none !important;
            }
            .lfb-hint-btn:active {
                background: rgba(255, 255, 255, 0.08) !important;
                border-color: rgba(255, 255, 255, 0.28) !important;
            }
            .lfb-hint-icon-wrap {
                display: flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 50px !important;
                height: 50px !important;
                color: #A3A3A3 !important;
                margin-bottom: 12px !important;
                transition: color 0.15s ease !important;
            }
            .lfb-hint-icon-wrap svg {
                width: 100% !important;
                height: 100% !important;
            }
            .lfb-hint-btn:hover .lfb-hint-icon-wrap,
            .lfb-hint-btn:focus-visible .lfb-hint-icon-wrap {
                color: #D4D4D4 !important;
            }
            .lfb-hint-btn:active .lfb-hint-icon-wrap {
                color: #FFFFFF !important;
            }
            .lfb-hint-btn-label {
                font-size: 13px !important;
                font-weight: 500 !important;
                line-height: 1.3 !important;
                color: #B5B5B5 !important;
                text-align: center !important;
                transition: color 0.15s ease !important;
            }
            .lfb-hint-btn:hover .lfb-hint-btn-label,
            .lfb-hint-btn:focus-visible .lfb-hint-btn-label {
                color: #E2E2E2 !important;
            }
            .lfb-hint-btn:active .lfb-hint-btn-label {
                color: #FFFFFF !important;
            }
        `;
        document.head.appendChild(style);
    }
}

window.LeetFeedbackHintPrompt = new HintPrompt();

if (typeof debugLog === 'function') {
    debugLog('[HintPrompt] Hint prompt utility loaded');
} else if (typeof window !== 'undefined' && typeof window.isDebugMode === 'function' && window.isDebugMode()) {
    console.log('[HintPrompt] Hint prompt utility loaded');
}
