importScripts(
  'shared/config.js',
  'shared/logger.js',
  'shared/events.js'
);

const bgLogger = globalThis.Traverse && globalThis.Traverse.createLogger
  ? globalThis.Traverse.createLogger('Background')
  : console;

// Debug-aware logging functions for background script
function bgLog(...args) {
  bgLogger.log(...args);
}

function bgError(...args) {
  bgLogger.error(...args);
}

function bgWarn(...args) {
  bgLogger.warn(...args);
}

bgLog("Background script starting...");

// Allow users to open the side panel by clicking on the action toolbar icon
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => bgError(error));

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

// Handle getting user solution (deprecated in favor of network interception)
async function handleGetUserSolution(request, sender, sendResponse) {
  sendResponse({
    success: false,
    error: 'Direct DOM extraction is deprecated; solutions are captured via network interception.',
  });
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
  let timeoutId = null;
  try {
    const { url, options, timeoutMs } = request;
    bgLog(`[Background] Making backend API request to: ${url}`);

    const controller = typeof AbortController !== 'undefined' && timeoutMs
      ? new AbortController()
      : null;
    timeoutId = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    // Enforce latest auth_token from storage to prevent stale tab tokens
    const fetchOptions = {
      ...(options || {}),
      credentials: 'omit', // Prevent ambient browser cookies from overriding Bearer token
    };
    if (fetchOptions.headers && fetchOptions.headers.Authorization) {
      try {
        const storedAuth = await chrome.storage.local.get(['auth_token']);
        if (storedAuth && storedAuth.auth_token) {
          fetchOptions.headers.Authorization = `Bearer ${storedAuth.auth_token}`;
        }
      } catch (authErr) {
        bgWarn('[Background] Failed to re-fetch latest auth_token:', authErr);
      }
    }

    const response = await fetch(url, {
      ...fetchOptions,
      ...(controller ? { signal: controller.signal } : {}),
    });
    const text = await response.text();
    let data = {};

    if (text) {
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        data = { raw: text };
      }
    }

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
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
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

// Reconcile multi-account storage with direct session on startup
try {
  chrome.storage.local.get(['auth_token', 'auth_user', 'auth_active_account_id'], (data) => {
    if (data && data.auth_user && data.auth_token) {
      const expectedId = `backend:${data.auth_user.id || data.auth_user.username}`;
      if (data.auth_active_account_id !== expectedId) {
        chrome.storage.local.set({
          auth_accounts: [{
            id: expectedId,
            user: data.auth_user,
            token: data.auth_token,
            timestamp: Date.now()
          }],
          auth_active_account_id: expectedId
        });
      }
    }
  });
} catch (e) {
  bgWarn('[Background] Auth reconciliation failed:', e);
}

// ── Website → Extension Auth Sync via externally_connectable ──
// When the user logs in or out on traverses.tech or vercel.app, the website pushes auth state directly here.
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  const allowedOrigins =
    (globalThis.Traverse &&
      globalThis.Traverse.config &&
      globalThis.Traverse.config.allowedExternalOrigins) || [
      'https://traverses.tech',
      'https://leet-feedback.vercel.app',
      'http://localhost:5173',
      'http://localhost:3000',
    ];

  const senderUrl = sender.url || '';
  const isAllowed = allowedOrigins.some((origin) => senderUrl.startsWith(origin));

  if (!isAllowed) {
    bgWarn('[ExtSync] Rejected message from unauthorized origin:', senderUrl);
    sendResponse({ success: false, error: 'Unauthorized origin' });
    return false;
  }

  if (request.type === 'AUTH_SYNC' && request.token && request.user) {
    bgLog('[ExtSync] Received auth sync from website for user:', request.user?.username);
    const accountId = `backend:${request.user.id || request.user.username}`;
    const account = {
      id: accountId,
      user: request.user,
      token: request.token,
      timestamp: Date.now(),
    };

    chrome.storage.local.set({
      auth_token: request.token,
      auth_user: request.user,
      auth_timestamp: Date.now(),
      auth_accounts: [account],
      auth_active_account_id: accountId,
    }, () => {
      bgLog('[ExtSync] Auth state stored successfully');
      sendResponse({ success: true });
    });
    return true; // async sendResponse
  }

  if (request.type === 'AUTH_LOGOUT') {
    bgLog('[ExtSync] Received logout from website');

    chrome.storage.local.remove([
      'auth_token',
      'auth_user',
      'auth_timestamp',
      'auth_accounts',
      'auth_active_account_id',
    ], () => {
      bgLog('[ExtSync] Auth state cleared');
      sendResponse({ success: true });
    });
    return true; // async sendResponse
  }

  sendResponse({ success: false, error: 'Unknown message type' });
  return false;
});

