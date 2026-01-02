// GitHub API utility for DSA to GitHub extension

class GitHubAPI {
  constructor() {
    this.baseURL = 'https://api.github.com';
    this.config = null;
  }

  async initialize() {
    try {
      this.config = await DSAUtils.getStoredConfig();
      return DSAUtils.isConfigComplete(this.config);
    } catch (error) {
      console.error('[GitHub API] Error during initialization:', error);
      return false;
    }
  }

  async testConnection() {
    if (!this.config) {
      await this.initialize();
    }

    try {
      const response = await fetch(`${this.baseURL}/user`, {
        headers: {
          'Authorization': `token ${this.config.token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status}`);
      }

      const userData = await response.json();
      return { success: true, user: userData };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async checkRepository() {
    if (!this.config) {
      await this.initialize();
    }

    try {
      const response = await fetch(
        `${this.baseURL}/repos/${this.config.owner}/${this.config.repo}`,
        {
          headers: {
            'Authorization': `token ${this.config.token}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Repository not found or no access`);
      }

      const repoData = await response.json();
      return { success: true, repo: repoData };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getFileContent(filePath) {
    if (!this.config) {
      await this.initialize();
    }

    try {
      const response = await fetch(
        `${this.baseURL}/repos/${this.config.owner}/${this.config.repo}/contents/${filePath}`,
        {
          headers: {
            'Authorization': `token ${this.config.token}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        // UTF-8 safe decoding
        const content = decodeURIComponent(escape(atob(data.content)));
        return { exists: true, sha: data.sha, content: content };
      } else if (response.status === 404) {
        return { exists: false, sha: null, content: null };
      } else {
        throw new Error(`Failed to get file content: ${response.status}`);
      }
    } catch (error) {
      return { exists: false, sha: null, content: null, error: error.message };
    }
  }

  async createOrUpdateFile(filePath, content, commitMessage, sha = null) {
    if (!this.config) {
      await this.initialize();
    }

    try {
      // UTF-8 safe encoding with better error handling
      const encodedContent = this.encodeContentSafely(content);
      
      const payload = {
        message: commitMessage,
        content: encodedContent
      };

      if (sha) {
        payload.sha = sha;
      }

      const response = await fetch(
        `${this.baseURL}/repos/${this.config.owner}/${this.config.repo}/contents/${filePath}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `token ${this.config.token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`GitHub API error: ${response.status} - ${errorData.message}`);
      }

      return { success: true, data: await response.json() };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Unified push method that handles both solutions and mistake analysis
  async pushContent(problemInfo, platform, contentType = 'solution') {
    try {
      if (!this.config) {
        const initialized = await this.initialize();
        if (!initialized) {
          throw new Error('GitHub configuration is incomplete');
        }
      }

      const { title } = problemInfo;
      console.log(`[GitHub API] Pushing content for: ${title}`);

      // Create directory path and always use solution.md
      const dirPath = DSAUtils.createDirectoryPath(platform, problemInfo);
      const filePath = `${dirPath}/solution.md`;
      
      let content, commitMessage, analysisResult;

      if (contentType === 'solution') {
        // Successful solution - just the solution
        content = this.generateSolutionContent(problemInfo, platform);
        commitMessage = `Add solution for ${title}`;
        console.log(`[GitHub API] Creating successful solution`);
        
      } else if (contentType === 'mistake-analysis') {
        // Failed attempts - solution + mistake analysis
        const failedAttempts = problemInfo.attempts || [];
        
        if (failedAttempts.length < 3) {
          return { success: false, error: `Need at least 3 failed attempts for mistake analysis. Found: ${failedAttempts.length}` };
        }

        // Generate Gemini analysis from all attempts
        const geminiAPI = new GeminiAPI();
        const geminiConfigured = await geminiAPI.initialize();
        if (!geminiConfigured) {
          return { success: false, error: 'Gemini API key not configured' };
        }

        const analysisResult = await geminiAPI.analyzeMistakes(failedAttempts, problemInfo);
        if (!analysisResult.success) {
          return { success: false, error: 'Failed to generate mistake analysis: ' + analysisResult.error };
        }

        // Get the final (latest) solution from attempts
        const finalAttempt = failedAttempts[failedAttempts.length - 1];
        
        // Create combined content: final solution + mistake analysis
        content = this.generateSolutionWithMistakeAnalysis(problemInfo, platform, finalAttempt, analysisResult.analysis, failedAttempts);
        commitMessage = `Add solution with mistake analysis for ${title} (${failedAttempts.length} attempts analyzed)`;
        console.log(`[GitHub API] Creating solution with mistake analysis`);
      }

      // Check if solution.md already exists for updates
      let sha = null;
      const existingFile = await this.getFileContent(filePath);
      sha = existingFile.exists ? existingFile.sha : null;

      // Push to GitHub
      const result = await this.createOrUpdateFile(filePath, content, commitMessage, sha);

      if (result.success) {
        console.log(`[GitHub API] Content pushed successfully: ${filePath}`);
        // Return analysis with result so it can be stored for backend submission
        return { ...result, analysis: analysisResult.analysis };
      }

      return result;

    } catch (error) {
      console.error(`[GitHub API] Error pushing content:`, error);
      return { success: false, error: error.message };
    }
  }

  // Simplified public methods
  async pushSolution(problemInfo, platform) {
    try {
      return await this.pushContent(problemInfo, platform, 'solution');
    } catch (error) {
      console.error('[GitHub API] Error in pushSolution:', error);
      return { success: false, error: error.message };
    }
  }

  async pushMistakeAnalysis(problemInfo, platform) {
    try {
      return await this.pushContent(problemInfo, platform, 'mistake-analysis');
    } catch (error) {
      console.error('[GitHub API] Error in pushMistakeAnalysis:', error);
      return { success: false, error: error.message };
    }
  }

  generateSolutionContent(problemInfo, platform) {
    const { title, url, difficulty, code, language } = problemInfo;
    const timestamp = new Date().toISOString().split('T')[0]; // Just date, not full timestamp

    return `# ${title}

## Problem Information
- **Platform:** ${platform.charAt(0).toUpperCase() + platform.slice(1)}
- **Difficulty:** ${difficulty || 'Unknown'}
- **URL:** ${url || 'N/A'}
- **Date:** ${timestamp}

## Solution

\`\`\`${this.getLanguageForMarkdown(language)}
${code || '// Code not available'}
\`\`\`

---
*Generated automatically by LeetFeedback Extension*
`;
  }

  generateSolutionWithMistakeAnalysis(problemInfo, platform, finalAttempt, mistakeAnalysis, allAttempts) {
    const { title, url, difficulty } = problemInfo;
    const timestamp = new Date().toISOString().split('T')[0]; // Just date, not full timestamp

    return `# ${title}

## Problem Information
- **Platform:** ${platform.charAt(0).toUpperCase() + platform.slice(1)}
- **Difficulty:** ${difficulty || 'Unknown'}
- **URL:** ${url || 'N/A'}
- **Date:** ${timestamp}

## Solution

\`\`\`${this.getLanguageForMarkdown(finalAttempt.language)}
${finalAttempt.code || '// Code not available'}
\`\`\`

## AI Mistake Analysis

${mistakeAnalysis}

---
*Generated automatically by LeetFeedback Extension*
`;
  }

  getLanguageForMarkdown(language) {
    if (!language) return 'text';
    
    const languageMap = {
      'javascript': 'javascript',
      'python': 'python',
      'python3': 'python',
      'java': 'java',
      'cpp': 'cpp',
      'c++': 'cpp',
      'c': 'c',
      'csharp': 'csharp',
      'c#': 'csharp',
      'go': 'go',
      'kotlin': 'kotlin',
      'rust': 'rust',
      'typescript': 'typescript'
    };
    
    return languageMap[language.toLowerCase()] || 'text';
  }

  // UTF-8 safe encoding helper
  encodeContentSafely(content) {
    try {
      // First try the standard method
      return btoa(unescape(encodeURIComponent(content)));
    } catch (error) {
      console.warn('[GitHub API] Standard encoding failed, trying alternative method:', error);
      try {
        // Alternative method using TextEncoder
        const encoder = new TextEncoder();
        const uint8Array = encoder.encode(content);
        return btoa(String.fromCharCode(...uint8Array));
      } catch (fallbackError) {
        console.error('[GitHub API] All encoding methods failed:', fallbackError);
        // Last resort: remove problematic characters
        const cleanContent = content.replace(/[^\x00-\x7F]/g, "?");
        return btoa(cleanContent);
      }
    }
  }
}

// Make GitHubAPI available globally
window.GitHubAPI = GitHubAPI;