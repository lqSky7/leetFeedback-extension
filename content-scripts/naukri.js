// Naukri Code360 content script for Traverse extension
// Extends PlatformAdapter — preserves working button click & verdict checking logic.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});
  const PLATFORM = typeof DSA_PLATFORMS !== 'undefined' ? DSA_PLATFORMS.NAUKRI : 'naukri';
  const PlatformAdapter = T.PlatformAdapter || class {};

  const LANGUAGE_MAP = {
    'C++': 'cpp',
    'cpp': 'cpp',
    'C': 'c',
    'Java': 'java',
    'Python': 'py',
    'Python3': 'py',
    'python': 'py',
    'JavaScript': 'js',
    'Javascript': 'js',
    'TypeScript': 'ts',
  };

  class NaukriAdapter extends PlatformAdapter {
    constructor() {
      super(PLATFORM, 'Naukri');
      this.topics = [];
    }

    async initialize() {
      try {
        this.setupEventListeners();

        const slug = this.getCurrentProblemSlug();
        await this.loadState(slug);

        if (this.isProblemPage()) {
          this.startTimer(slug);
          setTimeout(() => this.extractMetadata(), 1500);
        }

        this.logger.log('Naukri Code360 adapter initialized');
      } catch (err) {
        this.logger.error('Failed to initialize Naukri adapter:', err);
      }
    }

    isProblemPage() {
      const url = window.location.href;
      return (
        url.includes('naukri.com/code360') &&
        (url.includes('/problem-details/') || url.includes('/problems/'))
      );
    }

    getCurrentProblemSlug() {
      const url = window.location.href;
      const match = url.match(/(?:problem-details|problems)\/([^\/\?#]+)/);
      return match ? match[1] : window.location.pathname.split('/').pop() || 'unknown';
    }

    setupEventListeners() {
      this.observeUrlChanges(async () => {
        const slug = this.getCurrentProblemSlug();
        if (this.isProblemPage()) {
          this.resetTimer();
          this.startTimer(slug);
          await this.loadState(slug);
          setTimeout(() => this.extractMetadata(), 1500);
        } else {
          this.hideTimer();
        }
      });

      this.observeRunButton();
      this.monitorSubmissions();
    }

    observeRunButton() {
      const attachRunListener = () => {
        const runBtns = Array.from(document.querySelectorAll('button')).filter((btn) => {
          const txt = btn.textContent.toLowerCase();
          return (txt.includes('run') || txt.includes('test')) && !txt.includes('submit');
        });

        for (const btn of runBtns) {
          if (!btn.hasAttribute('data-traverse-run-listener')) {
            btn.setAttribute('data-traverse-run-listener', 'true');
            btn.addEventListener('click', () => {
              setTimeout(async () => {
                const code = this.getCurrentCode();
                const lang = this.getCurrentLanguage();
                await this.handleRunAttempt(code, lang);
                this.observeRunResult();
              }, 800);
            });
          }
        }
      };

      attachRunListener();
      setInterval(attachRunListener, 3000);
    }

    async observeRunResult() {
      let checks = 0;
      const interval = setInterval(async () => {
        checks++;
        const pageText = document.body.innerText.toLowerCase();

        if (pageText.includes('all test cases passed') || pageText.includes('sample test cases passed') || pageText.includes('accepted')) {
          clearInterval(interval);
          await this.handleRunResult(true);
        } else if (pageText.includes('wrong answer') || pageText.includes('compilation error') || pageText.includes('time limit exceeded') || pageText.includes('runtime error') || pageText.includes('failed')) {
          clearInterval(interval);
          await this.handleRunResult(false);
        } else if (checks > 20) {
          clearInterval(interval);
        }
      }, 1000);
    }

    monitorSubmissions() {
      const attachSubmitListener = () => {
        const submitBtns = Array.from(document.querySelectorAll('button')).filter((btn) =>
          btn.textContent.toLowerCase().includes('submit')
        );

        for (const btn of submitBtns) {
          if (!btn.hasAttribute('data-traverse-submit-listener')) {
            btn.setAttribute('data-traverse-submit-listener', 'true');
            btn.addEventListener('click', async () => {
              const code = this.getCurrentCode();
              const lang = this.getCurrentLanguage();
              await this.handleSubmissionAttempt(code, lang);

              let checks = 0;
              const interval = setInterval(async () => {
                checks++;
                const pageText = document.body.innerText.toLowerCase();

                if (pageText.includes('all test cases passed') || pageText.includes('accepted') || pageText.includes('correct answer')) {
                  clearInterval(interval);
                  await this.handleSubmissionResult(true, { status: 'Accepted' });
                } else if (pageText.includes('wrong answer') || pageText.includes('compilation error') || pageText.includes('time limit exceeded') || pageText.includes('runtime error')) {
                  clearInterval(interval);
                  await this.handleSubmissionResult(false, { status: 'Wrong Answer' });
                } else if (checks > 30) {
                  clearInterval(interval);
                  await this.handleSubmissionResult(false, { status: 'Timeout' });
                }
              }, 1000);
            });
          }
        }
      };

      attachSubmitListener();
      setInterval(attachSubmitListener, 3000);
    }

    getCurrentCode() {
      if (window.monaco?.editor) {
        const models = window.monaco.editor.getModels();
        if (models && models.length > 0) {
          return this.sanitizeText(models[0].getValue());
        }
      }
      const viewLines = document.querySelectorAll('.view-line');
      if (viewLines.length > 0) {
        return Array.from(viewLines).map((l) => l.textContent).join('\n');
      }
      const ta = document.querySelector('.monaco-editor textarea, textarea.inputarea, textarea');
      return ta?.value ? this.sanitizeText(ta.value) : '';
    }

    async extractCode() {
      return this.getCurrentCode();
    }

    getCurrentLanguage() {
      const el = document.querySelector('[class*="language"], [class*="Language"], select, button[class*="select"]');
      const txt = el ? el.textContent.trim() : 'cpp';
      return LANGUAGE_MAP[txt] || 'cpp';
    }

    extractTitle() {
      const titleEl = document.querySelector('h1, .problem-title, [class*="problem-title"], [class*="ProblemTitle"], [class*="title"]');
      if (titleEl && titleEl.textContent.trim()) {
        return titleEl.textContent.trim();
      }
      return document.title.replace(/[-|].*Code360.*/i, '').replace(/Coding Ninjas.*/i, '').trim();
    }

    extractDifficulty() {
      const el = document.querySelector('[class*="difficulty"], [class*="Difficulty"], .badge');
      return el?.textContent?.trim() || 'Easy';
    }

    extractTopics() {
      const els = document.querySelectorAll('[class*="topic"], [class*="tag"], [class*="category"]');
      const topics = Array.from(els).map((e) => e.textContent.trim()).filter(Boolean);
      return topics.length > 0 ? topics : ['General'];
    }

    async extractMetadata() {
      const title = this.extractTitle();
      const problemInfo = {
        title,
        difficulty: this.normalizeDifficulty(this.extractDifficulty()),
        topics: this.extractTopics(),
        code: this.getCurrentCode(),
        language: this.getCurrentLanguage(),
        url: window.location.href.split('?')[0],
      };

      this.currentProblem = problemInfo;
      await this.storeProblemData(problemInfo, false, 0);
      return problemInfo;
    }
  }

  // Initialize singleton
  let instance = null;
  function start() {
    if (!instance) {
      instance = new NaukriAdapter();
      instance.initialize();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
