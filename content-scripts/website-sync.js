// Content script for traverses.tech and leet-feedback.vercel.app to sync auth state into extension storage

(function() {
  'use strict';

  function syncToExtension(token, user) {
    if (!token || !user) return;
    try {
      const accountId = `backend:${user.id || user.username}`;
      const account = {
        id: accountId,
        user: user,
        token: token,
        timestamp: Date.now(),
      };
      chrome.storage.local.set({
        auth_token: token,
        auth_user: user,
        auth_timestamp: Date.now(),
        auth_accounts: [account],
        auth_active_account_id: accountId,
      }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[TraverseSync] Error saving auth:', chrome.runtime.lastError);
        } else {
          console.log('[TraverseSync] Extension authenticated as:', user.username || user.email);
        }
      });
    } catch (e) {
      console.warn('[TraverseSync] Failed to sync auth to extension:', e);
    }
  }

  function clearExtensionAuth() {
    try {
      chrome.storage.local.remove([
        'auth_token',
        'auth_user',
        'auth_timestamp',
        'auth_accounts',
        'auth_active_account_id',
      ], () => {
        console.log('[TraverseSync] Extension auth cleared');
      });
    } catch (e) {}
  }

  // 1. Listen for custom DOM events dispatched by the website
  window.addEventListener('traverse:auth-sync', (event) => {
    if (event.detail && event.detail.token && event.detail.user) {
      syncToExtension(event.detail.token, event.detail.user);
    }
  });

  window.addEventListener('traverse:auth-logout', () => {
    clearExtensionAuth();
  });

  // 2. Initial check from website's localStorage if already logged in
  try {
    const rawUser = localStorage.getItem('backend_user');
    const authType = localStorage.getItem('auth_type');
    const token = localStorage.getItem('auth_token');
    if (rawUser && authType === 'backend') {
      const user = JSON.parse(rawUser);
      chrome.storage.local.get(['auth_user', 'auth_token'], (data) => {
        const effectiveToken = token || data.auth_token;
        if (effectiveToken && (!data.auth_user || data.auth_user.username !== user.username)) {
          syncToExtension(effectiveToken, user);
        }
      });
    }
  } catch (e) {}
})();
