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

    // Platform reconnaissance.
    //
    // On any platform that does NOT already have a verified network adapter,
    // a capture-all recorder arms itself on problem pages, records every
    // request/response (headers, bodies, timing, initiator stack) plus the
    // run/submit button selectors and editor shape, and uploads the bundle so
    // the judge API can be reverse-engineered into a real adapter.
    //
    // Nothing here runs on LeetCode or TakeUforward: their network capture is
    // already verified, and a recorder on top of it is pure noise.
    recon: {
      // Platforms with verified network interception — recon must never run.
      excludedHosts: ['leetcode.com', 'takeuforward.org'],

      // Never record on Traverse's own surfaces, or the recorder would capture
      // its own upload traffic and the website's auth handshake.
      excludedHostsExtra: [
        'traverses.tech',
        'leet-feedback.vercel.app',
        'localhost',
        'netlify.app',
        'g4f.space',
        'generativelanguage.googleapis.com',
        'api.github.com',
      ],

      // hostname suffix -> platform id. Longest suffix wins (see
      // resolvePlatformId in core/recon-controller.js).
      platforms: {
        'geeksforgeeks.org': 'geeksforgeeks',
        'codechef.com': 'codechef',
        'naukri.com': 'naukri',
        'hackerrank.com': 'hackerrank',
        'codeforces.com': 'codeforces',
        'codingninjas.com': 'codingninjas',
        'hackerearth.com': 'hackerearth',
        'atcoder.jp': 'atcoder',
        'interviewbit.com': 'interviewbit',
        'spoj.com': 'spoj',
        'topcoder.com': 'topcoder',
        'kattis.com': 'kattis',
        'cses.fi': 'cses',
        'codewars.com': 'codewars',
        'neetcode.io': 'neetcode',
        'exercism.org': 'exercism',
        'lintcode.com': 'lintcode',
        'edabit.com': 'edabit',
      },

      // Only arm on URLs that look like a problem/editor page. Without this the
      // recorder would capture a job board's entire browsing session, which is
      // both useless and a privacy problem.
      problemUrlPatterns: [
        '/problems/',
        '/problem/',
        '/challenges/',
        '/challenge/',
        '/practice/',
        '/code/',
        '/ide/',
        '/playground/',
        '/exercises/',
        '/kata/',
        '/tasks/',
        '/submit/',
      ],

      // Capture budget. A four-flow session on a heavy SPA produces thousands
      // of requests; these caps keep the bundle (and chrome.storage) bounded.
      maxEvents: 2500,
      maxBodyChars: 120000,
      maxBundleChars: 12000000,

      // Idle time after the last captured event before an auto-upload fires.
      //
      // Two values, because the wait exists to let the *next* attempt land, and
      // what we are waiting for depends on what we already have. Once a pass and
      // a fail are both captured, the pair is enough to diff the two responses
      // and name the verdict field, so a short wait suffices. With only passes
      // (or only fails) we hold a little longer in case the user is about to
      // submit a failing attempt — but we do not wait for it indefinitely: a
      // capture with one flow is still worth delivering.
      idleMs: 20000,
      idleMsNoPair: 60000,

      // Upload automatically once something has been captured. Off means the
      // capture is staged and only sent when Send now is pressed.
      autoUpload: true,

      // Shared secret for POST /api/recon/ingest, baked in so that recording
      // needs zero setup: a user who never opens the sidepanel still
      // contributes captures.
      //
      // This is a *client* credential, not a per-user secret. Its only job is
      // to stop someone who guesses the URL from mailing the operator or
      // filling the server's disk. It must match RECON_INGEST_TOKEN on the
      // backend; the two are changed together.
      //
      // The sidepanel's Ingest Token field overrides this value, so the token
      // can be rotated for one machine without shipping a new build. An empty
      // string here plus an empty field means recording is off.
      defaultToken: 'c0b104a316f7da704977783483803d6c0c63e522e40d09a0f8ecaae2f7ee7b6a',

      // Storage keys.
      keys: {
        enabled: 'recon_enabled',
        token: 'recon_ingest_token',
        status: 'recon_status',
        bundle: 'recon_bundle',
        flowLabels: 'recon_flow_labels',
      },
    },
  };
})();
