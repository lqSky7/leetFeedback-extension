// AI analysis for mistake analysis: default G4F (free), optional Gemini when API key is set

const G4F_BASE_URL = "https://g4f.space/api/pollinations";
const G4F_CHAT_URL = `${G4F_BASE_URL}/v1/chat/completions`;
const G4F_DEFAULT_MODEL = "openai-large";

class GeminiAPI {
    constructor() {
        this.geminiBaseURL =
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent";
        this.apiKey = null;
        this.aiProvider = "g4f"; // "g4f" | "gemini"
    }

    async initialize() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(["gemini_api_key", "ai_provider"], (data) => {
                this.apiKey = (data.gemini_api_key || "").trim() || null;
                this.aiProvider = (data.ai_provider || "g4f").toLowerCase();
                if (this.aiProvider !== "gemini" && this.aiProvider !== "g4f") {
                    this.aiProvider = "g4f";
                }
                // Configured if: using G4F (no key needed) or using Gemini with key
                const configured = this.aiProvider === "g4f" || !!this.apiKey;
                resolve(configured);
            });
        });
    }

    async analyzeMistakes(attempts, problemInfo) {
        const initialized = await this.initialize();
        if (!initialized) {
            return {
                success: false,
                error: "AI not configured: use G4F (default) or set Gemini API key and choose Gemini.",
            };
        }

        if (!attempts || attempts.length === 0) {
            return { success: false, error: "No attempts to analyze" };
        }

        const prompt = this.buildAnalysisPrompt(attempts, problemInfo);

        if (this.aiProvider === "gemini" && this.apiKey) {
            return this.analyzeWithGemini(prompt);
        }
        return this.analyzeWithG4F(prompt);
    }

    async analyzeWithG4F(prompt) {
        try {
            const response = await fetch(G4F_CHAT_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: G4F_DEFAULT_MODEL,
                    temperature: 0.3,
                    messages: [
                        { role: "system", content: "You are a coding mentor. Reply with TAGS: then a brief analysis." },
                        { role: "user", content: prompt },
                    ],
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                this._logError("[G4F] Error " + response.status, errorText);
                throw new Error(`G4F responded with ${response.status}: ${errorText.slice(0, 200)}`);
            }

            const data = await response.json();
            const rawAnalysis =
                data.choices?.[0]?.message?.content ||
                data.choices?.[0]?.text ||
                "";

            if (!rawAnalysis.trim()) {
                throw new Error("Empty response from G4F");
            }

            const parsed = this.parseAnalysisResponse(rawAnalysis);
            return { success: true, analysis: parsed.summary, tags: parsed.tags };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async analyzeWithGemini(prompt) {
        if (!this.apiKey) {
            return { success: false, error: "Gemini API key not configured" };
        }
        try {
            const response = await fetch(`${this.geminiBaseURL}?key=${this.apiKey}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                this._logError("[Gemini API] Error " + response.status, errorText);
                throw new Error(`Gemini API responded with ${response.status}: ${errorText.slice(0, 200)}`);
            }

            const data = await response.json();
            if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
                const rawAnalysis = data.candidates[0].content.parts[0].text;
                const parsed = this.parseAnalysisResponse(rawAnalysis);
                return { success: true, analysis: parsed.summary, tags: parsed.tags };
            }
            throw new Error("Invalid response format from Gemini API");
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    _logError(label, text) {
        if (typeof debugError === "function") {
            debugError(label, text);
        } else if (typeof window !== "undefined" && typeof window.isDebugMode === "function" && window.isDebugMode()) {
            console.error(label, text);
        }
    }

    parseAnalysisResponse(rawAnalysis) {
        const tagsMatch = rawAnalysis.match(/^TAGS:\s*(.+)$/m);
        const tags = tagsMatch
            ? tagsMatch[1].split(",").map((t) => t.trim()).filter((t) => t.length > 0)
            : [];

        const summary = rawAnalysis.replace(/^TAGS:\s*.+$/m, "").trim();

        return { tags, summary };
    }

    buildAnalysisPrompt(attempts, problemInfo) {
        const { title, description } = problemInfo;

        let prompt = `Analyze the coding attempts for this problem and provide a brief mistake analysis in markdown format.

Problem: ${title}
${description ? `Description: ${description.substring(0, 500)}...` : ""}

Coding Attempts (chronological order):
`;

        attempts.forEach((attempt, index) => {
            prompt += `
### Attempt ${index + 1}
\`\`\`${attempt.language}
${attempt.code}
\`\`\`
`;
        });

        prompt += `

CRITICAL: You MUST start your response with exactly this format:
TAGS: tag1, tag2, tag3

Use ONLY these specific tag categories (pick 1-3 most relevant):
- Logic Error
- Syntax Error  
- Algorithm Choice
- Edge Cases
- Data Structure
- Time Complexity
- Space Complexity
- Input Handling
- Loop Logic
- Conditional Logic
- Array Bounds
- Null Pointer
- Off By One

Then provide brief analysis:
1. **Time-Travel Debugging**: From all of them attempts choose the most clicking moments/code snippets, which even when user sees even after a long time, they should remember how he solved this problem.
2. **Key Issues**: What specific errors occurred. 
3. **Improvements**: As attemps progressed, what improved.
Keep under 100 words total. Focus only on technical programming concepts.`;

        return prompt;
    }
}

window.GeminiAPI = GeminiAPI;
