// Fixed background script
console.log("Background script starting...");

// Allow users to open the side panel by clicking on the action toolbar icon
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.runtime.onInstalled.addListener(() => {
  console.log("DSA to GitHub Extension installed.");

  // Initialize default settings
  chrome.storage.sync.get(['github_branch', 'time_tracking'], (data) => {
    const updates = {};

    if (!data.github_branch) {
      updates.github_branch = 'main';
    }

    // Initialize time tracking data if it doesn't exist (with simplified structure)
    if (!data.time_tracking) {
      updates.time_tracking = {
        platforms: {
          leetcode: { totalTime: 0 },
          geeksforgeeks: { totalTime: 0 },
          takeuforward: { totalTime: 0 }
        },
        lastUpdated: new Date().toISOString()
      };
    }

    if (Object.keys(updates).length > 0) {
      chrome.storage.sync.set(updates);
    }
  });
});

// Handle messages from content scripts and sidepanel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Message received:", request.type);

  try {
    if (request.type === 'getUserSolution') {
      handleGetUserSolution(request, sender, sendResponse);
      return true; // Will respond asynchronously
    }

    if (request.type === 'testGitHubConnection') {
      handleTestGitHubConnection(request, sender, sendResponse);
      return true;
    }

    if (request.type === 'initializeConfig') {
      handleInitializeConfig(request, sender, sendResponse);
      return true;
    }

    if (request.type === 'updateTimeTracking') {
      handleUpdateTimeTracking(request, sender, sendResponse);
      return true;
    }

    if (request.type === 'getTimeTracking') {
      handleGetTimeTracking(request, sender, sendResponse);
      return true;
    }

    if (request.type === 'AUTH_STATE_CHANGED') {
      handleAuthStateChanged(request, sender, sendResponse);
      return true;
    }

    if (request.type === 'CONTENT_SCRIPT_READY') {
      handleContentScriptReady(request, sender, sendResponse);
      return true;
    }

    if (request.type === 'BACKEND_API_FETCH') {
      handleBackendAPIFetch(request, sender, sendResponse);
      return true;
    }

    // Unknown message type
    console.log("Unknown message type:", request.type);
    sendResponse({ success: false, error: 'Unknown message type' });
  } catch (error) {
    console.error("Error in message listener:", error);
    sendResponse({ success: false, error: error.message });
  }
});

// Handle getting user solution for GeeksforGeeks
async function handleGetUserSolution(request, sender, sendResponse) {
  try {
    if (request.platform === 'geeksforgeeks') {
      // Get debug mode first
      const debugMode = await getDebugMode();

      // Inject script to extract solution from GeeksforGeeks
      const results = await chrome.scripting.executeScript({
        target: { tabId: sender.tab.id },
        func: extractGfGSolution,
        args: [debugMode]
      });

      const solution = results[0]?.result || '';
      sendResponse({ success: true, solution });
    } else {
      sendResponse({ success: false, error: 'Platform not supported for solution extraction' });
    }
  } catch (error) {
    console.error('Error getting user solution:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Handle authentication state changes from website
async function handleAuthStateChanged(request, sender, sendResponse) {
  try {
    const { isAuthenticated, user } = request;

    console.log('[Background] Auth state changed:', { isAuthenticated, user: user?.email });

    // Store auth data in local storage for extension access
    if (isAuthenticated && user) {
      await chrome.storage.local.set({
        firebase_user: user,
        auth_timestamp: Date.now()
      });
      console.log('[Background] User authenticated and stored:', user.email);

      // Notify all extension contexts about auth change
      try {
        chrome.runtime.sendMessage({
          type: 'AUTH_UPDATE',
          isAuthenticated: true,
          user: user
        });
      } catch (e) {
        // Ignore if no listeners
      }
    } else {
      await chrome.storage.local.remove(['firebase_user', 'auth_timestamp']);
      console.log('[Background] User signed out, data cleared');

      // Notify all extension contexts about auth change
      try {
        chrome.runtime.sendMessage({
          type: 'AUTH_UPDATE',
          isAuthenticated: false,
          user: null
        });
      } catch (e) {
        // Ignore if no listeners
      }
    }

    sendResponse({ success: true });
  } catch (error) {
    console.error('Error handling auth state change:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Handle content script ready notification
async function handleContentScriptReady(request, sender, sendResponse) {
  try {
    console.log('[Background] Content script ready on:', request.url);

    // Check if we have cached auth data and should sync it
    const result = await chrome.storage.local.get(['firebase_user', 'auth_timestamp']);
    if (result.firebase_user && result.auth_timestamp) {
      const now = Date.now();
      const cacheAge = now - result.auth_timestamp;
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      if (cacheAge < maxAge) {
        console.log('[Background] Syncing cached auth data to content script');
        // Request fresh auth status from the website
        setTimeout(() => {
          chrome.tabs.sendMessage(sender.tab.id, {
            type: 'AUTH_STATUS_REQUEST'
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.log('Tab message failed:', chrome.runtime.lastError);
              return;
            }
            if (response && response.isAuthenticated) {
              console.log('[Background] Auth status confirmed from website');
            }
          });
        }, 1000);
      }
    }

    sendResponse({ success: true });
  } catch (error) {
    console.error('Error handling content script ready:', error);
    sendResponse({ success: false, error: error.message });
  }
}
// Handle backend API fetch (to bypass CORS from content scripts)
async function handleBackendAPIFetch(request, sender, sendResponse) {
  try {
    const { url, options } = request;
    console.log(`[Background] Making backend API request to: ${url}`);

    const response = await fetch(url, options);
    const data = await response.json();

    sendResponse({
      success: response.ok,
      status: response.status,
      data: data
    });
  } catch (error) {
    console.error('[Background] Backend API fetch error:', error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}
// Helper function to get debug mode
async function getDebugMode() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['debug_mode'], (data) => {
      resolve(data.debug_mode || false);
    });
  });
}

// Function to be injected into GeeksforGeeks page
function extractGfGSolution(debugMode = false) {
  try {
    if (debugMode) console.log('[GFG Debug] Starting solution extraction...');
    let code = '';

    // Method 1: Try to get from ACE editor
    if (debugMode) console.log('[GFG Debug] Checking ACE editor...');
    if (window.ace && window.ace.edit) {
      const editors = document.querySelectorAll('.ace_editor');
      if (debugMode) console.log('[GFG Debug] Found', editors.length, 'ACE editors');
      if (editors.length > 0) {
        try {
          const editor = window.ace.edit(editors[0]);
          code = editor.getValue();
          if (debugMode) console.log('[GFG Debug] ACE editor code length:', code.length);
          if (code && code.trim().length > 10) {
            if (debugMode) console.log('[GFG Debug] Successfully extracted from ACE editor');
            return code;
          }
        } catch (e) {
          if (debugMode) console.log('[GFG Debug] ACE editor error:', e);
        }
      }
    }

    // Method 2: Try to get from CodeMirror
    if (!code && window.CodeMirror) {
      if (debugMode) console.log('[GFG Debug] Checking CodeMirror...');
      const cmElements = document.querySelectorAll('.CodeMirror');
      if (debugMode) console.log('[GFG Debug] Found', cmElements.length, 'CodeMirror elements');
      if (cmElements.length > 0) {
        const cm = cmElements[0].CodeMirror;
        if (cm) {
          code = cm.getValue();
          if (debugMode) console.log('[GFG Debug] CodeMirror code length:', code.length);
          if (code && code.trim().length > 10) {
            if (debugMode) console.log('[GFG Debug] Successfully extracted from CodeMirror');
            return code;
          }
        }
      }
    }

    // Method 3: Try to get from Monaco editor
    if (!code && window.monaco && window.monaco.editor) {
      if (debugMode) console.log('[GFG Debug] Checking Monaco editor...');
      const models = window.monaco.editor.getModels();
      if (debugMode) console.log('[GFG Debug] Found', models.length, 'Monaco models');
      if (models.length > 0) {
        code = models[0].getValue();
        if (debugMode) console.log('[GFG Debug] Monaco code length:', code.length);
        if (code && code.trim().length > 10) {
          if (debugMode) console.log('[GFG Debug] Successfully extracted from Monaco');
          return code;
        }
      }
    }

    // Method 4: Try to get from specific textarea with the right content
    if (debugMode) console.log('[GFG Debug] Checking all textareas for code content...');
    const allTextareas = document.querySelectorAll('textarea');
    if (debugMode) console.log('[GFG Debug] Found', allTextareas.length, 'textareas');

    for (let i = 0; i < allTextareas.length; i++) {
      const textarea = allTextareas[i];
      const value = textarea.value;
      if (debugMode) console.log('[GFG Debug] Textarea', i, 'value length:', value.length);
      if (debugMode) console.log('[GFG Debug] Textarea', i, 'preview:', value.substring(0, 50));

      // Check if this textarea contains actual code (look for common programming patterns)
      if (value && value.trim().length > 10) {
        const hasCodePatterns = value.includes('{') ||
          value.includes('}') ||
          value.includes('class') ||
          value.includes('function') ||
          value.includes('def') ||
          value.includes('int ') ||
          value.includes('#include') ||
          value.includes('public') ||
          value.includes('return');

        if (hasCodePatterns) {
          code = value;
          if (debugMode) console.log('[GFG Debug] Using textarea', i, 'with code patterns detected');
          if (debugMode) console.log('[GFG Debug] Code preview:', code.substring(0, 200));
          return code;
        }
      }
    }

    // Method 5: Try to get from DOM elements with line extraction
    if (!code) {
      if (debugMode) console.log('[GFG Debug] Checking DOM elements for code lines...');
      const codeElements = [
        '.ace_content',
        '.CodeMirror-code',
        '.monaco-editor .view-lines',
        '.ace_text-layer'
      ];

      for (const selector of codeElements) {
        const element = document.querySelector(selector);
        if (element) {
          if (debugMode) console.log('[GFG Debug] Found element with selector:', selector);
          // Try to extract code line by line
          const lines = element.querySelectorAll('.ace_line, .CodeMirror-line, .view-line');
          if (lines.length > 0) {
            const codeLines = Array.from(lines).map(line => line.textContent || line.innerText).filter(line => line.trim());
            if (codeLines.length > 0) {
              code = codeLines.join('\n');
              if (debugMode) console.log('[GFG Debug] Extracted', codeLines.length, 'lines of code');
              if (code.trim().length > 10) {
                if (debugMode) console.log('[GFG Debug] Successfully extracted from DOM lines');
                return code;
              }
            }
          }
        }
      }
    }

    if (debugMode) console.log('[GFG Debug] No code found with any method');
    return code || '';
  } catch (error) {
    if (debugMode) console.log('[GFG Debug] Error during extraction:', error);
    return '';
  }
}

async function handleTestGitHubConnection(request, sender, sendResponse) {
  try {
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${request.token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API responded with ${response.status}`);
    }

    const userData = await response.json();
    sendResponse({ success: true, user: userData });
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleInitializeConfig(request, sender, sendResponse) {
  try {
    const result = await chrome.storage.sync.get([
      'github_token',
      'github_owner',
      'github_repo',
      'github_branch',
      'gemini_api_key'
    ]);

    const config = {
      token: result.github_token || '',
      owner: result.github_owner || '',
      repo: result.github_repo || '',
      branch: result.github_branch || 'main',
      geminiApiKey: result.gemini_api_key || ''
    };

    sendResponse({ success: true, config });
  } catch (error) {
    console.error('Error initializing config:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Handle backend API fetch (to bypass CORS from content scripts)
async function handleBackendAPIFetch(request, sender, sendResponse) {
  try {
    const { url, options } = request;
    console.log(`[Background] Making backend API request to: ${url}`);

    const response = await fetch(url, options);
    const data = await response.json();

    sendResponse({
      success: response.ok,
      status: response.status,
      data: data
    });
  } catch (error) {
    console.error('[Background] Backend API fetch error:', error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}

async function handleUpdateTimeTracking(request, sender, sendResponse) {
  try {
    const { platform, timeSpent } = request;

    const result = await chrome.storage.sync.get(['time_tracking']);
    const timeTracking = result.time_tracking || {
      platforms: {
        leetcode: { totalTime: 0 },
        geeksforgeeks: { totalTime: 0 },
        takeuforward: { totalTime: 0 }
      },
      lastUpdated: new Date().toISOString()
    };

    if (!timeTracking.platforms[platform]) {
      timeTracking.platforms[platform] = { totalTime: 0 };
    }

    timeTracking.platforms[platform].totalTime += timeSpent;
    timeTracking.lastUpdated = new Date().toISOString();

    await chrome.storage.sync.set({ time_tracking: timeTracking });
    sendResponse({ success: true, timeTracking });
  } catch (error) {
    console.error('Error updating time tracking:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleGetTimeTracking(request, sender, sendResponse) {
  try {
    const result = await chrome.storage.sync.get(['time_tracking']);
    const timeTracking = result.time_tracking || {
      platforms: {
        leetcode: { totalTime: 0 },
        geeksforgeeks: { totalTime: 0 },
        takeuforward: { totalTime: 0 }
      },
      lastUpdated: new Date().toISOString()
    };

    sendResponse({ success: true, timeTracking });
  } catch (error) {
    console.error('Error getting time tracking:', error);
    sendResponse({ success: false, error: error.message });
  }
}

console.log("Background script loaded successfully");