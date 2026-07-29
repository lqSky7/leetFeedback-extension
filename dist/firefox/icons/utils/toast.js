// Toast notification utility for DSA to GitHub extension

class ToastNotification {
    constructor() {
        this.container = null;
        this.toasts = [];
        this.init();
    }

    init() {
        // Create container if it doesn't exist
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

    /**
     * Show a toast notification
     * @param {string} message - The message to display
     * @param {string} type - 'success', 'error', or 'info'
     * @param {number} duration - Duration in ms (default 5000)
     */
    show(message, type = 'info', duration = 5000) {
        this.init(); // Ensure container exists

        const toast = document.createElement('div');
        toast.className = `leetfeedback-toast leetfeedback-toast-${type}`;

        // Colors based on type - matching sidebar design
        const colors = {
            success: { bg: '#0a0a0a', border: '#22c55e', text: '#22c55e' },
            error: { bg: '#0a0a0a', border: '#ef4444', text: '#ef4444' },
            info: { bg: '#0a0a0a', border: '#1c1c1c', text: '#b8b8b8' }
        };

        const color = colors[type] || colors.info;

        toast.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      background: ${color.bg};
      border: 1px solid ${color.border};
      border-radius: 10px;
      color: ${color.text};
      font-size: 13px;
      line-height: 1.4;
      width: 280px;
      min-height: 44px;
      max-height: 44px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.6);
      pointer-events: auto;
      transform: translateX(120%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease, background 0.3s ease, border-color 0.3s ease;
      opacity: 0;
      font-family: 'HarmonyOS Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

        // Status indicator dot
        const dotSpan = document.createElement('span');
        dotSpan.className = 'toast-dot';
        dotSpan.style.cssText = `
      flex-shrink: 0;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: ${color.border};
      transition: background 0.3s ease;
    `;

        // Message text
        const textSpan = document.createElement('div');
        textSpan.className = 'toast-text';
        textSpan.style.cssText = `
      flex: 1;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.2px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;
        textSpan.textContent = message;

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.style.cssText = `
      flex-shrink: 0;
      background: transparent;
      border: none;
      color: ${color.text};
      width: 20px;
      height: 20px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s ease;
      opacity: 0.6;
    `;
        closeBtn.textContent = '×';
        closeBtn.onmouseover = () => { 
            closeBtn.style.background = 'rgba(255, 255, 255, 0.1)'; 
            closeBtn.style.opacity = '1';
        };
        closeBtn.onmouseout = () => { 
            closeBtn.style.background = 'transparent'; 
            closeBtn.style.opacity = '0.6';
        };
        closeBtn.onclick = () => this.dismiss(toast);

        toast.appendChild(dotSpan);
        toast.appendChild(textSpan);
        toast.appendChild(closeBtn);

        this.container.appendChild(toast);
        this.toasts.push(toast);

        // Animate in
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                toast.style.transform = 'translateX(0)';
                toast.style.opacity = '1';
            });
        });

        // Auto dismiss
        if (duration > 0) {
            toast._autoDismissTimeout = setTimeout(() => this.dismiss(toast), duration);
        }

        return toast;
    }

    /**
     * Update an existing toast with new message and type
     * @param {HTMLElement} toast - The toast element to update
     * @param {string} message - The new message
     * @param {string} type - The new type ('success', 'error', or 'info')
     * @param {number} duration - Duration in ms (default 5000)
     */
    update(toast, message, type = 'info', duration = 5000) {
        if (!toast || !toast.parentNode) return;

        // Clear any existing auto-dismiss timeout
        if (toast._autoDismissTimeout) {
            clearTimeout(toast._autoDismissTimeout);
            toast._autoDismissTimeout = null;
        }

        // Colors based on type - matching sidebar design
        const colors = {
            success: { bg: '#0a0a0a', border: '#22c55e', text: '#22c55e' },
            error: { bg: '#0a0a0a', border: '#ef4444', text: '#ef4444' },
            info: { bg: '#0a0a0a', border: '#1c1c1c', text: '#b8b8b8' }
        };

        const color = colors[type] || colors.info;

        // Update background and border with transition
        toast.style.borderColor = color.border;
        toast.style.color = color.text;

        // Update dot color
        const dotSpan = toast.querySelector('.toast-dot');
        if (dotSpan) {
            dotSpan.style.background = color.border;
        }

        // Update message text
        const textSpan = toast.querySelector('.toast-text');
        if (textSpan) {
            textSpan.textContent = message;
        }

        // Update close button color
        const closeBtn = toast.querySelector('.toast-close');
        if (closeBtn) {
            closeBtn.style.color = color.text;
        }

        // Set new auto-dismiss timeout
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

    success(message, duration = 5000) {
        return this.show(message, 'success', duration);
    }

    error(message, duration = 6000) {
        return this.show(message, 'error', duration);
    }

    info(message, duration = 5000) {
        return this.show(message, 'info', duration);
    }
}

// Create global instance
window.LeetFeedbackToast = new ToastNotification();
// Use debug-aware logging if available
if (typeof debugLog === 'function') {
    debugLog('[Toast] Toast notification utility loaded');
} else if (typeof window !== 'undefined' && typeof window.isDebugMode === 'function' && window.isDebugMode()) {
    console.log('[Toast] Toast notification utility loaded');
}
