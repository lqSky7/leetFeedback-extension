// Traverse — website → extension auth bridge.
//
// Runs on the Traverse website (traverses.tech / preview deploys / localhost).
// Two ways the website can hand over a session:
//   1. A DOM event: window.dispatchEvent(new CustomEvent('traverse:auth-sync', { detail: { token, user } }))
//   2. localStorage, for a user who was already signed in before the extension loaded.
//
// The same handshake is also accepted directly by the background worker via
// `externally_connectable` (AUTH_SYNC / AUTH_LOGOUT). Both paths write the same
// storage keys — see background/index.md.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});
  const logger = T.createLogger ? T.createLogger('site-sync') : console;

  /** Storage keys come from core/config.js; the literals are the data contract. */
  function authKeys() {
    const keys = (T.config && T.config.keys && T.config.keys.auth) || {};
    return {
      token: keys.token || 'auth_token',
      user: keys.user || 'auth_user',
      timestamp: keys.timestamp || 'auth_timestamp',
      accounts: keys.accounts || 'auth_accounts',
      activeAccountId: keys.activeAccountId || 'auth_active_account_id',
    };
  }

  function syncToExtension(token, user) {
    if (!token || !user) return;

    const k = authKeys();
    const accountId = `backend:${user.id || user.username}`;

    try {
      chrome.storage.local.set(
        {
          [k.token]: token,
          [k.user]: user,
          [k.timestamp]: Date.now(),
          [k.accounts]: [{ id: accountId, user, token, timestamp: Date.now() }],
          [k.activeAccountId]: accountId,
        },
        () => {
          if (chrome.runtime.lastError) {
            logger.error('failed to save auth:', chrome.runtime.lastError);
          } else {
            logger.log('extension authenticated as', user.username || user.email);
          }
        }
      );
    } catch (error) {
      logger.error('syncToExtension failed:', error);
    }
  }

  function clearExtensionAuth() {
    const k = authKeys();
    try {
      chrome.storage.local.remove([k.token, k.user, k.timestamp, k.accounts, k.activeAccountId], () => {
        logger.log('extension auth cleared');
      });
    } catch (error) {
      logger.error('clearExtensionAuth failed:', error);
    }
  }

  // 1. Explicit handshake from the website.
  window.addEventListener('traverse:auth-sync', (event) => {
    const detail = event.detail;
    if (detail && detail.token && detail.user) syncToExtension(detail.token, detail.user);
  });

  window.addEventListener('traverse:auth-logout', () => clearExtensionAuth());

  // 2. Already signed in on the website when the extension loaded.
  try {
    const rawUser = localStorage.getItem('backend_user');
    const authType = localStorage.getItem('auth_type');
    const localToken = localStorage.getItem('auth_token');

    if (rawUser && authType === 'backend') {
      const user = JSON.parse(rawUser);
      const k = authKeys();

      chrome.storage.local.get([k.user, k.token], (data) => {
        const effectiveToken = localToken || data[k.token];
        const alreadySynced = data[k.user] && data[k.user].username === user.username;
        if (effectiveToken && !alreadySynced) syncToExtension(effectiveToken, user);
      });
    }
  } catch (error) {
    logger.error('localStorage bootstrap failed:', error);
  }
})();
