// Traverse — assistance self-report prompt.
//
// Shown right after an accepted submission and BEFORE the backend push, so the
// answer travels in the same /api/submissions request. The backend stores it on
// the submission and the revision scheduler discounts assisted solves — a
// solution found with the editorial is not evidence of durable recall.
//
// Deliberately plain. This component used to bring itself in with the footer's
// chroma sweep; a masked gradient band travelling across the glyphs made the
// icons read as if they were sliding sideways, so the sweep is gone from here
// completely. Nothing in this prompt animates beyond the card's own fade/scale
// and the countdown itself. What is left of the chroma language is static: the
// countdown ring and its number are stroked/filled with the same five stops as
// the footer wordmark (baby pink -> crimson -> amber gold -> ice white ->
// cobalt), painted once and never moved.
//
// The three icons are drawn on a shared tight viewBox so they read big inside
// their 72px box, and they are picked for what they say: a lone figure ("me"),
// a lightbulb ("a nudge") and an open book ("the editorial").
//
// Exposed as `window.LeetFeedbackHintPrompt` and `T.LeetFeedbackHintPrompt`
// (the submission pipeline looks the global up by that name).

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});
  const logger = T.createLogger ? T.createLogger('hint') : { log() {} };

  /* ── the three answers ─────────────────────────────────────────────────── */

  const LEVELS = [
    {
      value: 'none',
      label: 'I solved it myself',
      geometry:
        '<circle cx="12" cy="7.7" r="3.6"/>' +
        '<path d="M4.9 20.7C4.9 16.8 8.1 14.1 12 14.1s7.1 2.7 7.1 6.6"/>',
    },
    {
      value: 'hint',
      label: 'Minor Hint',
      geometry:
        '<circle cx="12" cy="9.6" r="5.9"/>' +
        '<path d="M9.6 15.4h4.8v3.3a1.1 1.1 0 0 1-1.1 1.1h-2.6a1.1 1.1 0 0 1-1.1-1.1z"/>' +
        '<path d="M9.6 17.6h4.8"/>' +
        '<path d="M10.7 9.9a1.3 1.3 0 0 1 2.6 0"/>',
    },
    {
      value: 'solution',
      label: 'Full solution',
      geometry:
        '<path d="M12 6.6C10.3 5.2 7.9 4.6 4.6 4.9v12.2c3.3-.3 5.7.3 7.4 1.7"/>' +
        '<path d="M12 6.6c1.7-1.4 4.1-2 7.4-1.7v12.2c-3.3-.3-5.7.3-7.4 1.7"/>' +
        '<path d="M12 6.6v12.2"/>',
    },
  ];

  const ICON_STROKE = 1.4;

  // The three glyphs share one tight viewBox — the union of their bounds plus
  // half a stroke of padding — instead of the full 24x24 grid. Drawing on a
  // 24-unit grid keeps the geometry readable; cropping to the ink is what makes
  // the icons actually big inside their 72px box (and thickens the stroke with
  // them).
  const ICON_VIEWBOX = '3.9 3 16.2 18.4';

  /** One icon: a plain stroked glyph, coloured by the wrapper's currentColor. */
  function iconSvg(geometry) {
    return (
      '<svg class="lfb-hint-icon" viewBox="' +
      ICON_VIEWBOX +
      '" aria-hidden="true">' +
      '<g class="lfb-hint-icon-base" fill="none" stroke="currentColor" stroke-width="' +
      ICON_STROKE +
      '" stroke-linecap="round" stroke-linejoin="round">' +
      geometry +
      '</g>' +
      '</svg>'
    );
  }

  const DEFAULT_DURATION_SECONDS = 10;

  class HintPrompt {
    constructor() {
      this.card = null;
      this.backdrop = null;
      this.resolveFn = null;
      this.timerIntervalId = null;
      this.keyHandler = null;
    }

    async _loadConfig() {
      const keys = T.config.keys.hintPrompt;
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.sync) {
        return { enabled: true, defaultOption: 'none', duration: DEFAULT_DURATION_SECONDS };
      }

      const data = await chrome.storage.sync.get([keys.enabled, keys.defaultOption, keys.duration]);
      const defaultOption = ['none', 'hint', 'solution'].includes(data[keys.defaultOption])
        ? data[keys.defaultOption]
        : 'none';
      const duration =
        typeof data[keys.duration] === 'number' && data[keys.duration] > 0
          ? data[keys.duration]
          : DEFAULT_DURATION_SECONDS;

      return { enabled: data[keys.enabled] !== false, defaultOption, duration };
    }

    /**
     * Ask how much help the user used. Never rejects and never blocks forever:
     * when the prompt is disabled in settings it resolves immediately with the
     * configured default, and the on-screen countdown always terminates.
     *
     * @returns {Promise<'none'|'hint'|'solution'>}
     */
    async ask(options = {}) {
      const config = await this._loadConfig();
      if (!config.enabled) return config.defaultOption;

      const durationSeconds =
        typeof options.timeoutMs === 'number' && options.timeoutMs > 0
          ? Math.round(options.timeoutMs / 1000)
          : config.duration;

      // A second submission while a prompt is open: settle the old one first.
      this._settle(config.defaultOption);

      HintPrompt.injectStyles();
      return new Promise((resolve) => {
        this.resolveFn = resolve;
        this._build(durationSeconds, config.defaultOption);
      });
    }

    _build(durationSeconds, defaultOption) {
      const backdrop = document.createElement('div');
      backdrop.className = 'leetfeedback-hint-backdrop';
      backdrop.onclick = () => this._settle(defaultOption);

      const card = document.createElement('div');
      card.className = 'leetfeedback-hint-card';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      card.setAttribute('aria-label', 'Did you use any Hint?');

      const timerRadius = 14;
      const circumference = 2 * Math.PI * timerRadius;

      const timerWrap = document.createElement('div');
      timerWrap.className = 'lfb-hint-timer-wrap';
      timerWrap.setAttribute('title', `Auto-selecting in ${durationSeconds}s`);
      timerWrap.innerHTML = `
            <svg class="lfb-hint-timer-svg" viewBox="0 0 36 36" width="36" height="36">
                <defs>
                    <linearGradient id="lfb-hint-timer-ring" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stop-color="#FFB6C1"/>
                        <stop offset="25%" stop-color="#F02832"/>
                        <stop offset="50%" stop-color="#FFBE14"/>
                        <stop offset="75%" stop-color="#EBEBFF"/>
                        <stop offset="100%" stop-color="#145AE6"/>
                    </linearGradient>
                    <linearGradient id="lfb-hint-timer-num" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stop-color="#FFB6C1"/>
                        <stop offset="50%" stop-color="#FFBE14"/>
                        <stop offset="100%" stop-color="#EBEBFF"/>
                    </linearGradient>
                </defs>
                <circle class="lfb-hint-timer-bg" cx="18" cy="18" r="${timerRadius}" />
                <circle class="lfb-hint-timer-progress" cx="18" cy="18" r="${timerRadius}" style="stroke-dasharray: ${circumference}; stroke-dashoffset: 0;" />
                <text class="lfb-hint-timer-text" x="18" y="18">${durationSeconds}</text>
            </svg>
        `;

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

      const actions = document.createElement('div');
      actions.className = 'lfb-hint-actions';

      LEVELS.forEach((level) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'lfb-hint-btn';
        btn.dataset.level = level.value;

        const iconWrap = document.createElement('div');
        iconWrap.className = 'lfb-hint-icon-wrap';
        iconWrap.innerHTML = iconSvg(level.geometry);

        const label = document.createElement('span');
        label.className = 'lfb-hint-btn-label';
        label.textContent = level.label;

        btn.appendChild(iconWrap);
        btn.appendChild(label);
        btn.onclick = (event) => {
          event.stopPropagation();
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

      // Escape -> default option; 1/2/3 -> none/hint/solution.
      this.keyHandler = (event) => {
        if (event.key === 'Escape') this._settle(defaultOption);
        else if (event.key === '1') this._settle('none');
        else if (event.key === '2') this._settle('hint');
        else if (event.key === '3') this._settle('solution');
      };
      document.addEventListener('keydown', this.keyHandler, true);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (this.backdrop) this.backdrop.classList.add('lfb-hint-visible');
          if (this.card) this.card.classList.add('lfb-hint-visible');
        });
      });

      const totalDurationMs = durationSeconds * 1000;
      const startTime = Date.now();
      const progressCircle = timerWrap.querySelector('.lfb-hint-timer-progress');
      const textEl = timerWrap.querySelector('.lfb-hint-timer-text');

      this.timerIntervalId = setInterval(() => {
        const remainingMs = Math.max(0, totalDurationMs - (Date.now() - startTime));

        if (progressCircle) {
          progressCircle.style.strokeDashoffset = `${circumference * (1 - remainingMs / totalDurationMs)}px`;
        }
        if (textEl) textEl.textContent = `${Math.ceil(remainingMs / 1000)}`;

        if (remainingMs <= 0) this._settle(defaultOption);
      }, 50);
    }

    /** Resolve the pending promise once, and tear the UI down. */
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

      const { backdrop, card } = this;
      this.backdrop = null;
      this.card = null;

      if (backdrop) backdrop.classList.remove('lfb-hint-visible');
      if (card) card.classList.remove('lfb-hint-visible');

      setTimeout(() => {
        if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        if (card && card.parentNode) card.parentNode.removeChild(card);
      }, 220);

      logger.log('assistance level:', level);
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

            /* Top right circular countdown timer. The ring and the number carry
               the chroma palette as a fixed gradient — painted once, never
               moved. Nothing on this prompt sweeps. */
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
                stroke: url(#lfb-hint-timer-ring) !important;
                stroke-width: 2.2 !important;
                stroke-linecap: round !important;
                transition: stroke-dashoffset 0.06s linear !important;
            }
            .lfb-hint-timer-text {
                transform: rotate(90deg) !important;
                transform-origin: 18px 18px !important;
                fill: url(#lfb-hint-timer-num) !important;
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
                padding: 16px 12px 14px 12px !important;
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
                width: 72px !important;
                height: 72px !important;
                color: #A3A3A3 !important;
                margin-bottom: 10px !important;
                transition: color 0.15s ease !important;
            }
            .lfb-hint-icon-wrap svg {
                width: 100% !important;
                height: 100% !important;
                display: block !important;
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

  const hintPrompt = new HintPrompt();
  T.HintPrompt = HintPrompt;
  T.LeetFeedbackHintPrompt = hintPrompt;
  window.LeetFeedbackHintPrompt = hintPrompt;

  logger.log('hint prompt loaded');
})();
