// Traverse — shared pure utilities (no chrome.* or DOM calls).
//
// Formatters and helpers used by the GitHub client, the submission pipeline,
// and platform adapters. Kept dependency-free so it loads in any context.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  const LANGUAGE_EXTENSIONS = {
    'c++': '.cpp',
    cpp: '.cpp',
    c: '.c',
    java: '.java',
    python: '.py',
    python3: '.py',
    go: '.go',
    javascript: '.js',
    javascripts: '.js',
    typescript: '.ts',
    'c#': '.cs',
    csharp: '.cs',
  };

  const util = {
    sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    },

    /** Map an editor language name to a file extension ('.txt' fallback). */
    getFileExtension(language) {
      return LANGUAGE_EXTENSIONS[String(language || '').toLowerCase()] || '.txt';
    },

    sanitizeFileName(filename) {
      return String(filename || '')
        .replace(/[^a-zA-Z0-9\-_\s]/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase();
    },

    formatProblemName(name) {
      return String(name || '')
        .replace(/^\d+\.\s*/, '')
        .trim()
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase();
    },

    /**
     * Difficulty label -> numeric level used by the backend
     * (0 = easy, 1 = medium, 2 = hard).
     *
     * Idempotent: an already-normalized 0/1/2 passes through unchanged, so
     * adapters and storeProblemData can both call it without double-mapping.
     * `defaultLevel` preserves per-platform fallbacks (takeuforward
     * historically defaults to medium).
     */
    normalizeDifficulty(difficulty, defaultLevel = 0) {
      if (difficulty === null || difficulty === undefined || difficulty === '') return defaultLevel;
      if (typeof difficulty === 'number') {
        return difficulty >= 0 && difficulty <= 2 ? difficulty : defaultLevel;
      }
      const diff = String(difficulty).toLowerCase();
      if (diff.includes('school') || diff.includes('basic') || diff.includes('easy')) return 0;
      if (diff.includes('medium') || diff.includes('moderate')) return 1;
      if (diff.includes('hard') || diff.includes('ninja')) return 2;
      return defaultLevel;
    },

    /** GitHub commit message: "<clean title> - <Platform> [difficulty]". */
    generateCommitMessage(platform, problemInfo) {
      const { title, difficulty } = problemInfo;

      let cleanTitle = String(title || '')
        .replace(/^\d+\.\s*/, '')
        .replace(/\[(LEETCODE|GEEKSFORGEEKS|GFG|TAKEUFORWARD)\]/i, '')
        .replace(/\s*\((Easy|Medium|Hard|School|Basic)\)\s*/i, '')
        .replace(/\[.*?\]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const platformName = platform.charAt(0).toUpperCase() + platform.slice(1);
      let message = `${cleanTitle} - ${platformName}`;
      if (difficulty) message += ` [${difficulty}]`;
      return message;
    },

    /** GitHub directory: <platform>/<difficulty>/<category>/<number-title>. */
    createDirectoryPath(platform, problemInfo) {
      const { difficulty, category, number, title } = problemInfo;
      let path = platform;

      if (difficulty) path += `/${String(difficulty).toLowerCase()}`;
      if (category) path += `/${util.sanitizeFileName(category)}`;

      if (number && title) {
        path += `/${number}-${util.formatProblemName(title)}`;
      } else if (title) {
        path += `/${util.formatProblemName(title)}`;
      }
      return path;
    },

    /** Read the user's GitHub configuration from chrome.storage.sync. */
    async getGithubConfig() {
      const k = T.config.keys.github;
      const data = await chrome.storage.sync.get([k.token, k.owner, k.repo, k.branch]);
      return {
        token: data[k.token] || '',
        owner: data[k.owner] || '',
        repo: data[k.repo] || '',
        branch: data[k.branch] || 'main',
      };
    },

    isGithubConfigComplete(config) {
      return Boolean(config && config.token && config.owner && config.repo);
    },

    /** Sanitize editor text: NBSP, zero-width chars, CRLF. */
    sanitizeCode(text) {
      if (!text) return '';
      return String(text)
        .replace(/\u00A0/g, ' ')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\r\n/g, '\n');
    },
  };

  T.util = util;
})();
