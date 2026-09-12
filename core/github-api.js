// Traverse — GitHub client (optional solution mirroring).
//
// Pushes a `solution.md` per solved problem into the user's configured repo.
// Opt-in: the submission pipeline only calls this when the user enabled
// GitHub push in settings.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  const LANGUAGE_MAP = {
    javascript: 'javascript',
    python: 'python',
    python3: 'python',
    java: 'java',
    cpp: 'cpp',
    'c++': 'cpp',
    c: 'c',
    csharp: 'csharp',
    'c#': 'csharp',
    go: 'go',
    kotlin: 'kotlin',
    rust: 'rust',
    typescript: 'typescript',
  };

  class GitHubAPI {
    constructor() {
      this.logger = T.createLogger ? T.createLogger('github') : console;
      this.baseURL = T.config.githubApiBaseURL;
      this.config = null;
    }

    async initialize() {
      try {
        this.config = await T.util.getGithubConfig();
        return T.util.isGithubConfigComplete(this.config);
      } catch (error) {
        this.logger.error('initialize failed:', error);
        return false;
      }
    }

    /** Re-read config when it is missing or incomplete. Returns true when usable. */
    async _ensureConfig() {
      if (!T.util.isGithubConfigComplete(this.config)) {
        await this.initialize();
      }
      return T.util.isGithubConfigComplete(this.config);
    }

    _headers(extra = {}) {
      return {
        Authorization: `token ${this.config.token}`,
        Accept: 'application/vnd.github.v3+json',
        ...extra,
      };
    }

    /** Existing file at `filePath`, or { exists: false }. */
    async getFileContent(filePath) {
      if (!(await this._ensureConfig())) {
        return { exists: false, sha: null, content: null, error: 'GitHub configuration is incomplete' };
      }

      try {
        const response = await fetch(
          `${this.baseURL}/repos/${this.config.owner}/${this.config.repo}/contents/${filePath}`,
          { headers: this._headers() }
        );

        if (response.status === 404) return { exists: false, sha: null, content: null };
        if (!response.ok) throw new Error(`Failed to get file content: ${response.status}`);

        const data = await response.json();
        return { exists: true, sha: data.sha, content: decodeURIComponent(escape(atob(data.content))) };
      } catch (error) {
        return { exists: false, sha: null, content: null, error: error.message };
      }
    }

    async createOrUpdateFile(filePath, content, commitMessage, sha = null) {
      if (!(await this._ensureConfig())) {
        return { success: false, error: 'GitHub configuration is incomplete' };
      }

      try {
        const payload = { message: commitMessage, content: GitHubAPI.encodeContent(content) };
        if (sha) payload.sha = sha;

        const response = await fetch(
          `${this.baseURL}/repos/${this.config.owner}/${this.config.repo}/contents/${filePath}`,
          {
            method: 'PUT',
            headers: this._headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(payload),
          }
        );

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(`GitHub API error: ${response.status} - ${errorData.message || 'unknown'}`);
        }

        return { success: true, data: await response.json() };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }

    /** Push `<platform>/<difficulty>/<category>/<problem>/solution.md`. */
    async pushSolution(problemInfo, platform) {
      try {
        if (!(await this._ensureConfig())) {
          return { success: false, error: 'GitHub configuration is incomplete' };
        }

        const filePath = `${T.util.createDirectoryPath(platform, problemInfo)}/solution.md`;
        const existing = await this.getFileContent(filePath);

        const result = await this.createOrUpdateFile(
          filePath,
          this.generateSolutionContent(problemInfo, platform),
          `Add solution for ${problemInfo.title}`,
          existing.exists ? existing.sha : null
        );

        if (result.success) this.logger.log(`pushed ${filePath}`);
        return result;
      } catch (error) {
        this.logger.error('pushSolution failed:', error);
        return { success: false, error: error.message };
      }
    }

    generateSolutionContent(problemInfo, platform) {
      const { title, url, difficulty, code, language } = problemInfo;
      const date = new Date().toISOString().split('T')[0];

      return `# ${title}

## Problem Information
- **Platform:** ${platform.charAt(0).toUpperCase() + platform.slice(1)}
- **Difficulty:** ${difficulty || 'Unknown'}
- **URL:** ${url || 'N/A'}
- **Date:** ${date}

## Solution

\`\`\`${GitHubAPI.languageForMarkdown(language)}
${code || '// Code not available'}
\`\`\`

---
*Generated automatically by LeetFeedback Extension*
`;
    }

    static languageForMarkdown(language) {
      if (!language) return 'text';
      return LANGUAGE_MAP[String(language).toLowerCase()] || 'text';
    }

    /**
     * Base64 the content for the GitHub contents API. Chunked so large files
     * cannot blow the argument limit of String.fromCharCode, and UTF-8 safe.
     */
    static encodeContent(content) {
      const bytes = new TextEncoder().encode(content);
      const CHUNK = 0x8000;
      let binary = '';
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      return btoa(binary);
    }
  }

  T.GitHubAPI = GitHubAPI;
})();
