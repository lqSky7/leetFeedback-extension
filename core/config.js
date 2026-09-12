// Traverse — single source of truth for configuration.
//
// Loaded in every context (content scripts via manifest js arrays, background
// via importScripts, sidepanel via <script>). Must stay dependency-free and
// environment-agnostic (globalThis, no DOM, no chrome API calls at load time).

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  T.config = {
    // Backend the extension pushes submissions to. Kept from the pre-refactor
    // code; change here (and only here) to point at a different backend.
    backendBaseURL: 'https://neatness-enlarged-curled.ngrok-free.dev',

    // Website that syncs auth into the extension.
    websiteBaseURL: 'https://traverses.tech',

    // GitHub REST API.
    githubApiBaseURL: 'https://api.github.com',

    // Origins allowed to message the background service worker
    // (externally_connectable auth sync). Must stay in sync with the
    // "externally_connectable" matches in manifest.json.
    allowedExternalOrigins: [
      'https://traverses.tech',
      'https://leet-feedback.vercel.app',
      'http://localhost:5173',
      'http://localhost:3000',
    ],

    // Storage keys. These are part of the data contract with the backend and
    // existing user data — do not rename without a migration.
    keys: {
      debugMode: 'debug_mode',
      auth: {
        token: 'auth_token',
        user: 'auth_user',
        timestamp: 'auth_timestamp',
        accounts: 'auth_accounts',
        activeAccountId: 'auth_active_account_id',
      },
      github: {
        token: 'github_token',
        owner: 'github_owner',
        repo: 'github_repo',
        branch: 'github_branch',
        pushEnabled: 'github_push_enabled',
      },
      gemini: {
        apiKey: 'gemini_api_key',
        provider: 'ai_provider',
        model: 'gemini_model',
      },
      timerOverlayEnabled: 'timer_overlay_enabled',
      timerOverlayPosition: 'timer_overlay_position',
      hintPrompt: {
        enabled: 'hint_prompt_enabled',
        defaultOption: 'hint_prompt_default_option',
        duration: 'hint_prompt_duration',
      },
      browserSessionRestarted: 'browser_session_restarted',
      sessionStartTime: 'session_start_time',
    },

    // Number of failed runs/submissions after which the next accepted solve is
    // flagged for server-side AI analysis. Unified across platforms (the
    // pre-refactor code used 2 in most paths and 3 in a few).
    failedRunsBeforeAnalysis: 2,

    // Per-platform switch for the DOM capture path, read by
    // PlatformAdapter.captureFromDom(). `true` (or absent) keeps the site's
    // button-click + page-polling capture active as a safety net; `false` makes
    // the network interceptor authoritative and retires the DOM path without
    // deleting it. Flip a platform to false only after its intercept rules are
    // verified against a real submit — see platforms/index.md.
    domVerdictFallback: {
      geeksforgeeks: true,
      codechef: true,
      naukri: true,
    },
  };
})();
