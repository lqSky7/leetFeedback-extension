// AI configuration reader — analysis logic has moved server-side

class GeminiAPI {
    constructor() {
        this.apiKey = null;
        this.aiProvider = 'g4f';
        this.geminiModel = null;
    }

    async initialize() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['gemini_api_key', 'ai_provider', 'gemini_model'], (data) => {
                this.apiKey = (data.gemini_api_key || '').trim() || null;
                this.aiProvider = (data.ai_provider || 'g4f').toLowerCase();
                this.geminiModel = data.gemini_model || null;
                if (this.aiProvider !== 'gemini' && this.aiProvider !== 'g4f') {
                    this.aiProvider = 'g4f';
                }
                resolve(true);
            });
        });
    }

    /** Returns the user's Gemini API key if they have chosen the Gemini provider */
    getGeminiApiKey() {
        return this.aiProvider === 'gemini' ? this.apiKey : null;
    }

    /** Returns the configured Gemini model name */
    getGeminiModel() {
        return this.geminiModel;
    }
}

window.GeminiAPI = GeminiAPI;
