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

        // Colors based on type
        const colors = {
            success: { bg: '#10b981', border: '#059669', icon: '✓' },
            error: { bg: '#ef4444', border: '#dc2626', icon: '✕' },
            info: { bg: '#3b82f6', border: '#2563eb', icon: 'ℹ' }
        };

        const color = colors[type] || colors.info;

        toast.style.cssText = `
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px 18px;
      background: ${color.bg};
      border: 1px solid ${color.border};
      border-radius: 12px;
      color: white;
      font-size: 14px;
      line-height: 1.4;
      max-width: 380px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3), 0 4px 12px rgba(0, 0, 0, 0.2);
      pointer-events: auto;
      transform: translateX(120%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease;
      opacity: 0;
    `;

        // Icon
        const iconSpan = document.createElement('span');
        iconSpan.style.cssText = `
      flex-shrink: 0;
      width: 22px;
      height: 22px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 50%;
      font-size: 12px;
      font-weight: bold;
    `;
        iconSpan.textContent = color.icon;

        // Message content
        const messageDiv = document.createElement('div');
        messageDiv.style.cssText = `
      flex: 1;
      word-wrap: break-word;
    `;

        // Title
        const titleSpan = document.createElement('div');
        titleSpan.style.cssText = `
      font-weight: 600;
      margin-bottom: 2px;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      opacity: 0.9;
    `;
        titleSpan.textContent = type === 'success' ? 'Traverse' : type === 'error' ? 'Error' : 'Info';

        // Message text
        const textSpan = document.createElement('div');
        textSpan.style.cssText = `font-size: 14px;`;
        textSpan.textContent = message;

        messageDiv.appendChild(titleSpan);
        messageDiv.appendChild(textSpan);

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.style.cssText = `
      flex-shrink: 0;
      background: rgba(255, 255, 255, 0.2);
      border: none;
      color: white;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s ease;
    `;
        closeBtn.textContent = '×';
        closeBtn.onmouseover = () => { closeBtn.style.background = 'rgba(255, 255, 255, 0.3)'; };
        closeBtn.onmouseout = () => { closeBtn.style.background = 'rgba(255, 255, 255, 0.2)'; };
        closeBtn.onclick = () => this.dismiss(toast);

        toast.appendChild(iconSpan);
        toast.appendChild(messageDiv);
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
            setTimeout(() => this.dismiss(toast), duration);
        }

        return toast;
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
console.log('[Toast] Toast notification utility loaded');
