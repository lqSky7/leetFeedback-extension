// Common utilities for DSA to GitHub extension

const DSA_PLATFORMS = {
  LEETCODE: 'leetcode',
  GEEKSFORGEEKS: 'geeksforgeeks',
  TAKEUFORWARD: 'takeuforward',
  CODECHEF: 'codechef',
  NAUKRI: 'naukri'
};

// Global debug mode cache for synchronous access
let _debugModeCache = false;
let _debugModeCacheInitialized = false;

// Initialize debug mode cache on load
(async function initDebugCache() {
  try {
    const result = await chrome.storage.sync.get(['debug_mode']);
    _debugModeCache = result.debug_mode || false;
    _debugModeCacheInitialized = true;
  } catch (e) {
    // Ignore - storage may not be available
  }
})();

// Listen for debug mode changes
try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.debug_mode) {
      _debugModeCache = changes.debug_mode.newValue || false;
    }
  });
} catch (e) {
  // Ignore - may not be in extension context
}

/**
 * Synchronous debug log function - logs only if debug mode is enabled
 * @param {...any} args - Arguments to pass to console.log
 */
function debugLog(...args) {
  if (_debugModeCache) {
    console.log(...args);
  }
}

/**
 * Synchronous debug error function - logs only if debug mode is enabled
 * @param {...any} args - Arguments to pass to console.error
 */
function debugError(...args) {
  if (_debugModeCache) {
    console.error(...args);
  }
}

/**
 * Synchronous debug warn function - logs only if debug mode is enabled
 * @param {...any} args - Arguments to pass to console.warn
 */
function debugWarn(...args) {
  if (_debugModeCache) {
    console.warn(...args);
  }
}

/**
 * Check if debug mode is enabled (synchronous)
 * @returns {boolean}
 */
function isDebugMode() {
  return _debugModeCache;
}

// Make debug functions available globally
window.debugLog = debugLog;
window.debugError = debugError;
window.debugWarn = debugWarn;
window.isDebugMode = isDebugMode;

const LANGUAGE_EXTENSIONS = {
  'C++': '.cpp',
  'cpp': '.cpp',
  'C': '.c',
  'Java': '.java',
  'Python': '.py',
  'Python3': '.py',
  'python': '.py',
  'Go': '.go',
};

class DSAUtils {
  static getCurrentPlatform() {
    const hostname = window.location.hostname;

    if (hostname.includes('leetcode.com')) {
      return DSA_PLATFORMS.LEETCODE;
    } else if (hostname.includes('geeksforgeeks.org')) {
      return DSA_PLATFORMS.GEEKSFORGEEKS;
    } else if (hostname.includes('takeuforward.org')) {
      return DSA_PLATFORMS.TAKEUFORWARD;
    } else if (hostname.includes('codechef.com')) {
      return DSA_PLATFORMS.CODECHEF;
    } else if (hostname.includes('naukri.com')) {
      return DSA_PLATFORMS.NAUKRI;
    }

    return null;
  }

  static getFileExtension(language) {
    return LANGUAGE_EXTENSIONS[language] || '.txt';
  }

  static sanitizeFileName(filename) {
    return filename
      .replace(/[^a-zA-Z0-9\-_\s]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase();
  }

  static formatProblemName(name) {
    return name
      .replace(/^\d+\.\s*/, '') // Remove number prefix
      .trim()
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .toLowerCase();
  }

  static async getStoredConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get([
        'github_token',
        'github_owner',
        'github_repo',
        'github_branch'
      ], (data) => {
        resolve({
          token: data.github_token || '',
          owner: data.github_owner || '',
          repo: data.github_repo || '',
          branch: data.github_branch || 'main'
        });
      });
    });
  }

  static isConfigComplete(config) {
    return config.token && config.owner && config.repo;
  }



  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static generateCommitMessage(platform, problemInfo) {
    const { title, number, difficulty, language, stats } = problemInfo;

    // Format consistently: "problem name - platform [difficulty]"

    // Clean up the title based on platform-specific patterns
    let cleanTitle = title;

    // Remove problem number prefix (e.g., "1. Two Sum")
    cleanTitle = cleanTitle.replace(/^\d+\.\s*/, '');

    // Remove platform prefixes (e.g., "[LEETCODE]", "[GEEKSFORGEEKS]")
    cleanTitle = cleanTitle.replace(/\[(LEETCODE|GEEKSFORGEEKS|GFG|TAKEUFORWARD)\]/i, '');

    // Remove difficulty in parentheses (e.g., "(Medium)", "(Easy)")
    cleanTitle = cleanTitle.replace(/\s*\((Easy|Medium|Hard|School|Basic)\)\s*/i, '');

    // Remove any remaining brackets and their contents
    cleanTitle = cleanTitle.replace(/\[.*?\]/g, '');

    // Normalize whitespace and trim
    cleanTitle = cleanTitle.replace(/\s+/g, ' ').trim();

    // Capitalize platform name properly
    const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);

    // Build the final message in the required format
    let message = `${cleanTitle} - ${platformName}`;

    // Add difficulty in square brackets if available
    if (difficulty) {
      message += ` [${difficulty}]`;
    }

    return message;
  }

  static createDirectoryPath(platform, problemInfo) {
    const { difficulty, category, number, title } = problemInfo;

    let path = platform;

    if (difficulty) {
      path += `/${difficulty.toLowerCase()}`;
    }

    if (category) {
      path += `/${this.sanitizeFileName(category)}`;
    }

    if (number && title) {
      const folderName = `${number}-${this.formatProblemName(title)}`;
      path += `/${folderName}`;
    } else if (title) {
      path += `/${this.formatProblemName(title)}`;
    }

    return path;
  }

  static async updateStats(platform, operation = 'increment') {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['dsa_stats'], (data) => {
        const stats = data.dsa_stats || {};

        if (!stats[platform]) {
          stats[platform] = { solved: 0, lastSolved: null };
        }

        if (operation === 'increment') {
          stats[platform].solved += 1;
          stats[platform].lastSolved = new Date().toISOString();
        }

        chrome.storage.sync.set({ dsa_stats: stats }, () => {
          resolve(stats);
        });
      });
    });
  }

  static async logDebug(platform, message, data = null) {
    if (_debugModeCache) {
      const timestamp = new Date().toISOString();
      console.log(`[DSA-to-GitHub][${platform}][${timestamp}] ${message}`, data || '');
    }
  }

  static async logError(platform, message, error = null) {
    if (_debugModeCache) {
      const timestamp = new Date().toISOString();
      console.error(`[DSA-to-GitHub][${platform}][${timestamp}] ${message}`, error || '');
    }
  }

  static async getDebugMode() {
    return _debugModeCache;
  }
}

// Make utilities available globally
window.DSAUtils = DSAUtils;
window.DSA_PLATFORMS = DSA_PLATFORMS;
window.LANGUAGE_EXTENSIONS = LANGUAGE_EXTENSIONS;