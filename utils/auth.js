'use strict';

// Debug mode cache for auth.js
let _authDebugMode = false;

// Initialize debug mode cache
if (typeof chrome !== 'undefined' && chrome.storage?.sync) {
  chrome.storage.sync.get(['debug_mode'], (data) => {
    _authDebugMode = data.debug_mode || false;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.debug_mode) {
      _authDebugMode = changes.debug_mode.newValue || false;
    }
  });
}

// Debug-aware logging functions
function authDbgLog(...args) {
  if (_authDebugMode) console.log(...args);
}
function authDbgError(...args) {
  if (_authDebugMode) console.error(...args);
}
function authDbgWarn(...args) {
  if (_authDebugMode) console.warn(...args);
}

class ExtensionAuth {
  constructor(options = {}) {
    this.apiBaseUrl = options.baseUrl || this.getApiBaseUrl();
    this.user = null;
    this.token = null;
    this.isAuthenticated = false;
    this.accounts = [];
    this.activeAccountId = null;
    this.authStatusCallbacks = [];
    this.fetchImpl =
      options.fetch ||
      (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  }

  getApiBaseUrl() {
    return 'https://traverse-backend-api.azurewebsites.net';
  }

  async init() {
    await this.syncFromStorage();
  }

  async syncFromStorage() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      return;
    }

    try {
      const data = await chrome.storage.local.get([
        'auth_accounts',
        'auth_active_account_id',
        'auth_user',
        'auth_token',
        'auth_timestamp',
      ]);

      const normalizedAccounts = this.normalizeAccounts(data.auth_accounts);
      if (normalizedAccounts.length > 0) {
        this.accounts = normalizedAccounts;

        let activeAccount =
          normalizedAccounts.find((account) => account.id === data.auth_active_account_id) ||
          normalizedAccounts[0];

        const hasSession = Boolean(activeAccount?.user && activeAccount?.token);
        this.activeAccountId = activeAccount?.id || null;

        await this.updateAuthStatus(
          hasSession,
          hasSession ? activeAccount.user : null,
          hasSession ? activeAccount.token : null,
          {
            persist: false,
            silent: true,
            accountId: activeAccount?.id || null,
            keepAccounts: true,
          },
        );
        return;
      }

      const hasSession = Boolean(data.auth_user && data.auth_token);
      if (hasSession) {
        const accountId = this.buildAccountId(data.auth_user, data.auth_token);
        this.accounts = [
          {
            id: accountId,
            user: data.auth_user,
            token: data.auth_token,
            timestamp: data.auth_timestamp || Date.now(),
          },
        ];
        this.activeAccountId = accountId;
        await this.updateAuthStatus(true, data.auth_user, data.auth_token, {
          persist: false,
          silent: true,
          accountId,
          keepAccounts: true,
        });
        await this.persistAuthState();
        return;
      }

      await this.updateAuthStatus(false, null, null, {
        persist: false,
        silent: true,
      });
    } catch (error) {
      authDbgError('[ExtensionAuth] Error syncing auth state:', error);
      await this.updateAuthStatus(false, null, null, {
        persist: false,
        silent: true,
      });
    }
  }

  normalizeAccounts(rawAccounts) {
    if (!Array.isArray(rawAccounts)) return [];

    return rawAccounts
      .map((account) => {
        if (!account || typeof account !== 'object') return null;
        const user = account.user || null;
        const token = account.token || null;
        const id = account.id || this.buildAccountId(user, token);

        if (!user || !token || !id) return null;

        return {
          id,
          user,
          token,
          timestamp: account.timestamp || Date.now(),
        };
      })
      .filter(Boolean);
  }

  buildAccountId(user, token = null) {
    const provider = user?.provider || 'backend';
    const username = user?.username || user?.email || user?.name || 'user';
    const tokenFingerprint = token ? this.hashValue(token) : 'no-token';
    return `${provider}:${username}:${tokenFingerprint}`;
  }

  hashValue(value) {
    if (!value) return 'empty';
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
  }

  getActiveAccountEntry() {
    if (!this.activeAccountId) return null;
    return this.accounts.find((account) => account.id === this.activeAccountId) || null;
  }

  static pickToken(response) {
    if (!response || typeof response !== 'object') return null;
    return (
      response.token ||
      response.access_token ||
      response.authToken ||
      response.jwt ||
      response.data?.token ||
      response.data?.access_token ||
      response.data?.authToken ||
      null
    );
  }

  static pickUser(response, fallback = null) {
    if (!response || typeof response !== 'object') {
      return fallback;
    }

    return (
      response.user ||
      response.profile ||
      response.data?.user ||
      response.data?.profile ||
      fallback
    );
  }

  static pickMessage(response, fallback) {
    if (!response || typeof response !== 'object') return fallback;
    return (
      response.message ||
      response.error ||
      response.detail ||
      response.status ||
      response.info ||
      fallback
    );
  }

  buildHeaders(includeAuth = false) {
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (includeAuth && this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    return headers;
  }

  async request(path, { method = 'GET', body = undefined, includeAuth = false } = {}) {
    if (!this.fetchImpl) {
      throw new Error('fetch is not available in this environment');
    }

    const url = `${this.apiBaseUrl}${path}`;
    const init = {
      method,
      headers: this.buildHeaders(includeAuth),
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (networkError) {
      authDbgError('[ExtensionAuth] Network error:', networkError);
      throw new Error('Unable to reach authentication service. Check your connection.');
    }

    let parsed;
    const text = await response.text();
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch (parseError) {
        parsed = { raw: text };
      }
    } else {
      parsed = {};
    }

    if (!response.ok) {
      const message = ExtensionAuth.pickMessage(
        parsed,
        `Request failed with status ${response.status}`,
      );
      throw new Error(message);
    }

    return parsed;
  }

  async login(credentials = {}) {
    const payload = {
      username: credentials.username?.trim(),
      password: credentials.password,
    };

    if (!payload.username || !payload.password) {
      throw new Error('Username and password are required.');
    }

    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: payload,
    });

    const token = ExtensionAuth.pickToken(data);
    const user =
      ExtensionAuth.pickUser(data, {
        username: payload.username,
      }) || {
        username: payload.username,
      };

    if (!token) {
      authDbgWarn('[ExtensionAuth] Login succeeded but no token in response. Response keys:', Object.keys(data));
    } else {
      authDbgLog('[ExtensionAuth] Token received from login');
    }

    const accountId = this.buildAccountId(user, token || null);
    await this.updateAuthStatus(true, user, token || null, { accountId });

    return { token: token || null, user, data };
  }

  /**
   * Signs out the current account.
   * @param {{ clearAll?: boolean }} options - Pass clearAll=true to remove all stored accounts.
   */
  async signOut(options = {}) {
    const clearAll = Boolean(options.clearAll);

    if (clearAll || this.accounts.length === 0) {
      this.accounts = [];
      this.activeAccountId = null;
      await this.updateAuthStatus(false, null, null);
      return;
    }

    const activeId = this.activeAccountId;
    if (!activeId) {
      this.accounts = [];
      await this.updateAuthStatus(false, null, null);
      return;
    }

    const remainingAccounts = this.accounts.filter((account) => account.id !== activeId);
    this.accounts = remainingAccounts;

    if (remainingAccounts.length === 0) {
      this.activeAccountId = null;
      await this.updateAuthStatus(false, null, null);
      return;
    }

    const nextActive = remainingAccounts[0];
    this.activeAccountId = nextActive.id;
    await this.updateAuthStatus(true, nextActive.user, nextActive.token, {
      accountId: nextActive.id,
      keepAccounts: true,
    });
  }

  async requestAuthStatus() {
    await this.syncFromStorage();
    this.notifyAuthStatus();
  }

  async persistAuthState() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

    await chrome.storage.local.set({
      auth_accounts: this.accounts,
      auth_active_account_id: this.activeAccountId || null,
    });

    const active = this.getActiveAccountEntry();
    const hasLegacySession = Boolean(active?.user && active?.token);

    if (hasLegacySession) {
      await chrome.storage.local.set({
        auth_user: active.user,
        auth_token: active.token,
        auth_timestamp: active.timestamp || Date.now(),
      });
      authDbgLog('[ExtensionAuth] Storing active account token in chrome.storage.local');
      return;
    }

    await chrome.storage.local.remove([
      'auth_user',
      'auth_token',
      'auth_timestamp',
      'firebase_user',
    ]);
  }

  async clearSession() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

    await chrome.storage.local.remove([
      'auth_accounts',
      'auth_active_account_id',
      'auth_user',
      'auth_token',
      'auth_timestamp',
      'firebase_user',
    ]);
  }

  async updateAuthStatus(isAuthenticated, user, token, options = {}) {
    this.isAuthenticated = Boolean(isAuthenticated);
    this.user = this.isAuthenticated ? user : null;
    this.token = this.isAuthenticated ? token || null : null;

    if (this.isAuthenticated && this.user && this.token) {
      const accountId = options.accountId || this.buildAccountId(this.user, this.token);
      this.activeAccountId = accountId;

      const existingIndex = this.accounts.findIndex((account) => account.id === accountId);
      const nextEntry = {
        id: accountId,
        user: this.user,
        token: this.token,
        timestamp: Date.now(),
      };

      if (existingIndex >= 0) {
        this.accounts[existingIndex] = nextEntry;
      } else {
        this.accounts.push(nextEntry);
      }
    } else if (options.keepAccounts !== true) {
      this.accounts = [];
      this.activeAccountId = null;
    }

    if (options.persist !== false) {
      if (this.isAuthenticated || options.keepAccounts === true) {
        await this.persistAuthState();
      } else {
        await this.clearSession();
      }
    }

    if (!options.silent) {
      this.notifyAuthStatus();
    }
  }

  onAuthStatusChange(callback) {
    if (typeof callback !== 'function') {
      return () => {};
    }

    this.authStatusCallbacks.push(callback);

    callback({
      isAuthenticated: this.isAuthenticated,
      user: this.user,
      token: this.token,
      accounts: this.getAccounts(),
      activeAccountId: this.activeAccountId,
    });

    return () => {
      const index = this.authStatusCallbacks.indexOf(callback);
      if (index >= 0) {
        this.authStatusCallbacks.splice(index, 1);
      }
    };
  }

  notifyAuthStatus() {
    const snapshot = {
      isAuthenticated: this.isAuthenticated,
      user: this.user,
      token: this.token,
      accounts: this.getAccounts(),
      activeAccountId: this.activeAccountId,
    };

    this.authStatusCallbacks.forEach((callback) => {
      try {
        callback(snapshot);
      } catch (error) {
        authDbgError('[ExtensionAuth] Auth callback failed:', error);
      }
    });
  }

  getAccounts() {
    return this.accounts.map((account) => ({
      id: account.id,
      user: account.user,
      timestamp: account.timestamp || null,
    }));
  }

  async switchAccount(accountId) {
    if (!accountId) {
      throw new Error('Account ID is required.');
    }

    const targetAccount = this.accounts.find((account) => account.id === accountId);
    if (!targetAccount) {
      throw new Error('Selected account not found.');
    }

    await this.updateAuthStatus(true, targetAccount.user, targetAccount.token, {
      accountId: targetAccount.id,
      keepAccounts: true,
    });

    return {
      id: targetAccount.id,
      user: targetAccount.user,
    };
  }

  getCurrentUser() {
    return this.user;
  }

  isUserAuthenticated() {
    return this.isAuthenticated;
  }

  getAuthHeaders() {
    if (!this.token) return {};
    return { Authorization: `Bearer ${this.token}` };
  }

  getUserDisplayName() {
    if (!this.user) return null;
    return (
      this.user.username ||
      this.user.displayName ||
      this.user.name ||
      this.user.email ||
      'User'
    );
  }

  getUserEmail() {
    if (!this.user) return null;
    return this.user.email || null;
  }

  getUserProfilePicture() {
    if (!this.user) return null;
    return this.user.photoURL || this.user.avatar || null;
  }

  getAuthProvider() {
    if (!this.user) return null;
    return this.user.provider || 'backend';
  }

  async openSignIn() {
    if (typeof chrome === 'undefined' || !chrome.tabs?.create) {
      throw new Error('Cannot open sign-in page outside of Chrome extension context.');
    }

    try {
      await chrome.tabs.create({
        url: this.apiBaseUrl,
        active: true,
      });
    } catch (error) {
      authDbgError('[ExtensionAuth] Failed to open sign-in page:', error);
      throw error;
    }
  }
}

const extensionAuth = new ExtensionAuth();

if (typeof chrome !== 'undefined' && chrome.storage?.local) {
  extensionAuth
    .init()
    .catch((error) =>
      authDbgError('[ExtensionAuth] Failed to initialize auth:', error),
    );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = extensionAuth;
  module.exports.ExtensionAuth = ExtensionAuth;
} else {
  window.extensionAuth = extensionAuth;
}
