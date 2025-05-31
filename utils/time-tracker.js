// Simple Time Tracking Utility for DSA to GitHub extension

class TimeTracker {
  constructor() {
    this.platform = this.determinePlatform();
    this.lastUpdate = Date.now();
    this.timeIncrement = 60000; // Update time in 1 minute increments
    
    // Set up silent tracking
    if (this.platform) {
      this.setupTracking();
    }
  }

  determinePlatform() {
    const hostname = window.location.hostname;
    
    if (hostname.includes('leetcode.com')) {
      return 'leetcode';
    } else if (hostname.includes('geeksforgeeks.org')) {
      return 'geeksforgeeks';
    } else if (hostname.includes('takeuforward.org')) {
      return 'takeuforward';
    }
    
    return null;
  }

  setupTracking() {
    // Update time every minute while page is active
    setInterval(() => this.updateTimeSpent(), this.timeIncrement);
    
    // Handle page visibility changes
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.lastUpdate = Date.now();
      } else {
        this.updateTimeSpent();
      }
    });
  }
  
  updateTimeSpent() {
    if (!this.platform) return;
    
    const now = Date.now();
    const timeSpent = now - this.lastUpdate;
    
    // Only track if reasonable amount of time has passed
    if (timeSpent > 0 && timeSpent < 10 * 60 * 1000) { // Less than 10 minutes
      chrome.runtime.sendMessage({
        type: 'updateTimeTracking',
        platform: this.platform,
        timeSpent: timeSpent
      });
    }
    
    this.lastUpdate = now;
  }
}

// Initialize tracker silently
new TimeTracker();