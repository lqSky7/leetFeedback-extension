// Traverse — backend client.
//
// Owns the `/api/submissions` payload contract: reads the stored problem record
// for a problem key, converts it to the backend's wire format, and POSTs it via
// the background service worker (content scripts cannot make the cross-origin
// call themselves).
//
// The stored record is the single input. If you change what the adapters persist
// in core/platform-adapter.js `storeProblemData`, check this file.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  // Topic label -> category id expected by the backend's ML model (0-14).
  const CATEGORY_MAP = {
    array: 0, arrays: 0, 'sliding window': 0, 'two pointers': 0, 'two pointer': 0, '2 pointer': 0, 'sliding window / 2 pointer': 0,
    string: 1, strings: 1, 'strings (advanced algo)': 1, 'strings(advanced algo)': 1,
    'linked list': 2, linkedlist: 2, 'linked-list': 2,
    tree: 3, trees: 3, 'binary tree': 3, 'binary trees': 3, 'binary search tree': 3, 'binary search trees': 3, bst: 3, trie: 3, tries: 3,
    graph: 4, graphs: 4,
    dp: 5, 'dynamic programming': 5,
    greedy: 6, 'greedy algorithms': 6, 'greedy algorithm': 6,
    backtracking: 7, recursion: 7,
    sorting: 8, sort: 8, 'sorting and searching': 8,
    searching: 9, search: 9, 'binary search': 9,
    stack: 10, 'monotonic stack': 10, 'stack / queues': 10, 'stacks / queues': 10, 'stack and queues': 10, 'stacks and queues': 10, 'stack & queues': 10, 'stacks & queues': 10,
    queue: 11,
    heap: 12, heaps: 12, 'priority queue': 12,
    'hash map': 13, hashmap: 13, 'hash table': 13, hashtable: 13, hashing: 13,
    math: 14, maths: 14, 'bit manipulation': 14, 'number theory': 14,
  };

  const DIFFICULTY_NAMES = { 0: 'easy', 1: 'medium', 2: 'hard' };
  const MAX_TIME_SECONDS = 2 * 60 * 60; // matches the ProblemTimer 2h cap

  /** First recognized topic -> category id, or null when nothing matches. */
  function mapTopicToCategory(topics) {
    if (!Array.isArray(topics) || topics.length === 0) return null;
    for (const topic of topics) {
      const mapped = CATEGORY_MAP[String(topic).toLowerCase().trim()];
      if (mapped !== undefined) return mapped;
    }
    return null;
  }

  class BackendAPI {
    constructor() {
      this.logger = T.createLogger ? T.createLogger('backend') : console;
      this.baseURL = T.config.backendBaseURL;
      this.authToken = null;
    }

    /**
     * Resolve the auth token from the direct session, falling back to the
     * active entry of the multi-account list. Returns true when a token exists.
     */
    async initialize() {
      const k = T.config.keys.auth;
      try {
        const data = await chrome.storage.local.get([k.token, k.accounts, k.activeAccountId]);

        if (data[k.token]) {
          this.authToken = data[k.token];
        } else if (Array.isArray(data[k.accounts]) && data[k.accounts].length > 0) {
          const active =
            data[k.accounts].find((a) => a.id === data[k.activeAccountId]) || data[k.accounts][0];
          this.authToken = active?.token || null;
        }

        if (!this.authToken) {
          this.logger.warn('no auth token in storage — user is not signed in');
          return false;
        }
        return true;
      } catch (error) {
        this.logger.error('initialize failed:', error);
        return false;
      }
    }

    /**
     * POST the payload through the background worker, which is the only context
     * allowed to make this cross-origin request.
     */
    async pushSubmissionData(problemData) {
      try {
        if (!(await this.initialize())) {
          return { success: false, error: 'No authentication token found. Please log in to the extension.' };
        }

        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              type: 'BACKEND_API_FETCH',
              url: `${this.baseURL}/api/submissions`,
              options: {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${this.authToken}`,
                },
                body: JSON.stringify(problemData),
              },
            },
            (reply) => {
              if (chrome.runtime.lastError) {
                const message = chrome.runtime.lastError.message || '';
                if (message.includes('Extension context invalidated')) {
                  reject(new Error('Extension was updated. Please refresh the page to submit again.'));
                } else {
                  reject(new Error(message));
                }
              } else if (!reply) {
                reject(new Error('No response from background script'));
              } else {
                resolve(reply);
              }
            }
          );
        });

        if (!response.success) {
          const status = response.status || 'unknown';
          const details = response.error || response.data || 'No details available';
          const printable = typeof details === 'object' ? JSON.stringify(details) : details;
          this.logger.error(`push failed (${status}):`, printable);
          return { success: false, error: `Backend API error: ${status} - ${printable}` };
        }

        this.logger.log('push succeeded:', response.status);
        return { success: true, data: response.data };
      } catch (error) {
        this.logger.error('pushSubmissionData failed:', error);
        return { success: false, error: error.message };
      }
    }

    /** Convert a stored problem record into the backend wire format. */
    async formatProblemDataForBackend(storedProblemData, assistanceLevel = null) {
      const {
        name,
        platform = 'leetcode',
        difficulty = 1,
        solved = { value: false, date: 0, tries: 0 },
        parent_topic = [],
        problem_link,
        attempts = [],
        runCounter = 0,
        shouldAnalyzeWithGemini = true,
        problemStartTime = null,
        language = null,
      } = storedProblemData;

      const geminiApiKey = await this._readGeminiApiKey();
      const geminiModel = T.aiConfig ? T.aiConfig.getGeminiModel() : null;

      // Language: the last recorded attempt wins, then the stored field.
      const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;
      const languageValue = lastAttempt?.language || language || 'python';

      const problemSlug = this._deriveSlug(problem_link, name);

      const formattedData = {
        problemSlug,
        platform: String(platform).toLowerCase(),
        problemTitle: name || 'Unknown Problem',
        difficulty: DIFFICULTY_NAMES[Number(difficulty)] || 'medium',
        language: languageValue,
        outcome: solved.value ? 'accepted' : 'failed',
        idempotencyKey: `${problemSlug}-${solved.date || Date.now()}`,
        happenedAt: solved.date ? new Date(solved.date).toISOString() : new Date().toISOString(),
        deviceId: 1,
        // AI analysis is on by default for every problem (see attempt-tracker.js).
        shouldAnalyzeWithAI: shouldAnalyzeWithGemini !== false,
        geminiApiKey,
        geminiModel,
        numberOfTries: Number(runCounter) || 1,
        timeTaken: this._timeTakenSeconds(storedProblemData, problemStartTime, solved),
        category: mapTopicToCategory(parent_topic),
        topic: parent_topic[0] || null,
        subtopic: parent_topic[1] || null,
        assistanceLevel,
        attempts: this._formatAttemptsWithDiffs(
          this._withFallbackAttempt(storedProblemData, attempts, languageValue, solved)
        ),
      };

      this.logger.log('formatted payload:', formattedData);
      return formattedData;
    }

    /** Read the stored problem record and push it. */
    async pushCurrentProblemData(problemKey, options = {}) {
      try {
        if (!problemKey) throw new Error('No current problem key provided');

        const storedData = await T.sessionStore.getProblemData(problemKey);
        if (!storedData) throw new Error(`No problem data found for: ${problemKey}`);

        const formattedData = await this.formatProblemDataForBackend(
          storedData,
          options.assistanceLevel ?? null
        );
        return await this.pushSubmissionData(formattedData);
      } catch (error) {
        const message = error.message || String(error);
        if (message.includes('Extension context invalidated')) {
          return { success: false, error: 'Extension was updated. Please refresh the page.' };
        }
        this.logger.error('pushCurrentProblemData failed:', error);
        return { success: false, error: message };
      }
    }

    /* ── internals ── */

    async _readGeminiApiKey() {
      try {
        if (!T.aiConfig) return null;
        await T.aiConfig.initialize();
        return T.aiConfig.getGeminiApiKey();
      } catch (error) {
        this.logger.warn('failed to read AI config:', error);
        return null;
      }
    }

    /** Slug from the problem URL, falling back to the title. */
    _deriveSlug(problemLink, name) {
      const fallback = String(name || 'unknown-problem').toLowerCase().replace(/\s+/g, '-');
      if (!problemLink) return fallback;
      const match = problemLink.match(/(?:problem-details|problems)\/([^\/\?]+)/);
      return match ? match[1] : fallback;
    }

    /** Active solving time in seconds: elapsed minus hidden-tab time, capped. */
    _timeTakenSeconds(storedProblemData, problemStartTime, solved) {
      if (!problemStartTime || !solved.date) return 0;

      const activeTime = solved.date - problemStartTime - (storedProblemData.pausedTime || 0);
      if (activeTime < 0) {
        this.logger.warn('negative active time, reporting 0');
        return 0;
      }

      const seconds = Math.floor(activeTime / 1000);
      if (seconds > MAX_TIME_SECONDS) {
        this.logger.warn(`time taken over cap, capping at ${MAX_TIME_SECONDS}s`);
        return MAX_TIME_SECONDS;
      }
      return seconds;
    }

    /** Solved-but-no-attempts records still need one attempt to send. */
    _withFallbackAttempt(storedProblemData, attempts, languageValue, solved) {
      const list = Array.isArray(attempts) ? [...attempts] : [];
      if (list.length === 0 && storedProblemData.code && storedProblemData.code.length > 10) {
        list.push({
          code: storedProblemData.code,
          language: languageValue,
          timestamp: solved.date ? new Date(solved.date).toISOString() : new Date().toISOString(),
          type: 'submit',
          successful: solved.value,
        });
      }
      return list;
    }

    /**
     * Send full code only for the first attempt; later attempts carry a compact
     * line diff instead, so a long struggle does not balloon the payload.
     */
    _formatAttemptsWithDiffs(attempts) {
      if (!Array.isArray(attempts) || attempts.length === 0) return [];

      const out = [];
      let previousCode = '';

      attempts.forEach((attempt, index) => {
        const currentCode = attempt.code || '';
        let code = currentCode;

        if (index > 0) {
          if (currentCode === previousCode) {
            code = `// Attempt #${index + 1}: Same code as Attempt #${index}`;
          } else if (currentCode && previousCode) {
            code = BackendAPI.diffSummary(previousCode, currentCode, index + 1);
          }
        }

        out.push({ ...attempt, code });
        previousCode = currentCode;
      });

      return out;
    }

    /** Line-by-line +/- summary between two attempts. */
    static diffSummary(oldCode, newCode, attemptNumber) {
      const oldLines = oldCode.split(/\r?\n/);
      const newLines = newCode.split(/\r?\n/);
      const changes = [];
      const maxLines = Math.max(oldLines.length, newLines.length);

      for (let i = 0; i < maxLines; i++) {
        const oldLine = oldLines[i];
        const newLine = newLines[i];
        if (oldLine === newLine) continue;

        const lineNum = i + 1;
        if (oldLine === undefined) {
          changes.push(`// Line ${lineNum} added: + ${newLine.trim()}`);
        } else if (newLine === undefined) {
          changes.push(`// Line ${lineNum} removed: - ${oldLine.trim()}`);
        } else {
          changes.push(`// Line ${lineNum}:\n// - ${oldLine.trim()}\n// + ${newLine.trim()}`);
        }
      }

      if (changes.length === 0) return `// Attempt #${attemptNumber}: No code changes`;
      return `// Attempt #${attemptNumber} changes:\n${changes.join('\n')}`;
    }
  }

  T.BackendAPI = BackendAPI;
})();
