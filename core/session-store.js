// Traverse — Unified SessionStore for problem data persistence.
//
// Manages problem_data schema, key derivation ('problem_data_<slug>'),
// and storage interactions with chrome.storage.local.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});
  const logger = T.createLogger ? T.createLogger('SessionStore') : console;

  class SessionStore {
    constructor() {
      this.prefix = 'problem_data_';
    }

    getStorageKey(problemSlug) {
      if (!problemSlug) return null;
      return `${this.prefix}${problemSlug}`;
    }

    async getProblemData(problemSlug) {
      const key = this.getStorageKey(problemSlug);
      if (!key) return null;

      return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
          resolve(result[key] || null);
        });
      });
    }

    async setProblemData(problemSlug, data) {
      const key = this.getStorageKey(problemSlug);
      if (!key) return null;

      const existingData = (await this.getProblemData(problemSlug)) || {};
      const mergedData = {
        ...existingData,
        ...data,
        timestamp: new Date().toISOString(),
      };

      return new Promise((resolve, reject) => {
        chrome.storage.local.set({ [key]: mergedData }, () => {
          if (chrome.runtime.lastError) {
            logger.error('Failed to save problem data:', chrome.runtime.lastError);
            reject(chrome.runtime.lastError);
          } else {
            resolve(mergedData);
          }
        });
      });
    }

    async removeProblemData(problemSlug) {
      const key = this.getStorageKey(problemSlug);
      if (!key) return;

      return new Promise((resolve) => {
        chrome.storage.local.remove([key], () => {
          resolve();
        });
      });
    }
  }

  T.sessionStore = new SessionStore();
  T.SessionStore = SessionStore;
})();
