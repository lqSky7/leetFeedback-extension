// Cross-browser polyfill: makes chrome.* work in Firefox and keeps Chrome happy
if (typeof chrome === "undefined" && typeof browser !== "undefined") {
globalThis.chrome = browser;
}

// Fixed background script

// Global debug mode cache for background script
let _bgDebugMode = false;

// Initialize debug mode cache
chrome.storage.sync.get(['debug_mode'], (data) => {
  _bgDebugMode = data.debug_mode || false;
});

// Listen for debug mode changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.debug_mode) {
    _bgDebugMode = changes.debug_mode.newValue || false;
  }
});

// Debug-aware logging functions for background script
function bgLog(...args) {
  if (_bgDebugMode) {
    console.log(...args);
  }
}

function bgError(...args) {
  if (_bgDebugMode) {
    console.error(...args);
  }
}

function bgWarn(...args) {
  if (_bgDebugMode) {
    console.warn(...args);
  }
}

bgLog("Background script starting...");

// Allow users to open the side panel by clicking on the action toolbar icon
if (chrome.sidePanel && typeof chrome.sidePanel.setPanelBehavior === 'function') {
chrome.sidePanel
.setPanelBehavior({ openPanelOnActionClick: true })
.catch((error) => bgError(error));
}

chrome.runtime.onInstalled.addListener(() => {
  bgLog("DSA to GitHub Extension installed.");

  // Initialize default settings
  chrome.storage.sync.get(['github_branch'], (data) => {
    const updates = {};

    if (!data.github_branch) {
      updates.github_branch = 'main';
    }

    if (Object.keys(updates).length > 0) {
      chrome.storage.sync.set(updates);
    }
  });
});

// Track browser session for timer reset
chrome.runtime.onStartup.addListener(() => {
  bgLog("Browser started - marking session restart");
  // Set a flag that indicates browser was restarted
  chrome.storage.local.set({ 
    browser_session_restarted: true,
    session_start_time: Date.now()
  });
});

// Also handle extension restart (when extension is reloaded)
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install' || details.reason === 'update') {
    bgLog("Extension installed/updated - marking session restart");
    chrome.storage.local.set({ 
      browser_session_restarted: true,
      session_start_time: Date.now()
    });
  }
});

// Handle messages from content scripts and sidepanel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  bgLog("Message received:", request.type);

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

    if (request.type === 'CONTENT_SCRIPT_READY') {
      handleContentScriptReady(request, sender, sendResponse);
      return true;
    }

    if (request.type === 'BACKEND_API_FETCH') {
      handleBackendAPIFetch(request, sender, sendResponse);
      return true;
    }

    // Unknown message type
    bgLog("Unknown message type:", request.type);
    sendResponse({ success: false, error: 'Unknown message type' });
  } catch (error) {
    bgError("Error in message listener:", error);
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
    bgError('Error getting user solution:', error);
    sendResponse({ success: false, error: error.message });
  }
}



// Handle content script ready notification
async function handleContentScriptReady(request, sender, sendResponse) {
  try {
    bgLog('[Background] Content script ready on:', request.url);
    sendResponse({ success: true });
  } catch (error) {
    bgError('Error handling content script ready:', error);
    sendResponse({ success: false, error: error.message });
  }
}
// Handle backend API fetch (to bypass CORS from content scripts)
async function handleBackendAPIFetch(request, sender, sendResponse) {
  try {
    const { url, options } = request;
    bgLog(`[Background] Making backend API request to: ${url}`);

    const response = await fetch(url, options);
    const data = await response.json();

    sendResponse({
      success: response.ok,
      status: response.status,
      data: data
    });
  } catch (error) {
    bgError('[Background] Backend API fetch error:', error);
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
    bgError('Error initializing config:', error);
    sendResponse({ success: false, error: error.message });
  }
}

bgLog("Background script loaded successfully");