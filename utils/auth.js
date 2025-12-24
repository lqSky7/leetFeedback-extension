'use strict';

class ExtensionAuth {
  constructor(options = {}) {
    this.apiBaseUrl = options.baseUrl || this.getApiBaseUrl();
    this.user = null;
    this.token = null;
    this.isAuthenticated = false;
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
        'auth_user',
        'auth_token',
        'auth_timestamp',
        'firebase_user',
      ]);

      const hasNewSession = Boolean(data.auth_user && data.auth_token);
      if (hasNewSession) {
        await this.updateAuthStatus(true, data.auth_user, data.auth_token, {
          persist: false,
          silent: true,
        });
        return;
      }

      const hasLegacySession = Boolean(data.firebase_user);
      if (hasLegacySession) {
        await this.updateAuthStatus(true, data.firebase_user, data.auth_token || null, {
          persist: false,
          silent: true,
        });
        return;
      }

      await this.updateAuthStatus(false, null, null, {
        persist: false,
        silent: true,
      });
    } catch (error) {
      console.error('[ExtensionAuth] Error syncing auth state:', error);
      await this.updateAuthStatus(false, null, null, {
        persist: false,
        silent: true,
      });
    }
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
      console.error('[ExtensionAuth] Network error:', networkError);
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
      console.warn('[ExtensionAuth] Login succeeded but token missing from response.');
    }

    await this.updateAuthStatus(true, user, token || null);

    return { token: token || null, user, data };
  }

  async register(payload = {}) {
    const body = {
      username: payload.username?.trim(),
      email: payload.email?.trim(),
      password: payload.password,
      github_username: payload.github_username?.trim(),
      github_repo: payload.github_repo?.trim(),
      github_branch: (payload.github_branch || 'main').trim(),
    };

    if (!body.username || !body.email || !body.password) {
      throw new Error('All required fields must be provided.');
    }

    const data = await this.request('/api/auth/register', {
      method: 'POST',
      body,
    });

    const token = ExtensionAuth.pickToken(data);
    const user =
      ExtensionAuth.pickUser(data, {
        username: body.username,
        email: body.email,
        github_username: body.github_username,
        github_repo: body.github_repo,
        github_branch: body.github_branch,
      }) || {
        username: body.username,
        email: body.email,
        github_username: body.github_username,
        github_repo: body.github_repo,
        github_branch: body.github_branch,
      };

    if (token) {
      await this.updateAuthStatus(true, user, token || null);
    } else {
      await this.updateAuthStatus(false, null, null);
    }

    return { token: token || null, user, data };
  }

  async signOut() {
    await this.updateAuthStatus(false, null, null);
  }

  async requestAuthStatus() {
    await this.syncFromStorage();
    this.notifyAuthStatus();
  }

  async storeSession(user, token) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

    const payload = {
      auth_timestamp: Date.now(),
    };

    if (user) {
      payload.auth_user = user;
      payload.firebase_user = user;
    }

    if (token) {
      payload.auth_token = token;
    }

    await chrome.storage.local.set(payload);
  }

  async clearSession() {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

    await chrome.storage.local.remove([
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

    if (options.persist !== false) {
      if (this.isAuthenticated && this.user) {
        await this.storeSession(this.user, this.token);
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
    };

    this.authStatusCallbacks.forEach((callback) => {
      try {
        callback(snapshot);
      } catch (error) {
        console.error('[ExtensionAuth] Auth callback failed:', error);
      }
    });
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
      console.error('[ExtensionAuth] Failed to open sign-in page:', error);
      throw error;
    }
  }
}

const extensionAuth = new ExtensionAuth();

if (typeof chrome !== 'undefined' && chrome.storage?.local) {
  extensionAuth
    .init()
    .catch((error) =>
      console.error('[ExtensionAuth] Failed to initialize auth:', error),
    );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = extensionAuth;
  module.exports.ExtensionAuth = ExtensionAuth;
} else {
  window.extensionAuth = extensionAuth;
}