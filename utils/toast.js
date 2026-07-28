// Toast notification utility for DSA to GitHub extension

class ToastNotification {
    constructor() {
        this.container = null;
        this.toasts = [];
        this.init();
    }

    init() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'leetfeedback-toast-container';
            this.container.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 999999;
        display: flex;
        flex-direction: column-reverse;
        gap: 10px;
        pointer-events: none;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `;
            document.body.appendChild(this.container);
        }
    }

    show(message, type = 'info', duration = 5000) {
        this.init();
        const toast = document.createElement('div');
        toast.className = `leetfeedback-toast leetfeedback-toast-${type}`;
        const colors = {
            success: { bg: '#0a0a0a', border: '#ffffff', text: '#ffffff' },
            error: { bg: '#0a0a0a', border: '#737373', text: '#737373' },
            info: { bg: '#0a0a0a', border: '#262626', text: '#a3a3a3' }
        };
        const color = colors[type] || colors.info;

        toast.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      background: ${color.bg};
      border: 1px solid ${color.border};
      border-radius: 8px;
      color: ${color.text};
      font-size: 12px;
      line-height: 1.4;
      width: 280px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.8);
      pointer-events: auto;
      transform: translateX(120%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease;
      opacity: 0;
      font-family: SFMono-Regular, Consolas, monospace;
    `;

        const dotSpan = document.createElement('span');
        dotSpan.style.cssText = `
      flex-shrink: 0;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: ${color.border};
    `;

        const textSpan = document.createElement('div');
        textSpan.style.cssText = `
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;
        textSpan.textContent = message;

        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = `
      flex-shrink: 0;
      background: transparent;
      border: none;
      color: ${color.text};
      cursor: pointer;
      font-size: 14px;
      opacity: 0.6;
    `;
        closeBtn.textContent = '×';
        closeBtn.onclick = () => this.dismiss(toast);

        toast.appendChild(dotSpan);
        toast.appendChild(textSpan);
        toast.appendChild(closeBtn);
        this.container.appendChild(toast);
        this.toasts.push(toast);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.style.transform = 'translateX(0)';
                toast.style.opacity = '1';
            });
        });

        if (duration > 0) {
            toast._autoDismissTimeout = setTimeout(() => this.dismiss(toast), duration);
        }
        return toast;
    }

    update(toast, message, type = 'info', duration = 5000) {
        if (!toast || !toast.parentNode) return;
        if (toast._autoDismissTimeout) {
            clearTimeout(toast._autoDismissTimeout);
        }
        const textSpan = toast.querySelector('div');
        if (textSpan) {
            textSpan.textContent = message;
        }
        if (duration > 0) {
            toast._autoDismissTimeout = setTimeout(() => this.dismiss(toast), duration);
        }
    }

    dismiss(toast) {
        if (!toast || !toast.parentNode) return;
        toast.style.transform = 'translateX(120%)';
        toast.style.opacity = '0';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
            const index = this.toasts.indexOf(toast);
            if (index > -1) {
                this.toasts.splice(index, 1);
            }
        }, 300);
    }

    success(message, duration = 5000) { return this.show(message, 'success', duration); }
    error(message, duration = 6000) { return this.show(message, 'error', duration); }
    info(message, duration = 5000) { return this.show(message, 'info', duration); }

    createSubmission() {
        const existing = document.querySelector('.leetfeedback-submission-card');
        if (existing) {
            existing.remove();
        }
        return new SubmissionTracker();
    }
}

class SubmissionTracker {
    constructor() {
        this.card = null;
        this.orbiter = null;
        this.statusText = null;
        this.isDismissed = false;

        this.state = 'judging';
        this.startTime = Date.now();

        this.timestamps = {
            judging: Date.now(),
            analyzing: null,
            'slow-rise': null,
            launching: null,
            failed: null
        };

        this.minDurations = {
            judging: 1500,
            analyzing: 1500,
            'slow-rise': 2000
        };

        this.init();
    }

    init() {
        SubmissionTracker.injectStyles();

        this.card = document.createElement('div');
        this.card.className = 'leetfeedback-submission-card';
        this.card.innerHTML = `
            <button class="lfb-close-btn">&times;</button>
            <div class="lfb-sync-orbiter lfb-state-judging">
                <svg class="lfb-svg-anim" viewBox="0 0 100 100" width="80" height="80">
                    <!-- Rotating Rings (Original Black & White) -->
                    <circle class="lfb-ring lfb-ring-outer" cx="50" cy="50" r="40" stroke="#262626" stroke-width="1.5" stroke-dasharray="4 8" fill="none" />
                    <circle class="lfb-ring lfb-ring-inner" cx="50" cy="50" r="25" stroke="#404040" stroke-width="1.5" stroke-dasharray="12 6" fill="none" />
                    
                    <!-- Rotating Satellites -->
                    <circle class="lfb-dot lfb-dot-outer" cx="90" cy="50" r="3" fill="#ffffff" />
                    <circle class="lfb-dot lfb-dot-inner" cx="75" cy="50" r="2.5" fill="#a3a3a3" />
                    
                    <!-- Center Pulse Orb -->
                    <circle class="lfb-center-orb" cx="50" cy="50" r="8" fill="#ffffff" />
                    
                    <!-- Celebration Star/Ball Particles (Exactly Untouched from step 200) -->
                    <g class="lfb-celebration-particles">
                        <circle class="lfb-part lfb-part-1" cx="50" cy="50" r="3.5" fill="hsl(50, 100%, 75%)" />
                        <circle class="lfb-part lfb-part-2" cx="50" cy="50" r="3" fill="hsl(330, 95%, 80%)" />
                        <circle class="lfb-part lfb-part-3" cx="50" cy="50" r="4" fill="hsl(120, 75%, 80%)" />
                        <circle class="lfb-part lfb-part-4" cx="50" cy="50" r="2.5" fill="hsl(220, 85%, 80%)" />
                        <path class="lfb-part lfb-part-5" d="M50 42 L52 47 L58 47 L53 50 L55 56 L50 52 L45 56 L47 50 L42 47 L48 47 Z" fill="hsl(50, 100%, 75%)" />
                        <path class="lfb-part lfb-part-6" d="M50 42 L52 47 L58 47 L53 50 L55 56 L50 52 L45 56 L47 50 L42 47 L48 47 Z" fill="hsl(15, 95%, 78%)" />
                        <path class="lfb-part lfb-part-7" d="M50 42 L52 47 L58 47 L53 50 L55 56 L50 52 L45 56 L47 50 L42 47 L48 47 Z" fill="hsl(160, 80%, 78%)" />
                        <circle class="lfb-part lfb-part-8" cx="50" cy="50" r="3" fill="hsl(300, 90%, 82%)" />
                    </g>

                    <!-- Result Paths -->
                    <path class="lfb-result-check" d="M38 50 L46 58 L62 42" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                    <path class="lfb-result-cross" d="M38 38 L62 62 M62 38 L38 62" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                </svg>
            </div>
            <div class="lfb-status-text">JUDGING...</div>
        `;

        document.body.appendChild(this.card);

        this.orbiter = this.card.querySelector('.lfb-sync-orbiter');
        this.statusText = this.card.querySelector('.lfb-status-text');

        const closeBtn = this.card.querySelector('.lfb-close-btn');
        closeBtn.onclick = () => this.dismiss();

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (this.card) {
                    this.card.classList.add('lfb-visible');
                }
            });
        });
    }

    _setText(msg) {
        if (this.statusText) {
            this.statusText.textContent = msg;
        }
    }

    _transitionTo(nextState, callback) {
        if (this.isDismissed) return;

        const runTransition = () => {
            if (this.isDismissed) return;
            this.state = nextState;
            this.timestamps[nextState] = Date.now();
            callback();
        };

        const current = this.state;
        const elapsed = Date.now() - (this.timestamps[current] || this.startTime);
        const minDur = this.minDurations[current] || 0;

        if (elapsed < minDur) {
            const delay = minDur - elapsed;
            setTimeout(() => {
                runTransition();
            }, delay);
        } else {
            runTransition();
        }
    }

    setAIStarted() {
        this._transitionTo('analyzing', () => {
            this._setText('Analyzing with Gemini...');
            if (this.orbiter) {
                this.orbiter.className = 'lfb-sync-orbiter lfb-state-analyzing';
            }
        });
    }

    setAIComplete() {
        this._transitionTo('slow-rise', () => {
            this._setText('AI Logged');
            if (this.orbiter) {
                this.orbiter.className = 'lfb-sync-orbiter lfb-state-syncing';
            }
        });
    }

    setAISkipped() {
        this._transitionTo('slow-rise', () => {
            this._setText('Syncing to Traverse...');
            if (this.orbiter) {
                this.orbiter.className = 'lfb-sync-orbiter lfb-state-syncing';
            }
        });
    }

    setBackendStarted() {
        if (this.state === 'judging' || this.state === 'analyzing') {
            this.setAISkipped();
        } else if (this.state === 'slow-rise') {
            this._setText('Syncing to Traverse...');
        }
    }

    succeed(msg = 'Synced') {
        this._transitionTo('launching', () => {
            this._setText(msg);
            if (this.orbiter) {
                this.orbiter.className = 'lfb-sync-orbiter lfb-state-success';
            }
            setTimeout(() => this.dismiss(), 1800);
        });
    }

    fail(errorMsg = 'Failed') {
        this.isDismissed = true; // halt pending transitions
        this.state = 'failed';
        this._setText(errorMsg);
        
        if (this.orbiter) {
            this.orbiter.className = 'lfb-sync-orbiter lfb-state-failure';
        }
        
        setTimeout(() => this.dismiss(true), 4000);
    }

    dismiss(force = false) {
        if (this.isDismissed && !force) return;
        this.isDismissed = true;
        
        if (this.card) {
            this.card.classList.remove('lfb-visible');
            setTimeout(() => {
                if (this.card && this.card.parentNode) {
                    this.card.parentNode.removeChild(this.card);
                }
                this.card = null;
            }, 400);
        }
    }

    static injectStyles() {
        if (document.getElementById('leetfeedback-submission-styles')) return;
        const style = document.createElement('style');
        style.id = 'leetfeedback-submission-styles';
        style.textContent = `
            .leetfeedback-submission-card {
                position: fixed !important;
                bottom: 24px !important;
                right: 24px !important;
                width: 150px !important;
                height: 150px !important;
                background: rgba(10, 10, 10, 0.7) !important;
                backdrop-filter: blur(12px) !important;
                -webkit-backdrop-filter: blur(12px) !important;
                border: none !important;
                border-radius: 16px !important;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5) !important;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: space-between !important;
                padding: 16px 12px 12px 12px !important;
                box-sizing: border-box !important;
                z-index: 9999999 !important;
                color: #ffffff !important;
                opacity: 0;
                transform: translateY(20px);
                transition: opacity 0.3s ease, transform 0.3s ease;
                overflow: hidden !important;
                pointer-events: auto !important;
            }
            .leetfeedback-submission-card.lfb-visible {
                opacity: 1 !important;
                transform: translateY(0) !important;
            }
            .lfb-status-text {
                font-family: SFMono-Regular, Consolas, monospace !important;
                font-size: 9px !important;
                font-weight: 500 !important;
                line-height: 1.3 !important;
                color: #a3a3a3 !important;
                text-align: center !important;
                width: 100% !important;
                z-index: 3 !important;
                white-space: normal !important;
                word-wrap: break-word !important;
                overflow: hidden !important;
                margin-top: auto !important;
            }
            .lfb-close-btn {
                position: absolute !important;
                top: 8px !important;
                right: 8px !important;
                background: transparent !important;
                border: none !important;
                color: #666666 !important;
                font-size: 14px !important;
                cursor: pointer !important;
                z-index: 10 !important;
                padding: 0 !important;
                line-height: 1 !important;
                transition: color 0.2s ease !important;
            }
            .lfb-close-btn:hover {
                color: #ffffff !important;
            }
            .lfb-sync-orbiter {
                width: 80px !important;
                height: 80px !important;
                position: relative !important;
                margin-top: 10px !important;
            }
            .lfb-svg-anim {
                width: 100% !important;
                height: 100% !important;
            }
            .lfb-ring {
                transform-origin: 50px 50px !important;
            }
            .lfb-ring-outer {
                animation: lfb-rotate-clockwise 8s linear infinite !important;
                transition: stroke 0.3s;
            }
            .lfb-ring-inner {
                animation: lfb-rotate-counter-clockwise 5s linear infinite !important;
                transition: stroke 0.3s;
            }
            .lfb-dot-outer {
                transform-origin: 50px 50px !important;
                animation: lfb-rotate-clockwise 4s linear infinite !important;
            }
            .lfb-dot-inner {
                transform-origin: 50px 50px !important;
                animation: lfb-rotate-counter-clockwise 2.5s linear infinite !important;
            }
            .lfb-center-orb {
                transform-origin: 50px 50px !important;
                animation: lfb-pulse 2s ease-in-out infinite !important;
                transition: transform 0.3s, fill 0.3s;
            }
            .lfb-result-check, .lfb-result-cross {
                opacity: 0 !important;
                transition: opacity 0.2s;
            }
            
            /* State: Analyzing */
            .lfb-state-analyzing .lfb-dot-outer {
                animation-duration: 1.5s !important;
            }
            .lfb-state-analyzing .lfb-dot-inner {
                animation-duration: 1s !important;
            }
            .lfb-state-analyzing .lfb-center-orb {
                animation: lfb-pulse 0.8s ease-in-out infinite !important;
            }
            
            /* State: Syncing */
            .lfb-state-syncing .lfb-dot-outer {
                animation-duration: 0.8s !important;
            }
            .lfb-state-syncing .lfb-dot-inner {
                animation-duration: 0.5s !important;
            }
            .lfb-state-syncing .lfb-center-orb {
                animation: lfb-pulse 0.4s ease-in-out infinite !important;
            }
            
            /* State: Success */
            .lfb-state-success .lfb-ring,
            .lfb-state-success .lfb-dot {
                opacity: 0 !important;
                transition: opacity 0.3s !important;
            }
            .lfb-state-success .lfb-center-orb {
                animation: lfb-expand-fade 0.5s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important;
            }
            .lfb-state-success .lfb-result-check {
                opacity: 1 !important;
                stroke-dasharray: 40 !important;
                stroke-dashoffset: 40 !important;
                animation: lfb-draw-stroke 0.5s ease-out 0.2s forwards !important;
            }
            
            /* Celebrate explosion on success */
            .lfb-state-success .lfb-part {
                opacity: 1 !important;
            }
            .lfb-state-success .lfb-part-1 { animation: lfb-shoot-1 1s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important; }
            .lfb-state-success .lfb-part-2 { animation: lfb-shoot-2 1.1s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important; }
            .lfb-state-success .lfb-part-3 { animation: lfb-shoot-3 1s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important; }
            .lfb-state-success .lfb-part-4 { animation: lfb-shoot-4 0.9s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important; }
            .lfb-state-success .lfb-part-5 { animation: lfb-shoot-5 1.2s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important; }
            .lfb-state-success .lfb-part-6 { animation: lfb-shoot-6 1.1s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important; }
            .lfb-state-success .lfb-part-7 { animation: lfb-shoot-7 1.2s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important; }
            .lfb-state-success .lfb-part-8 { animation: lfb-shoot-8 1s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important; }
            
            /* State: Failure */
            .lfb-state-failure .lfb-ring,
            .lfb-state-failure .lfb-dot {
                opacity: 0 !important;
                transition: opacity 0.3s !important;
            }
            .lfb-state-failure .lfb-center-orb {
                animation: lfb-expand-fade 0.3s ease-in forwards !important;
            }
            .lfb-state-failure .lfb-result-cross {
                opacity: 1 !important;
                stroke-dasharray: 40 !important;
                stroke-dashoffset: 40 !important;
                animation: lfb-draw-stroke 0.4s ease-out forwards !important;
            }
            
            @keyframes lfb-rotate-clockwise {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            @keyframes lfb-rotate-counter-clockwise {
                from { transform: rotate(0deg); }
                to { transform: rotate(-360deg); }
            }
            @keyframes lfb-pulse {
                0% { transform: scale(1); opacity: 1; }
                50% { transform: scale(1.2); opacity: 0.7; }
                100% { transform: scale(1); opacity: 1; }
            }
            @keyframes lfb-expand-fade {
                to { transform: scale(3.5); opacity: 0; }
            }
            @keyframes lfb-draw-stroke {
                to { stroke-dashoffset: 0; }
            }
            
            /* Shoot trajectories */
            @keyframes lfb-shoot-1 {
                0% { transform: translate(0, 0) scale(1); opacity: 1; }
                100% { transform: translate(-32px, -32px) scale(0.3); opacity: 0; }
            }
            @keyframes lfb-shoot-2 {
                0% { transform: translate(0, 0) scale(1); opacity: 1; }
                100% { transform: translate(32px, -28px) scale(0.3); opacity: 0; }
            }
            @keyframes lfb-shoot-3 {
                0% { transform: translate(0, 0) scale(1); opacity: 1; }
                100% { transform: translate(-28px, 32px) scale(0.3); opacity: 0; }
            }
            @keyframes lfb-shoot-4 {
                0% { transform: translate(0, 0) scale(1); opacity: 1; }
                100% { transform: translate(28px, 28px) scale(0.3); opacity: 0; }
            }
            @keyframes lfb-shoot-5 {
                0% { transform: translate(0, 0) scale(1); opacity: 1; }
                100% { transform: translate(0, -36px) rotate(45deg) scale(0.4); opacity: 0; }
            }
            @keyframes lfb-shoot-6 {
                0% { transform: translate(0, 0) scale(1); opacity: 1; }
                100% { transform: translate(-36px, 6px) rotate(-30deg) scale(0.4); opacity: 0; }
            }
            @keyframes lfb-shoot-7 {
                0% { transform: translate(0, 0) scale(1); opacity: 1; }
                100% { transform: translate(36px, -6px) rotate(60deg) scale(0.4); opacity: 0; }
            }
            @keyframes lfb-shoot-8 {
                0% { transform: translate(0, 0) scale(1); opacity: 1; }
                100% { transform: translate(0, 36px) scale(0.3); opacity: 0; }
            }
            
            /* Celebration Particles styling */
            .lfb-part {
                opacity: 0 !important;
                transform-origin: 50px 50px !important;
            }
        `;
        document.head.appendChild(style);
    }
}

window.LeetFeedbackToast = new ToastNotification();
if (typeof debugLog === 'function') {
    debugLog('[Toast] Toast notification utility loaded');
} else if (typeof window !== 'undefined' && typeof window.isDebugMode === 'function' && window.isDebugMode()) {
    console.log('[Toast] Toast notification utility loaded');
}
