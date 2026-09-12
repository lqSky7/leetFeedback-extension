// Hint / assistance self-report prompt for Traverse (leetFeedback-extension)
//
// Shown immediately after an accepted submission and BEFORE the backend push,
// so the answer travels inside the same /api/submissions request. The backend
// stores it on the submission and the revision scheduler uses it to discount
// assisted solves (a solution found with the editorial is not evidence of
// durable recall).
//
// The prompt is deliberately skippable. Skipping (close button, Escape, or
// timeout) resolves to 'none', which is disclosed in the card footer so the
// user knows what silence records.

class HintPrompt {
    constructor() {
        this.card = null;
        this.resolveFn = null;
        this.timeoutId = null;
        this.keyHandler = null;
    }

    // The three answer levels, in the order they are rendered.
    // Rendered with equal visual weight on purpose: highlighting one option
    // would bias the answers and defeat the point of asking.
    static get LEVELS() {
        return [
            { value: 'none', label: 'I solved it myself', detail: 'No help used' },
            { value: 'hint', label: 'Minor Hint', detail: 'Nudge or partial clue' },
            { value: 'solution', label: 'Full solution', detail: 'Editorial or complete answer' }
        ];
    }

    /**
     * Ask the user how much help they used.
     * @param {{ timeoutMs?: number }} [options]
     * @returns {Promise<'none'|'hint'|'solution'>} never rejects
     */
    ask({ timeoutMs = 90000 } = {}) {
        // A second submission while a prompt is open: settle the old one first
        // so its caller is never left hanging.
        this._settle('none');

        HintPrompt.injectStyles();

        return new Promise((resolve) => {
            this.resolveFn = resolve;
            this._build(timeoutMs);
        });
    }

    _build(timeoutMs) {
        const card = document.createElement('div');
        card.className = 'leetfeedback-hint-card';
        card.setAttribute('role', 'dialog');
        card.setAttribute('aria-label', 'Did you use any help on this problem?');

        const eyebrow = document.createElement('div');
        eyebrow.className = 'lfb-hint-eyebrow';
        eyebrow.textContent = 'Revision signal';

        const title = document.createElement('div');
        title.className = 'lfb-hint-title';
        title.textContent = 'Did you use any help?';

        const subtitle = document.createElement('div');
        subtitle.className = 'lfb-hint-subtitle';
        subtitle.textContent = 'This tunes when this problem comes back.';

        const actions = document.createElement('div');
        actions.className = 'lfb-hint-actions';

        HintPrompt.LEVELS.forEach((level) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'lfb-hint-btn';
            btn.dataset.level = level.value;

            const label = document.createElement('span');
            label.className = 'lfb-hint-btn-label';
            label.textContent = level.label;

            const detail = document.createElement('span');
            detail.className = 'lfb-hint-btn-detail';
            detail.textContent = level.detail;

            btn.appendChild(label);
            btn.appendChild(detail);
            btn.onclick = () => this._settle(level.value);
            actions.appendChild(btn);
        });

        const footer = document.createElement('div');
        footer.className = 'lfb-hint-footer';
        footer.textContent = 'Skipping records this as no hint used.';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'lfb-hint-close';
        closeBtn.setAttribute('aria-label', 'Skip');
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => this._settle('none');

        card.appendChild(closeBtn);
        card.appendChild(eyebrow);
        card.appendChild(title);
        card.appendChild(subtitle);
        card.appendChild(actions);
        card.appendChild(footer);

        document.body.appendChild(card);
        this.card = card;

        // Escape counts as a skip, same as the close button.
        this.keyHandler = (event) => {
            if (event.key === 'Escape') {
                this._settle('none');
            }
        };
        document.addEventListener('keydown', this.keyHandler, true);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (this.card) {
                    this.card.classList.add('lfb-hint-visible');
                }
            });
        });

        // Never hold the submission hostage: an unanswered prompt is a skip.
        if (timeoutMs > 0) {
            this.timeoutId = setTimeout(() => this._settle('none'), timeoutMs);
        }
    }

    _settle(level) {
        if (!this.resolveFn) return;

        const resolve = this.resolveFn;
        this.resolveFn = null;

        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler, true);
            this.keyHandler = null;
        }

        if (this.card) {
            const card = this.card;
            this.card = null;
            card.classList.remove('lfb-hint-visible');
            setTimeout(() => {
                if (card.parentNode) {
                    card.parentNode.removeChild(card);
                }
            }, 250);
        }

        resolve(level);
    }

    static injectStyles() {
        if (document.getElementById('leetfeedback-hint-styles')) return;
        const style = document.createElement('style');
        style.id = 'leetfeedback-hint-styles';
        style.textContent = `
            .leetfeedback-hint-card {
                position: fixed !important;
                bottom: 24px !important;
                left: 50% !important;
                width: 380px !important;
                max-width: calc(100vw - 48px) !important;
                background: rgba(10, 10, 10, 0.88) !important;
                backdrop-filter: blur(16px) !important;
                -webkit-backdrop-filter: blur(16px) !important;
                border: 1px solid rgba(255, 255, 255, 0.12) !important;
                border-radius: 16px !important;
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(39, 110, 241, 0.15) !important;
                padding: 16px 16px 12px 16px !important;
                box-sizing: border-box !important;
                z-index: 9999999 !important;
                color: #FFFFFF !important;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important;
                opacity: 0;
                transform: translateX(-50%) translateY(16px) scale(0.96);
                transition: opacity 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
                pointer-events: auto !important;
            }
            .leetfeedback-hint-card.lfb-hint-visible {
                opacity: 1 !important;
                transform: translateX(-50%) translateY(0) scale(1);
            }
            .lfb-hint-eyebrow {
                font-family: 'SFMono-Regular', Consolas, monospace !important;
                font-size: 10px !important;
                font-weight: 700 !important;
                letter-spacing: 0.08em !important;
                text-transform: uppercase !important;
                color: #276EF1 !important;
                margin-bottom: 6px !important;
            }
            .lfb-hint-title {
                font-size: 14px !important;
                font-weight: 600 !important;
                line-height: 1.3 !important;
                color: #FFFFFF !important;
                margin-bottom: 3px !important;
            }
            .lfb-hint-subtitle {
                font-size: 12px !important;
                font-weight: 400 !important;
                line-height: 1.4 !important;
                color: #8A8A8A !important;
                margin-bottom: 12px !important;
            }
            .lfb-hint-actions {
                display: flex !important;
                flex-direction: column !important;
                gap: 8px !important;
            }
            .lfb-hint-btn {
                display: flex !important;
                flex-direction: column !important;
                align-items: flex-start !important;
                gap: 1px !important;
                width: 100% !important;
                padding: 9px 12px !important;
                background: rgba(255, 255, 255, 0.04) !important;
                border: 1px solid rgba(255, 255, 255, 0.12) !important;
                border-radius: 10px !important;
                color: #FFFFFF !important;
                font-family: inherit !important;
                text-align: left !important;
                cursor: pointer !important;
                transition: border-color 0.15s ease, background 0.15s ease !important;
            }
            .lfb-hint-btn:hover {
                border-color: rgba(39, 110, 241, 0.65) !important;
                background: rgba(39, 110, 241, 0.14) !important;
            }
            .lfb-hint-btn-label {
                font-size: 13px !important;
                font-weight: 500 !important;
                line-height: 1.3 !important;
                color: #FFFFFF !important;
            }
            .lfb-hint-btn-detail {
                font-size: 11px !important;
                font-weight: 400 !important;
                line-height: 1.3 !important;
                color: #8A8A8A !important;
            }
            .lfb-hint-footer {
                margin-top: 10px !important;
                font-size: 11px !important;
                font-weight: 400 !important;
                line-height: 1.4 !important;
                color: #6E6E6E !important;
            }
            .lfb-hint-close {
                position: absolute !important;
                top: 10px !important;
                right: 12px !important;
                background: transparent !important;
                border: none !important;
                color: #6E6E6E !important;
                font-size: 16px !important;
                line-height: 1 !important;
                padding: 0 !important;
                cursor: pointer !important;
                transition: color 0.15s ease !important;
            }
            .lfb-hint-close:hover {
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
