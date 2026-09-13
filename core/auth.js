// Traverse — sidepanel authentication.
//
// Owns the sign-in / sign-out / multi-account flows for the sidepanel. The
// background worker owns the *storage* side (external auth sync from the
// website); this class reads that storage and drives the UI.
//
// Exposed as `window.extensionAuth` and as `T.extensionAuth`.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  const silentLogger = { log() {}, warn() {}, error() {} };
  const logger = T.createLogger ? T.createLogger('auth') : silentLogger;

  /**
   * Storage keys come from core/config.js. The literals are the data contract
   * and double as a fallback so this module also loads outside the extension
   * (see tests/auth.test.js).
   */
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

  // Legacy key from an earlier auth implementation; cleared on sign-out so it
  // cannot resurrect a stale session.
  const LEGACY_USER_KEY = 'firebase_user';

  class ExtensionAuth {
    constructor(options = {}) {
      this.apiBaseUrl = options.baseUrl || this.getApiBaseUrl();
      this.websiteBaseUrl = options.websiteBaseUrl || this.getWebsiteBaseUrl();
      this.user = null;
      this.token = null;
      this.isAuthenticated = false;
      this.accounts = [];
      this.activeAccountId = null;
      this.authStatusCallbacks = [];
      this.fetchImpl = options.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, area) => {
          const k = authKeys();
          if (area === 'local' && (changes[k.token] || changes[k.user])) {
            logger.log('storage auth change detected, resyncing');
            this.syncFromStorage().then(() => this.notifyAuthStatus());
          }
        });
      }
    }

    getApiBaseUrl() {
      return (T.config && T.config.backendBaseURL) || 'https://neatness-enlarged-curled.ngrok-free.dev';
    }

    getWebsiteBaseUrl() {
      return (T.config && T.config.websiteBaseURL) || 'https://traverses.tech';
    }

    async init() {
      await this.syncFromStorage();
    }

    /** Rebuild in-memory auth state from chrome.storage.local. */
    async syncFromStorage() {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;

      const k = authKeys();
      try {
        const data = await chrome.storage.local.get([
          k.user,
          k.token,
          k.timestamp,
          k.accounts,
          k.activeAccountId,
        ]);

        // Direct session (set by the website's externally_connectable sync).
        if (data[k.user] && data[k.token]) {
          this.accounts = [{ id: 'primary', user: data[k.user], token: data[k.token] }];
          this.activeAccountId = 'primary';
          await this.updateAuthStatus(true, data[k.user], data[k.token], {
            persist: false,
            silent: true,
            accountId: 'primary',
            keepAccounts: true,
          });
          return;
        }

        // Multi-account list with one active entry.
        const accounts = this.normalizeAccounts(data[k.accounts]);
        if (accounts.length > 0) {
          const active =
            accounts.find((account) => account.id === data[k.activeAccountId]) || accounts[0];
          const hasSession = Boolean(active && active.user && active.token);

          this.accounts = accounts;
          this.activeAccountId = active ? active.id : null;
          await this.updateAuthStatus(
            hasSession,
            hasSession ? active.user : null,
            hasSession ? active.token : null,
            { persist: false, silent: true, accountId: active ? active.id : null, keepAccounts: true }
          );
          return;
        }

        await this.updateAuthStatus(false, null, null, { persist: false, silent: true });
      } catch (error) {
        logger.error('syncFromStorage failed:', error);
        await this.updateAuthStatus(false, null, null, { persist: false, silent: true });
      }
    }

    /** Drop malformed entries; returns only usable { id, user, token } records. */
    normalizeAccounts(rawAccounts) {
      if (!Array.isArray(rawAccounts)) return [];

      return rawAccounts
        .map((account) => {
          if (!account || typeof account !== 'object') return null;
          const user = account.user || null;
          const token = account.token || null;
          const id = account.id || this.buildAccountId(user);
          if (!user || !token || !id) return null;
          return { id, user, token, timestamp: account.timestamp || Date.now() };
        })
        .filter(Boolean);
    }

    /**
     * Stable account id. Prefers an explicit id/sub, then the username, then a
     * fingerprint of the user object so two accounts without ids stay distinct.
     */
    buildAccountId(user) {
      const provider = (user && user.provider) || 'backend';
      const username = user && (user.username || user.email || user.name);

      let fingerprint = 'anonymous';
      if (user && typeof user === 'object') {
        const entries = Object.entries(user)
          .filter(([key, value]) => key !== 'token' && value !== undefined && value !== null)
          .sort(([a], [b]) => a.localeCompare(b));
        if (entries.length > 0) {
          fingerprint = entries.map(([key, value]) => `${key}:${String(value)}`).join('|');
        }
      }

      const identity = (user && (user.id || user.sub)) || username || fingerprint;
      return `${provider}:${identity}`;
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
        (response.data && (response.data.token || response.data.access_token || response.data.authToken)) ||
        null
      );
    }

    static pickUser(response, fallback = null) {
      if (!response || typeof response !== 'object') return fallback;
      return (
        response.user ||
        response.profile ||
        (response.data && (response.data.user || response.data.profile)) ||
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
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (includeAuth && this.token) headers.Authorization = `Bearer ${this.token}`;
      return headers;
    }

    async request(path, { method = 'GET', body = undefined, includeAuth = false } = {}) {
      if (!this.fetchImpl) throw new Error('fetch is not available in this environment');

      const init = { method, headers: this.buildHeaders(includeAuth) };
      if (body !== undefined) init.body = JSON.stringify(body);

      let response;
      try {
        response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, init);
      } catch (networkError) {
        logger.error('network error:', networkError);
        throw new Error('Unable to reach authentication service. Check your connection.');
      }

      const text = await response.text();
      let parsed = {};
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch (_) {
          parsed = { raw: text };
        }
      }

      if (!response.ok) {
        throw new Error(
          ExtensionAuth.pickMessage(parsed, `Request failed with status ${response.status}`)
        );
      }

      return parsed;
    }

    async login(credentials = {}) {
      const payload = {
        username: credentials.username && credentials.username.trim(),
        password: credentials.password,
      };
      if (!payload.username || !payload.password) {
        throw new Error('Username and password are required.');
      }

      const data = await this.request('/api/auth/login', { method: 'POST', body: payload });

      const token = ExtensionAuth.pickToken(data);
      const user =
        ExtensionAuth.pickUser(data, { username: payload.username }) || { username: payload.username };

      if (!token) {
        logger.warn('login succeeded but response carried no token');
      }

      await this.updateAuthStatus(true, user, token || null, { accountId: this.buildAccountId(user) });
      return { token: token || null, user, data };
    }

    async signOut() {
      this.accounts = [];
      this.activeAccountId = null;
      this.user = null;
      this.token = null;
      this.isAuthenticated = false;

      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const k = authKeys();
        await chrome.storage.local.remove([
          k.user,
          k.token,
          k.timestamp,
          k.accounts,
          k.activeAccountId,
          LEGACY_USER_KEY,
        ]);
      }

      await this.updateAuthStatus(false, null, null);
    }

    async requestAuthStatus() {
      await this.syncFromStorage();
      this.notifyAuthStatus();
    }

    /** Write the account list + the active account's direct session. */
    async persistAuthState() {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      const k = authKeys();

      await chrome.storage.local.set({
        [k.accounts]: this.accounts,
        [k.activeAccountId]: this.activeAccountId || null,
      });

      const active = this.getActiveAccountEntry();
      if (active && active.user && active.token) {
        await chrome.storage.local.set({
          [k.user]: active.user,
          [k.token]: active.token,
          [k.timestamp]: active.timestamp || Date.now(),
        });
        return;
      }

      await chrome.storage.local.remove([k.user, k.token, k.timestamp, LEGACY_USER_KEY]);
    }

    async clearSession() {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      const k = authKeys();
      await chrome.storage.local.remove([
        k.accounts,
        k.activeAccountId,
        k.user,
        k.token,
        k.timestamp,
        LEGACY_USER_KEY,
      ]);
    }

    async updateAuthStatus(isAuthenticated, user, token, options = {}) {
      this.isAuthenticated = Boolean(isAuthenticated);
      this.user = this.isAuthenticated ? user : null;
      this.token = this.isAuthenticated ? token || null : null;

      if (this.isAuthenticated && this.user && this.token) {
        const accountId = options.accountId || this.buildAccountId(this.user);
        this.activeAccountId = accountId;

        const entry = { id: accountId, user: this.user, token: this.token, timestamp: Date.now() };
        const index = this.accounts.findIndex((account) => account.id === accountId);
        if (index >= 0) {
          this.accounts[index] = entry;
        } else {
          this.accounts.push(entry);
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

      if (!options.silent) this.notifyAuthStatus();
    }

    /** Subscribe to auth changes. Fires immediately, returns an unsubscribe fn. */
    onAuthStatusChange(callback) {
      if (typeof callback !== 'function') return () => {};

      this.authStatusCallbacks.push(callback);
      callback(this.snapshot());

      return () => {
        const index = this.authStatusCallbacks.indexOf(callback);
        if (index >= 0) this.authStatusCallbacks.splice(index, 1);
      };
    }

    snapshot() {
      return {
        isAuthenticated: this.isAuthenticated,
        user: this.user,
        token: this.token,
        accounts: this.getAccounts(),
        activeAccountId: this.activeAccountId,
      };
    }

    notifyAuthStatus() {
      const snapshot = this.snapshot();
      this.authStatusCallbacks.forEach((callback) => {
        try {
          callback(snapshot);
        } catch (error) {
          logger.error('auth callback failed:', error);
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
      if (!accountId) throw new Error('Account ID is required to switch accounts.');

      const target = this.accounts.find((account) => account.id === accountId);
      if (!target) throw new Error('Selected account not found.');

      await this.updateAuthStatus(true, target.user, target.token, {
        accountId: target.id,
        keepAccounts: true,
      });

      return { id: target.id, user: target.user };
    }

    async openSignIn() {
      if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.create) {
        throw new Error('Cannot open sign-in page outside of Chrome extension context.');
      }
      await chrome.tabs.create({ url: `${this.websiteBaseUrl}/login`, active: true });
    }
  }

  const extensionAuth = new ExtensionAuth();
  T.ExtensionAuth = ExtensionAuth;
  T.extensionAuth = extensionAuth;

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    extensionAuth.init().catch((error) => logger.error('init failed:', error));
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = extensionAuth;
    module.exports.ExtensionAuth = ExtensionAuth;
  } else {
    window.extensionAuth = extensionAuth;
  }
})();
