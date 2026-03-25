// Interceptor script for TakeUforward submission monitoring

(function () {
  'use strict';

  // Debug mode will be loaded from storage
  let DEBUG_MODE = false;
  
  // Load debug mode from storage
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get(['tuf_debug_mode'], (result) => {
      DEBUG_MODE = result.tuf_debug_mode || false;
      log('[TUF Interceptor] Debug mode loaded:', DEBUG_MODE);
    });
  }
  
  function log(...args) {
    if (DEBUG_MODE) console.log(...args);
  }
  
  function error(...args) {
    if (DEBUG_MODE) console.error(...args);
  }

  const XHR = XMLHttpRequest.prototype;
  const open = XHR.open;
  const send = XHR.send;

  XHR.open = function (method, url) {
    this.method = method;
    this.url = url;
    return open.apply(this, arguments);
  };

  XHR.send = function (body) {
    log('[TUF Interceptor] XHR send called for URL:', this.url, 'Method:', this.method);

    // Intercept submit request to capture code
    if (
      this.url.includes('backend-go.takeuforward.org/api/v1/plus/judge/submit') &&
      this.method.toLowerCase() === 'post'
    ) {
      log('[TUF Interceptor] Intercepting submit request...');
      log('[TUF Interceptor] Submit body:', body);
      try {
        const payload = JSON.parse(body);
        log('[TUF Interceptor] Submit payload:', payload);

        window.postMessage(
          {
            type: 'CODE_SUBMIT',
            payload: {
              language: payload.language,
              usercode: payload.usercode,
              problem_id: payload.problem_id,
            },
          },
          '*',
        );
      } catch (error) {
        error('[TUF Interceptor] Error parsing submit payload:', error);
      }
    } else if (
      this.url.includes('backend-go.takeuforward.org/api/v1/plus/judge/run') &&
      this.method.toLowerCase() === 'post'
    ) {
      log('[TUF Interceptor] Intercepting run request...');
      try {
        const payload = JSON.parse(body);
        window.postMessage(
          {
            type: 'CODE_RUN',
            payload: {
              problem_id: payload.problem_id,
              language: payload.language,
              usercode: payload.usercode,
            },
          },
          '*',
        );
      } catch (error) {
        error('[TUF Interceptor] Error parsing run payload:', error);
      }
    }

    // Add load event listener to capture responses
    this.addEventListener('load', function () {
      log('[TUF Interceptor] XHR load for URL:', this.url);
      try {
        if (
          this.url.includes('backend-go.takeuforward.org/api/v1/plus/judge/check-submit') &&
          this.method.toLowerCase() === 'get'
        ) {
          log('[TUF Interceptor] Intercepting submission check response...');
          const response = JSON.parse(this.responseText);
          log('[TUF Interceptor] Submission check response:', response);

          if (response.success && response.data) {
            const data = response.data;
            const submissionData = {
              success: data.status === 'Accepted',
              status: data.status,
              totalTestCases: data.total_test_cases,
              passedTestCases: data.passed_test_cases,
              averageTime: data.time + 's',
              averageMemory: data.memory,
            };
            log('[TUF Interceptor] Processed submission data:', submissionData);

            // Send data back to content script
            window.postMessage(
              {
                type: 'SUBMISSION_RESPONSE',
                payload: submissionData,
              },
              '*',
            );
          } else {
            log('[TUF Interceptor] Submission check not successful or no data');
          }
        }

        // Intercept run check response (check-run endpoint)
        if (
          this.url.includes('backend-go.takeuforward.org/api/v1/plus/judge/check-run') &&
          this.method.toLowerCase() === 'get'
        ) {
          log('[TUF Interceptor] Intercepting run check response...');
          const response = JSON.parse(this.responseText);
          log('[TUF Interceptor] Run check response:', response);

          if (response.success && response.data) {
            const data = response.data;
            const runData = {
              success: data.status === 'Accepted',
              status: data.status,
              totalTestCases: data.total_test_cases,
              passedTestCases: data.passed_test_cases,
            };
            log('[TUF Interceptor] Processed run data:', runData);

            window.postMessage(
              {
                type: 'RUN_RESPONSE',
                payload: runData,
              },
              '*',
            );
          }
        }
      } catch (error) {
        error('[TUF Interceptor] Error in interceptor:', error);
      }
    });

    return send.apply(this, arguments);
  };

  log('[TUF Interceptor] TakeUforward submission interceptor loaded');
})();