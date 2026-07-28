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
            chrome.storage.sync.get(["gemini_api_key", "ai_provider", "gemini_model"], (data) => {
                this.apiKey = (data.gemini_api_key || "").trim() || null;
                this.aiProvider = (data.ai_provider || "g4f").toLowerCase();
                this.geminiModel = data.gemini_model || "gemini-3-flash-preview";
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
            const model = this.geminiModel || "gemini-3-flash-preview";
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
            const response = await fetch(url, {
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
        if (typeof DSAUtils !== "undefined") {
            DSAUtils.logError("AI", label, text);
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

    computeDiff(oldCode, newCode) {
        if (typeof oldCode !== "string") oldCode = "";
        if (typeof newCode !== "string") newCode = "";
        if (oldCode === newCode) return "(No changes)";

        const oldLines = oldCode ? oldCode.split(/\r?\n/) : [];
        const newLines = newCode ? newCode.split(/\r?\n/) : [];
        const m = oldLines.length;
        const n = newLines.length;

        // Fallback for extremely large files to prevent DP overhead
        if (m > 2000 || n > 2000) {
            return newCode;
        }

        // DP array to find LCS length
        const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (oldLines[i - 1] === newLines[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        // Backtrack to build the diff
        let i = m, j = n;
        const diffLines = [];
        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
                diffLines.push({ type: " ", line: oldLines[i - 1] });
                i--;
                j--;
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                diffLines.push({ type: "+", line: newLines[j - 1] });
                j--;
            } else {
                diffLines.push({ type: "-", line: oldLines[i - 1] });
                i--;
            }
        }
        diffLines.reverse();

        // Group changes into hunks with context
        const contextSize = 3;
        const hunks = [];
        let currentHunk = null;

        for (let idx = 0; idx < diffLines.length; idx++) {
            const item = diffLines[idx];
            if (item.type !== " ") {
                if (!currentHunk) {
                    currentHunk = {
                        startIdx: Math.max(0, idx - contextSize),
                        endIdx: idx
                    };
                    hunks.push(currentHunk);
                }
                currentHunk.endIdx = Math.min(diffLines.length - 1, idx + contextSize);
            } else {
                if (currentHunk && idx > currentHunk.endIdx) {
                    currentHunk = null;
                }
            }
        }

        // Merge overlapping hunks
        const mergedHunks = [];
        for (const hunk of hunks) {
            if (mergedHunks.length === 0) {
                mergedHunks.push(hunk);
            } else {
                const lastHunk = mergedHunks[mergedHunks.length - 1];
                if (hunk.startIdx <= lastHunk.endIdx) {
                    lastHunk.endIdx = Math.max(lastHunk.endIdx, hunk.endIdx);
                } else {
                    mergedHunks.push(hunk);
                }
            }
        }

        if (mergedHunks.length === 0) {
            return "(No changes)";
        }

        let result = "";
        for (const hunk of mergedHunks) {
            result += "@@ -... +... @@\n";
            for (let idx = hunk.startIdx; idx <= hunk.endIdx; idx++) {
                const item = diffLines[idx];
                result += `${item.type}${item.line}\n`;
            }
        }
        return result.trim();
    }

    buildAnalysisPrompt(attempts, problemInfo) {
        const { title, description } = problemInfo;

        let prompt = `Analyze the coding attempts for this problem and provide a brief mistake analysis in markdown format.

Problem: ${title}
${description ? `Description: ${description.substring(0, 500)}...` : ""}

Coding Attempts (chronological order):
Note: Attempt 1 contains the full initial code. Subsequent attempts are presented as diffs relative to their immediate previous attempt.
In the diffs, lines starting with '-' are deleted, lines starting with '+' are added, and lines starting with ' ' (space) are unchanged context lines.
`;

        attempts.forEach((attempt, index) => {
            if (index === 0) {
                prompt += `
### Attempt 1 (Initial Code)
\`\`\`${attempt.language}
${attempt.code}
\`\`\`
`;
            } else {
                const diff = this.computeDiff(attempts[index - 1].code, attempt.code);
                prompt += `
### Attempt ${index + 1} (Diff from Attempt ${index})
\`\`\`diff
${diff}
\`\`\`
`;
            }
        });

        prompt += `

IMPORTANT INSTRUCTION: Ignore typos, minor syntax slips, and silly formatting mistakes. Focus strictly on genuine algorithmic, logic, data structure, and conceptual errors, real problem-solving patterns, and relevant genuine data.

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
2. **Key Issues**: What specific errors occurred (ignoring typos or silly slips, focusing only on genuine algorithmic or logic issues). 
3. **Improvements**: As attempts progressed, what improved.
Keep under 100 words total. Focus only on technical programming concepts.`;

        return prompt;
    }
}

window.GeminiAPI = GeminiAPI;
