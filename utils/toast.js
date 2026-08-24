// Toast notification utility for Traverse (leetFeedback-extension)
// High contrast floating toast notifications

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
                bottom: 24px;
                right: 24px;
                z-index: 999999;
                display: flex;
                flex-direction: column-reverse;
                gap: 10px;
                pointer-events: none;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
            `;
            document.body.appendChild(this.container);
        }
    }

    show(message, type = 'info', duration = 5000) {
        this.init();
        const toast = document.createElement('div');
        toast.className = `leetfeedback-toast leetfeedback-toast-${type}`;

        // Semantic colors
        const colors = {
            success: { bg: '#0A0A0A', border: 'rgba(14, 131, 69, 0.4)', indicator: '#0E8345', text: '#FFFFFF' },
            error: { bg: '#0A0A0A', border: 'rgba(225, 25, 0, 0.4)', indicator: '#E11900', text: '#FFFFFF' },
            info: { bg: '#0A0A0A', border: 'rgba(39, 110, 241, 0.4)', indicator: '#276EF1', text: '#FFFFFF' }
        };
        const theme = colors[type] || colors.info;

        toast.style.cssText = `
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
            background: ${theme.bg};
            border: 1px solid ${theme.border};
            border-radius: 10px;
            color: ${theme.text};
            font-size: 13px;
            font-weight: 500;
            line-height: 1.4;
            min-width: 280px;
            max-width: 380px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.05);
            pointer-events: auto;
            transform: translateX(120%);
            transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.25s ease;
            opacity: 0;
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
        `;

        const dotSpan = document.createElement('span');
        dotSpan.style.cssText = `
            flex-shrink: 0;
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: ${theme.indicator};
            box-shadow: 0 0 8px ${theme.indicator};
        `;

        const textSpan = document.createElement('div');
        textSpan.style.cssText = `
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            letter-spacing: 0.01em;
        `;
        textSpan.textContent = message;

        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = `
            flex-shrink: 0;
            background: transparent;
            border: none;
            color: #8A8A8A;
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
            padding: 0 2px;
            transition: color 0.15s ease;
        `;
        closeBtn.textContent = '×';
        closeBtn.onmouseover = () => { closeBtn.style.color = '#FFFFFF'; };
        closeBtn.onmouseout = () => { closeBtn.style.color = '#8A8A8A'; };
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
        }, 250);
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
                <svg class="lfb-svg-anim" viewBox="0 0 100 100" width="84" height="84">
                    <!-- Concentric Radar / Telemetry Grid Rings -->
                    <circle class="lfb-radar-grid-1" cx="50" cy="50" r="42" stroke="rgba(255, 255, 255, 0.08)" stroke-width="1" fill="none" />
                    <circle class="lfb-radar-grid-2" cx="50" cy="50" r="28" stroke="rgba(255, 255, 255, 0.12)" stroke-width="1" fill="none" />
                    <circle class="lfb-radar-grid-3" cx="50" cy="50" r="14" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1" fill="none" />
                    
                    <!-- Radar Crosshairs -->
                    <line x1="50" y1="8" x2="50" y2="92" stroke="rgba(255, 255, 255, 0.06)" stroke-width="1" stroke-dasharray="2 4" />
                    <line x1="8" y1="50" x2="92" y2="50" stroke="rgba(255, 255, 255, 0.06)" stroke-width="1" stroke-dasharray="2 4" />

                    <!-- Radar Telemetry Sweep Beam in Cobalt Blue -->
                    <circle class="lfb-ring lfb-ring-outer" cx="50" cy="50" r="38" stroke="#276EF1" stroke-width="2" stroke-dasharray="24 60" stroke-linecap="round" fill="none" />
                    <circle class="lfb-ring lfb-ring-inner" cx="50" cy="50" r="24" stroke="rgba(255, 255, 255, 0.4)" stroke-width="1.5" stroke-dasharray="16 40" stroke-linecap="round" fill="none" />
                    
                    <!-- Orbiting Dispatch Beacons -->
                    <circle class="lfb-dot lfb-dot-outer" cx="88" cy="50" r="3" fill="#276EF1" />
                    <circle class="lfb-dot lfb-dot-inner" cx="74" cy="50" r="2" fill="#FFFFFF" />
                    
                    <!-- Center Pulse Node (Dispatch Core) -->
                    <circle class="lfb-radar-pulse-ring" cx="50" cy="50" r="6" stroke="#276EF1" stroke-width="1.5" fill="none" />
                    <circle class="lfb-center-orb" cx="50" cy="50" r="5" fill="#FFFFFF" />
                    
                    <!-- Celebration Star/Ball Particles -->
                    <g class="lfb-celebration-particles">
                        <circle class="lfb-part lfb-part-1" cx="50" cy="50" r="3.5" fill="#276EF1" />
                        <circle class="lfb-part lfb-part-2" cx="50" cy="50" r="3" fill="#0E8345" />
                        <circle class="lfb-part lfb-part-3" cx="50" cy="50" r="4" fill="#FFFFFF" />
                        <circle class="lfb-part lfb-part-4" cx="50" cy="50" r="2.5" fill="#79A3F7" />
                        <path class="lfb-part lfb-part-5" d="M50 42 L52 47 L58 47 L53 50 L55 56 L50 52 L45 56 L47 50 L42 47 L48 47 Z" fill="#276EF1" />
                        <path class="lfb-part lfb-part-6" d="M50 42 L52 47 L58 47 L53 50 L55 56 L50 52 L45 56 L47 50 L42 47 L48 47 Z" fill="#FFFFFF" />
                        <path class="lfb-part lfb-part-7" d="M50 42 L52 47 L58 47 L53 50 L55 56 L50 52 L45 56 L47 50 L42 47 L48 47 Z" fill="#34D399" />
                        <circle class="lfb-part lfb-part-8" cx="50" cy="50" r="3" fill="#AFAFAF" />
                    </g>

                    <!-- Result Status Paths -->
                    <path class="lfb-result-check" d="M36 50 L46 60 L64 40" stroke="#0E8345" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                    <path class="lfb-result-cross" d="M38 38 L62 62 M62 38 L38 62" stroke="#E11900" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                </svg>
            </div>
            <div class="lfb-status-text">JUDGING</div>
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
        this.setAISkipped();
    }

    setAIComplete() {
        this.setAISkipped();
    }

    setAISkipped() {
        this._transitionTo('slow-rise', () => {
            this._setText('Syncing...');
            if (this.orbiter) {
                this.orbiter.className = 'lfb-sync-orbiter lfb-state-syncing';
            }
        });
    }

    setBackendStarted() {
        if (this.state === 'judging' || this.state === 'analyzing') {
            this.setAISkipped();
        } else if (this.state === 'slow-rise') {
            this._setText('Syncing...');
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
        this.isDismissed = true;
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
            }, 300);
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
                width: 156px !important;
                height: 156px !important;
                background: rgba(10, 10, 10, 0.88) !important;
                backdrop-filter: blur(16px) !important;
                -webkit-backdrop-filter: blur(16px) !important;
                border: 1px solid rgba(255, 255, 255, 0.12) !important;
                border-radius: 16px !important;
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(39, 110, 241, 0.15) !important;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: space-between !important;
                padding: 14px 12px 12px 12px !important;
                box-sizing: border-box !important;
                z-index: 9999999 !important;
                color: #FFFFFF !important;
                opacity: 0;
                transform: translateY(16px) scale(0.96);
                transition: opacity 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
                overflow: hidden !important;
                pointer-events: auto !important;
            }
            .leetfeedback-submission-card.lfb-visible {
                opacity: 1 !important;
                transform: translateY(0) scale(1) !important;
            }
            .lfb-status-text {
                font-family: -apple-system, BlinkMacSystemFont, 'SFMono-Regular', Consolas, sans-serif !important;
                font-size: 10px !important;
                font-weight: 700 !important;
                letter-spacing: 0.06em !important;
                text-transform: uppercase !important;
                color: #FFFFFF !important;
                text-align: center !important;
                width: 100% !important;
                z-index: 3 !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                text-overflow: ellipsis !important;
                margin-top: auto !important;
            }
            .lfb-close-btn {
                position: absolute !important;
                top: 8px !important;
                right: 8px !important;
                background: transparent !important;
                border: none !important;
                color: #6E6E6E !important;
                font-size: 16px !important;
                cursor: pointer !important;
                z-index: 10 !important;
                padding: 0 !important;
                line-height: 1 !important;
                transition: color 0.15s ease !important;
            }
            .lfb-close-btn:hover {
                color: #FFFFFF !important;
            }
            .lfb-sync-orbiter {
                width: 84px !important;
                height: 84px !important;
                position: relative !important;
                margin-top: 6px !important;
            }
            .lfb-svg-anim {
                width: 100% !important;
                height: 100% !important;
            }
            .lfb-ring {
                transform-origin: 50px 50px !important;
            }
            .lfb-ring-outer {
                animation: lfb-rotate-clockwise 4s linear infinite !important;
                transition: stroke 0.3s;
            }
            .lfb-ring-inner {
                animation: lfb-rotate-counter-clockwise 3s linear infinite !important;
                transition: stroke 0.3s;
            }
            .lfb-dot-outer {
                transform-origin: 50px 50px !important;
                animation: lfb-rotate-clockwise 2.5s linear infinite !important;
            }
            .lfb-dot-inner {
                transform-origin: 50px 50px !important;
                animation: lfb-rotate-counter-clockwise 1.8s linear infinite !important;
            }
            .lfb-radar-pulse-ring {
                transform-origin: 50px 50px !important;
                animation: lfb-radar-pulse 2s cubic-bezier(0.2, 0.8, 0.2, 1) infinite !important;
            }
            .lfb-center-orb {
                transform-origin: 50px 50px !important;
                animation: lfb-node-pulse 1.8s ease-in-out infinite !important;
                transition: transform 0.3s, fill 0.3s;
            }
            .lfb-result-check, .lfb-result-cross {
                opacity: 0 !important;
                transition: opacity 0.2s;
            }
            
            /* State: Syncing */
            .lfb-state-syncing .lfb-ring-outer {
                animation-duration: 1.2s !important;
                stroke: #276EF1 !important;
            }
            .lfb-state-syncing .lfb-ring-inner {
                animation-duration: 0.8s !important;
            }
            .lfb-state-syncing .lfb-dot-outer {
                animation-duration: 1s !important;
            }
            .lfb-state-syncing .lfb-dot-inner {
                animation-duration: 0.6s !important;
            }
            .lfb-state-syncing .lfb-radar-pulse-ring {
                animation-duration: 0.9s !important;
            }
            
            /* State: Success */
            .lfb-state-success .lfb-ring,
            .lfb-state-success .lfb-dot,
            .lfb-state-success .lfb-radar-grid-1,
            .lfb-state-success .lfb-radar-grid-2,
            .lfb-state-success .lfb-radar-grid-3,
            .lfb-state-success .lfb-radar-pulse-ring {
                opacity: 0 !important;
                transition: opacity 0.25s !important;
            }
            .lfb-state-success .lfb-center-orb {
                animation: lfb-expand-fade 0.5s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important;
            }
            .lfb-state-success .lfb-result-check {
                opacity: 1 !important;
                stroke-dasharray: 40 !important;
                stroke-dashoffset: 40 !important;
                animation: lfb-draw-stroke 0.4s ease-out 0.15s forwards !important;
            }
            
            /* Celebrate particles */
            .lfb-state-success .lfb-part {
                opacity: 1 !important;
            }
            .lfb-state-success .lfb-part-1 { animation: lfb-shoot-1 0.9s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important; }
            .lfb-state-success .lfb-part-2 { animation: lfb-shoot-2 1s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important; }
            .lfb-state-success .lfb-part-3 { animation: lfb-shoot-3 0.9s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important; }
            .lfb-state-success .lfb-part-4 { animation: lfb-shoot-4 0.8s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important; }
            .lfb-state-success .lfb-part-5 { animation: lfb-shoot-5 1.1s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important; }
            .lfb-state-success .lfb-part-6 { animation: lfb-shoot-6 1s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important; }
            .lfb-state-success .lfb-part-7 { animation: lfb-shoot-7 1.1s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important; }
            .lfb-state-success .lfb-part-8 { animation: lfb-shoot-8 0.9s cubic-bezier(0.1, 0.8, 0.3, 1) forwards !important; }
            
            /* State: Failure */
            .lfb-state-failure .lfb-ring,
            .lfb-state-failure .lfb-dot,
            .lfb-state-failure .lfb-radar-grid-1,
            .lfb-state-failure .lfb-radar-grid-2,
            .lfb-state-failure .lfb-radar-grid-3,
            .lfb-state-failure .lfb-radar-pulse-ring {
                opacity: 0 !important;
                transition: opacity 0.25s !important;
            }
            .lfb-state-failure .lfb-center-orb {
                animation: lfb-expand-fade 0.3s ease-in forwards !important;
            }
            .lfb-state-failure .lfb-result-cross {
                opacity: 1 !important;
                stroke-dasharray: 40 !important;
                stroke-dashoffset: 40 !important;
                animation: lfb-draw-stroke 0.35s ease-out forwards !important;
            }
            
            @keyframes lfb-rotate-clockwise {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
            @keyframes lfb-rotate-counter-clockwise {
                from { transform: rotate(0deg); }
                to { transform: rotate(-360deg); }
            }
            @keyframes lfb-radar-pulse {
                0% { transform: scale(1); opacity: 0.8; }
                100% { transform: scale(3.5); opacity: 0; }
            }
            @keyframes lfb-node-pulse {
                0% { transform: scale(1); opacity: 1; }
                50% { transform: scale(1.25); opacity: 0.85; }
                100% { transform: scale(1); opacity: 1; }
            }
            @keyframes lfb-expand-fade {
                to { transform: scale(3.5); opacity: 0; }
            }
            @keyframes lfb-draw-stroke {
                to { stroke-dashoffset: 0; }
            }
            
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
