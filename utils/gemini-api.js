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
                    temperature: 0.2,
                    messages: [
                        { role: "system", content: "You are an expert DSA coding mentor. Output valid JSON matching the requested schema." },
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
            return {
                success: true,
                analysis: parsed.summary,
                tags: parsed.tags,
                cognitiveTier: parsed.cognitiveTier,
                recallScore: parsed.recallScore,
            };
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
                    generationConfig: {
                        temperature: 0.2,
                        responseMimeType: "application/json",
                    },
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
                return {
                    success: true,
                    analysis: parsed.summary,
                    tags: parsed.tags,
                    cognitiveTier: parsed.cognitiveTier,
                    recallScore: parsed.recallScore,
                };
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
        let text = rawAnalysis.trim();
        // Strip markdown code fences if present
        if (text.startsWith("```")) {
            text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
        }

        try {
            const parsed = JSON.parse(text);
            const cognitiveTier = typeof parsed.cognitiveTier === "number" && parsed.cognitiveTier >= 1 && parsed.cognitiveTier <= 4
                ? parsed.cognitiveTier
                : null;
            const recallScore = typeof parsed.recallScore === "number" && !isNaN(parsed.recallScore)
                ? Math.max(0, Math.min(1, parsed.recallScore))
                : null;
            const tags = Array.isArray(parsed.mistakeTags)
                ? parsed.mistakeTags.map((t) => String(t).trim()).filter((t) => t.length > 0)
                : Array.isArray(parsed.tags)
                ? parsed.tags.map((t) => String(t).trim()).filter((t) => t.length > 0)
                : [];
            const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : text;

            return { tags, summary, cognitiveTier, recallScore };
        } catch {
            // Fallback: Regex extraction for JSON-like fragments or legacy TAGS format
            let cognitiveTier = null;
            let recallScore = null;
            let tags = [];
            let summary = text;

            const tierMatch = text.match(/"cognitiveTier"\s*:\s*([1-4])/i);
            if (tierMatch) cognitiveTier = parseInt(tierMatch[1], 10);

            const scoreMatch = text.match(/"recallScore"\s*:\s*([0-9]*\.?[0-9]+)/i);
            if (scoreMatch) recallScore = Math.max(0, Math.min(1, parseFloat(scoreMatch[1])));

            const tagsMatch = text.match(/TAGS:\s*(.+)$/m) || text.match(/"mistakeTags"\s*:\s*\[(.*?)\]/s);
            if (tagsMatch) {
                tags = tagsMatch[1]
                    .replace(/["\[\]]/g, "")
                    .split(",")
                    .map((t) => t.trim())
                    .filter((t) => t.length > 0);
            }

            const cleanSummary = text
                .replace(/^TAGS:\s*.+$/m, "")
                .replace(/```json[\s\S]*?```/gi, "")
                .trim();
            if (cleanSummary) summary = cleanSummary;

            return { tags, summary, cognitiveTier, recallScore };
        }
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

        let prompt = `You are an expert DSA coding mentor and cognitive learning evaluator for Traverse (a spaced-repetition DSA mastery platform).

The user is practicing coding problems. Your analysis directly feeds our spaced-repetition scheduling algorithm (FSRS-5).
The final revision schedule is calculated by blending two independent signals:
- 60% Behavioral Performance Score: derived from solve time vs personal baseline, number of test runs, difficulty, and spacing gap.
- 40% AI Cognitive Recall Score: your evaluation of how well the user remembered and executed the conceptual solution, judged from their chronological code attempts & diffs.

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
### Evaluation Guidelines:
Assess the user's recall quality across the chronological attempts and classify into one of 4 Cognitive Tiers:

1. **Tier 1 (Surface Slip | recallScore: 0.95 - 1.00):**
   - User clearly knew the algorithm and data structure from the start.
   - Code structure remained structurally identical. Changes were only syntax, indexing bounds, variable typos, or 1-line minor adjustments.
   - Minimal memory penalty.

2. **Tier 2 (Edge/Boundary Blindspot | recallScore: 0.80 - 0.94):**
   - Core algorithmic approach was recalled correctly.
   - User missed corner cases (e.g., empty input, single element, negative numbers, integer overflow, duplicate values, 0-division).
   - Light memory dampening.

3. **Tier 3 (Invariant/Logic Failure | recallScore: 0.50 - 0.79):**
   - User knew the general algorithm family (e.g., Dynamic Programming, Monotonic Stack, Two Pointers), but got the core invariant, recurrence relation, or state transition wrong and had to rewrite significant logic blocks.
   - Moderate memory penalty.

4. **Tier 4 (Paradigm Collapse / Wrong Approach | recallScore: 0.00 - 0.49):**
   - Total failure of initial approach (e.g., started with Brute Force Recursion -> TLE -> had to pivot to DP, or chose wrong paradigm entirely).
   - Near-total memory lapse; scheduled for immediate re-practice.

### Required JSON Output Format:
You MUST respond with valid JSON adhering to this exact schema (no markdown fences outside JSON):
{
  "cognitiveTier": 1 | 2 | 3 | 4,
  "recallScore": 0.85,
  "mistakeTags": ["specific-kebab-case-tag1", "specific-kebab-case-tag2"],
  "summary": "Markdown text containing:\n1. **Time-Travel Debugging**: The most clicking moment/code snippet that instantly reminds the user of the core insight/solution.\n2. **Key Issues**: What specific logic/algorithmic errors occurred (ignoring typos).\n3. **Improvements**: What changed to achieve the accepted solve."
}

Note:
- For "mistakeTags", provide 1-3 highly descriptive kebab-case tags explaining the specific error (e.g. "binary-search-boundary", "monotonic-stack-pop", "dp-state-transition", "null-pointer", "integer-overflow", "unvisited-cycle").
- Keep the total summary concise (under 120 words), focused strictly on technical programming concepts.`;

        return prompt;
    }
}

window.GeminiAPI = GeminiAPI;
