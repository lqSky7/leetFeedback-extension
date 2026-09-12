// Traverse — background service worker.
//
// Deliberately thin. Its jobs:
//   1. Proxy cross-origin backend requests (content scripts cannot make them).
//   2. Own auth storage: accept the website's session over
//      `externally_connectable` and keep the multi-account list consistent.
//   3. Open the side panel when the toolbar icon is clicked.
//   4. Flag a browser restart so ProblemTimer starts a fresh timer.
//
// It holds NO problem state — that lives in the content scripts and in
// chrome.storage, because MV3 workers are terminated whenever they go idle.
//
// Every async `sendResponse` path must `return true`, or the channel closes
// before the response is sent.

importScripts('../core/config.js', '../core/logger.js');

const T = globalThis.Traverse;
const logger = T.createLogger('background');
const keys = T.config.keys;

const AUTH_KEYS = [
  keys.auth.token,
  keys.auth.user,
  keys.auth.timestamp,
  keys.auth.accounts,
  keys.auth.activeAccountId,
];

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
  logger.error('could not set side panel behavior:', error);
});

/* ── lifecycle ── */

chrome.runtime.onInstalled.addListener((details) => {
  logger.log(`installed/updated (${details.reason})`);

  chrome.storage.sync.get([keys.github.branch], (data) => {
    if (!data[keys.github.branch]) {
      chrome.storage.sync.set({ [keys.github.branch]: 'main' });
    }
  });

  markSessionRestarted();
});

chrome.runtime.onStartup.addListener(markSessionRestarted);

/** Tells ProblemTimer that any timer persisted before this launch is stale. */
function markSessionRestarted() {
  chrome.storage.local.set({
    [keys.browserSessionRestarted]: true,
    [keys.sessionStartTime]: Date.now(),
  });
}

/* ── runtime messages (content scripts + sidepanel) ── */

const RUNTIME_HANDLERS = {
  BACKEND_API_FETCH: handleBackendAPIFetch,
};

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handler = request && RUNTIME_HANDLERS[request.type];
  if (!handler) {
    logger.log('ignoring unknown message type:', request && request.type);
    sendResponse({ success: false, error: 'Unknown message type' });
    return false;
  }

  logger.log('message:', request.type);
  handler(request, sender, sendResponse);
  return true; // async response
});

/**
 * Perform a backend request on behalf of a content script.
 *
 * The Authorization header is rebuilt from storage rather than trusted from the
 * caller, so a tab holding a stale token cannot push under the wrong account.
 * `credentials: 'omit'` keeps ambient cookies from overriding the bearer token.
 */
async function handleBackendAPIFetch(request, sender, sendResponse) {
  let timeoutId = null;

  try {
    const { url, options, timeoutMs } = request;
    logger.log(`fetching ${url}`);

    const controller = typeof AbortController !== 'undefined' && timeoutMs ? new AbortController() : null;
    if (controller) timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const fetchOptions = { ...(options || {}), credentials: 'omit' };

    if (fetchOptions.headers && fetchOptions.headers.Authorization) {
      try {
        const stored = await chrome.storage.local.get([keys.auth.token]);
        if (stored[keys.auth.token]) {
          fetchOptions.headers.Authorization = `Bearer ${stored[keys.auth.token]}`;
        }
      } catch (error) {
        logger.warn('could not refresh auth token:', error);
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
      } catch (_) {
        data = { raw: text };
      }
    }

    sendResponse({ success: response.ok, status: response.status, data });
  } catch (error) {
    logger.error('backend fetch failed:', error);
    sendResponse({ success: false, error: error.message });
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/* ── website → extension auth sync ── */

/**
 * The website pushes the session here directly (no content script needed).
 * Requests from any other origin are rejected.
 */
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  const senderUrl = sender.url || '';
  const allowed = T.config.allowedExternalOrigins.some((origin) => senderUrl.startsWith(origin));

  if (!allowed) {
    logger.warn('rejected external message from', senderUrl);
    sendResponse({ success: false, error: 'Unauthorized origin' });
    return false;
  }

  if (request.type === 'AUTH_SYNC' && request.token && request.user) {
    logger.log('auth sync received for', request.user.username);

    const accountId = `backend:${request.user.id || request.user.username}`;
    chrome.storage.local.set(
      {
        [keys.auth.token]: request.token,
        [keys.auth.user]: request.user,
        [keys.auth.timestamp]: Date.now(),
        [keys.auth.accounts]: [
          { id: accountId, user: request.user, token: request.token, timestamp: Date.now() },
        ],
        [keys.auth.activeAccountId]: accountId,
      },
      () => {
        sendResponse({ success: true });
      }
    );
    return true; // async response
  }

  if (request.type === 'AUTH_LOGOUT') {
    logger.log('logout received from website');
    chrome.storage.local.remove(AUTH_KEYS, () => {
      sendResponse({ success: true });
    });
    return true; // async response
  }

  sendResponse({ success: false, error: 'Unknown message type' });
  return false;
});

/* ── auth reconciliation ── */

/**
 * If the direct session (auth_token/auth_user) exists but the multi-account
 * list does not point at it, rebuild the list. This heals storage written by an
 * older version of the extension.
 */
chrome.storage.local.get([keys.auth.token, keys.auth.user, keys.auth.activeAccountId], (data) => {
  const token = data[keys.auth.token];
  const user = data[keys.auth.user];

  if (!token || !user) return;

  const expectedId = `backend:${user.id || user.username}`;
  if (data[keys.auth.activeAccountId] === expectedId) return;

  logger.log('reconciling multi-account storage');
  chrome.storage.local.set({
    [keys.auth.accounts]: [{ id: expectedId, user, token, timestamp: Date.now() }],
    [keys.auth.activeAccountId]: expectedId,
  });
});

logger.log('background worker ready');
