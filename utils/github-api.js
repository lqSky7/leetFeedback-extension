// GitHub API utility for DSA to GitHub extension

class GitHubAPI {
  constructor() {
    this.baseURL = 'https://api.github.com';
    this.config = null;
  }

  async initialize() {
    this.config = await DSAUtils.getStoredConfig();
    return DSAUtils.isConfigComplete(this.config);
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
        throw new Error(`GitHub API responded with ${response.status}`);
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
        return { exists: true, sha: data.sha, content: atob(data.content) };
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
      const payload = {
        message: commitMessage,
        content: btoa(unescape(encodeURIComponent(content))),
        branch: this.config.branch
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
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`GitHub API error: ${response.status} - ${errorData.message || 'Unknown error'}`);
      }

      const result = await response.json();
      return { success: true, sha: result.content.sha, url: result.content.html_url };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async pushSolution(problemInfo, platform) {
    try {
      if (!this.config) {
        const initialized = await this.initialize();
        if (!initialized) {
          throw new Error('GitHub configuration is incomplete');
        }
      }

      const { title, code, language, description, difficulty, number, stats, attempts } = problemInfo;

      // Create directory path
      const dirPath = DSAUtils.createDirectoryPath(platform, problemInfo);

      // Generate commit message
      const commitMessage = DSAUtils.generateCommitMessage(platform, problemInfo);

      // Use single solution.md file for all platforms
      const solutionFilePath = `${dirPath}/solution.md`;

      // Analyze mistakes if attempts exist and Gemini API is configured
      let mistakeAnalysis = '';
      if (attempts && attempts.length > 0) {
        DSAUtils.logDebug(platform, `Found ${attempts.length} attempts for analysis:`, attempts.map(a => ({
          language: a.language,
          codeLength: a.code?.length || 0,
          timestamp: a.timestamp
        })));

        const geminiAPI = new GeminiAPI();
        const geminiConfigured = await geminiAPI.initialize();

        if (geminiConfigured) {
          DSAUtils.logDebug(platform, `Analyzing ${attempts.length} attempts with Gemini`);
          const analysisResult = await geminiAPI.analyzeMistakes(attempts, problemInfo);

          if (analysisResult.success) {
            mistakeAnalysis = analysisResult.analysis;
            DSAUtils.logDebug(platform, 'Mistake analysis generated successfully');
            
            // Extract and store mistake tags
            const tags = this.extractMistakeTags(analysisResult.analysis);
            if (tags.length > 0) {
              await this.storeMistakeTags(platform, problemInfo.title, tags);
              DSAUtils.logDebug(platform, 'Stored mistake tags:', tags);
            }
          } else {
            DSAUtils.logError(platform, 'Failed to analyze mistakes:', analysisResult.error);
          }
        } else {
          DSAUtils.logDebug(platform, 'Gemini API not configured, skipping mistake analysis');
        }
      } else {
        DSAUtils.logDebug(platform, 'No attempts found for mistake analysis');
      }

      // Create comprehensive solution content with mistake analysis
      const solutionContent = this.generateComprehensiveSolutionContent(problemInfo, platform, mistakeAnalysis);

      // Check if file exists
      const solutionFileInfo = await this.getFileContent(solutionFilePath);

      // Push solution file
      const result = await this.createOrUpdateFile(
        solutionFilePath,
        solutionContent,
        commitMessage,
        solutionFileInfo.sha
      );

      if (!result.success) {
        throw new Error(`Failed to push solution: ${result.error}`);
      }

      // Update statistics
      await DSAUtils.updateStats(platform);

      return {
        success: true,
        url: result.url,
        message: `Successfully pushed ${title} to GitHub!`
      };

    } catch (error) {
      DSAUtils.logError(platform, 'Failed to push solution', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  generateComprehensiveSolutionContent(problemInfo, platform, mistakeAnalysis = '') {
    const { title, description, number, language, code, url } = problemInfo;

    this.logDebug('Generating content for platform:', platform);
    this.logDebug('Problem info:', {
      title,
      number,
      language,
      descriptionLength: description?.length || 0,
      codeLength: code?.length || 0,
      url
    });

    let content = '';

    // Add problem number if available
    if (number) {
      content += `# ${number}. ${title}\n\n`;
    } else {
      content += `# ${title}\n\n`;
    }

    // Add problem URL
    if (url) {
      content += `**Link:** ${url}\n\n`;
    }

    // Add problem description/statement
    if (description) {
      content += `${description}\n\n`;
    }

    // Add solution code
    if (code) {
      this.logDebug('Adding code block with language:', this.getLanguageForCodeBlock(language));
      this.logDebug('Code preview:', code.substring(0, 200));
      this.logDebug('Code has newlines:', code.includes('\n'));
      content += `\`\`\`${this.getLanguageForCodeBlock(language)}\n`;
      content += code;
      content += `\n\`\`\`\n`;
    } else {
      this.logDebug('No code provided');
    }

    // Add mistake analysis if available
    if (mistakeAnalysis) {
      content += `\n## Mistake Analysis\n\n${mistakeAnalysis}\n`;
    }

    this.logDebug('Final content length:', content.length);
    this.logDebug('Final content preview:', content.substring(0, 500));

    return content;
  }

  getLanguageForCodeBlock(language) {
    const languageMap = {
      'C++': 'cpp',
      'cpp': 'cpp',
      'C': 'c',
      'Java': 'java',
      'java': 'java',
      'Python': 'python',
      'Python3': 'python',
      'python': 'python',
      'python3': 'python',
      'JavaScript': 'javascript',
      'Javascript': 'javascript',
      'javascript': 'javascript',
      'TypeScript': 'typescript',
      'typescript': 'typescript',
      'C#': 'csharp',
      'Go': 'go',
      'Rust': 'rust',
      'Kotlin': 'kotlin',
      'Swift': 'swift',
      'Ruby': 'ruby',
      'PHP': 'php',
      'Scala': 'scala'
    };

    return languageMap[language] || language.toLowerCase();
  }

  extractMistakeTags(analysis) {
    // Extract tags from "TAGS: tag1, tag2, tag3" format
    const tagMatch = analysis.match(/TAGS:\s*([^\n]+)/i);
    if (tagMatch) {
      return tagMatch[1]
        .split(',')
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);
    }
    return [];
  }

  async storeMistakeTags(platform, problemTitle, tags) {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['mistake_tags'], (data) => {
        const mistakeTags = data.mistake_tags || {};
        
        // Initialize platform if not exists
        if (!mistakeTags[platform]) {
          mistakeTags[platform] = {};
        }
        
        // Store tags for this problem
        mistakeTags[platform][problemTitle] = {
          tags: tags,
          timestamp: new Date().toISOString()
        };
        
        // Update global tag counts
        if (!mistakeTags.tagCounts) {
          mistakeTags.tagCounts = {};
        }
        
        tags.forEach(tag => {
          mistakeTags.tagCounts[tag] = (mistakeTags.tagCounts[tag] || 0) + 1;
        });
        
        chrome.storage.sync.set({ mistake_tags: mistakeTags }, () => {
          resolve();
        });
      });
    });
  }

  async logDebug(message, data = null) {
    const debugMode = await this.getDebugMode();
    if (debugMode) {
      console.log(`[GitHub API Debug] ${message}`, data || '');
    }
  }

  async getDebugMode() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['debug_mode'], (data) => {
        resolve(data.debug_mode || false);
      });
    });
  }








}

// Make GitHubAPI available globally
window.GitHubAPI = GitHubAPI;
