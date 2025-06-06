// Gemini API utility for mistake analysis

class GeminiAPI {
    constructor() {
        this.baseURL =
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
        this.apiKey = null;
    }

    async initialize() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(["gemini_api_key"], (data) => {
                this.apiKey = data.gemini_api_key || null;
                resolve(!!this.apiKey);
            });
        });
    }

    async analyzeMistakes(attempts, problemInfo) {
        if (!this.apiKey) {
            const initialized = await this.initialize();
            if (!initialized) {
                return {
                    success: false,
                    error: "Gemini API key not configured",
                };
            }
        }

        if (!attempts || attempts.length === 0) {
            return { success: false, error: "No attempts to analyze" };
        }

        try {
            const prompt = this.buildAnalysisPrompt(attempts, problemInfo);

            const response = await fetch(`${this.baseURL}?key=${this.apiKey}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                {
                                    text: prompt,
                                },
                            ],
                        },
                    ],
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error(
                    `[Gemini API] Error ${response.status}:`,
                    errorText,
                );
                throw new Error(
                    `Gemini API responded with ${response.status}: ${errorText}`,
                );
            }

            const data = await response.json();

            if (
                data.candidates &&
                data.candidates[0] &&
                data.candidates[0].content
            ) {
                const analysis = data.candidates[0].content.parts[0].text;
                return { success: true, analysis };
            } else {
                throw new Error("Invalid response format from Gemini API");
            }
        } catch (error) {
            return { success: false, error: error.message };
        }
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
Your answer should directly start from the Mistakes tags
Please provide a concise analysis focusing on:
1. **Tag Mistakes**: What Category errors belong to
2. **Learning Points**: What the errors are and why
3. **Improvement**: How the solution evolved

Keep the analysis under 100 words and format as markdown. Focus only on code logic, algorithms, and programming concepts. Do not include personal commentary.`;

        return prompt;
    }
}

// Make GeminiAPI available globally
window.GeminiAPI = GeminiAPI;
