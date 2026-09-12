// Traverse — AI provider configuration reader.
//
// Analysis itself runs server-side. The extension only forwards the user's
// provider choice and API key so the backend can run the analysis on their
// behalf; nothing here calls an AI provider directly.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  class AiConfig {
    constructor() {
      this.apiKey = null;
      this.provider = 'g4f';
      this.model = null;
    }

    async initialize() {
      const k = T.config.keys.gemini;
      const data = await chrome.storage.sync.get([k.apiKey, k.provider, k.model]);

      this.apiKey = String(data[k.apiKey] || '').trim() || null;
      this.provider = String(data[k.provider] || 'g4f').toLowerCase();
      this.model = data[k.model] || null;

      // Only two providers are supported; anything else falls back to the
      // keyless default rather than sending a key to the wrong backend.
      if (this.provider !== 'gemini' && this.provider !== 'g4f') {
        this.provider = 'g4f';
      }
      return true;
    }

    /** The user's Gemini key, or null when they are not on the Gemini provider. */
    getGeminiApiKey() {
      return this.provider === 'gemini' ? this.apiKey : null;
    }

    getGeminiModel() {
      return this.model;
    }
  }

  T.AiConfig = AiConfig;
  T.aiConfig = new AiConfig();
})();
