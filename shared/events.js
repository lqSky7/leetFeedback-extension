// Traverse — Typed event definitions for messaging.
//
// Defines constant types and helper builders for page-world <-> content <-> background communication.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  T.events = {
    // LeetCode page-world events
    LEETCODE_CODE_SUBMIT: 'LEETCODE_CODE_SUBMIT',
    LEETCODE_CODE_RUN: 'LEETCODE_CODE_RUN',
    LEETCODE_SUBMIT_ID: 'LEETCODE_SUBMIT_ID',
    LEETCODE_RUN_ID: 'LEETCODE_RUN_ID',
    LEETCODE_CHECK_RESPONSE: 'LEETCODE_CHECK_RESPONSE',

    // TakeUforward page-world events
    TUF_CODE_SUBMIT: 'CODE_SUBMIT',
    TUF_CODE_RUN: 'CODE_RUN',
    TUF_SUBMISSION_RESPONSE: 'SUBMISSION_RESPONSE',
    TUF_RUN_RESPONSE: 'RUN_RESPONSE',

    // Monaco bridge
    BRIDGE_READY: 'LEETFEEDBACK_BRIDGE_READY',
    BRIDGE_CODE: 'LEETFEEDBACK_CODE',

    // Runtime / background messaging
    CONTENT_SCRIPT_READY: 'CONTENT_SCRIPT_READY',
    BACKEND_API_FETCH: 'BACKEND_API_FETCH',
    TEST_GITHUB_CONNECTION: 'testGitHubConnection',
    INITIALIZE_CONFIG: 'initializeConfig',

    // External auth sync
    AUTH_SYNC: 'AUTH_SYNC',
    AUTH_LOGOUT: 'AUTH_LOGOUT',
  };
})();
