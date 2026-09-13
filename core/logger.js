// Traverse — Unified tag-based logger.
//
// Replaces the 6 disparate logging implementations across background,
// content scripts, utils, and sidepanel. Reads a single 'debug_mode' storage key.
// Environment-agnostic (works in background, content scripts, sidepanel, and page scripts).

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  let _debugMode = false;

  // Initialize debug mode from storage if available
  if (typeof chrome !== 'undefined' && chrome.storage) {
    const storageArea = chrome.storage.sync || chrome.storage.local;
    if (storageArea && storageArea.get) {
      storageArea.get(['debug_mode'], (data) => {
        if (data && typeof data.debug_mode === 'boolean') {
          _debugMode = data.debug_mode;
        }
      });
    }

    if (chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if ((area === 'sync' || area === 'local') && changes.debug_mode) {
          _debugMode = Boolean(changes.debug_mode.newValue);
        }
      });
    }
  }

  function isDebugMode() {
    return _debugMode;
  }

  function setDebugMode(val) {
    _debugMode = Boolean(val);
  }

  function formatPrefix(tag) {
    const ts = new Date().toISOString().substring(11, 23);
    return tag ? `[Traverse][${tag}][${ts}]` : `[Traverse][${ts}]`;
  }

  function log(tag, ...args) {
    if (_debugMode) {
      console.log(formatPrefix(tag), ...args);
    }
  }

  function error(tag, ...args) {
    if (_debugMode) {
      console.error(formatPrefix(tag), ...args);
    }
  }

  function warn(tag, ...args) {
    if (_debugMode) {
      console.warn(formatPrefix(tag), ...args);
    }
  }

  function createLogger(tag) {
    return {
      log: (...args) => log(tag, ...args),
      error: (...args) => error(tag, ...args),
      warn: (...args) => warn(tag, ...args),
      isDebugMode,
    };
  }

  T.logger = {
    log,
    error,
    warn,
    isDebugMode,
    setDebugMode,
    createLogger,
  };

  T.createLogger = createLogger;

  // Backwards compatibility with legacy debugLog / debugError / debugWarn / isDebugMode globals
  if (typeof window !== 'undefined') {
    window.debugLog = (...args) => log('', ...args);
    window.debugError = (...args) => error('', ...args);
    window.debugWarn = (...args) => warn('', ...args);
    window.isDebugMode = isDebugMode;
  }
})();
