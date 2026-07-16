// Interceptor script for TakeUforward and LeetCode submission monitoring

(function () {
  'use strict';

  // Debug mode will be loaded from storage
  let DEBUG_MODE = false;
  
  // Load debug mode from storage
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get(['tuf_debug_mode', 'leetcode_debug_mode'], (result) => {
      DEBUG_MODE = result.tuf_debug_mode || result.leetcode_debug_mode || false;
      log('[Interceptor] Debug mode loaded:', DEBUG_MODE);
    });
  }
  
  function log(...args) {
    if (DEBUG_MODE) console.log(...args);
  }
  
  function error(...args) {
    if (DEBUG_MODE) console.error(...args);
  }

  // --- Fetch Interceptor (primarily for LeetCode) ---
  if (window.fetch) {
    const originalFetch = window.fetch;
    window.fetch = async function (resource, config) {
      let url = '';
      if (typeof resource === 'string') {
        url = resource;
      } else if (resource && typeof resource === 'object' && resource.url) {
        url = resource.url;
      }
      
      const method = (config && config.method) ? config.method.toUpperCase() : 'GET';
      const isLeetCode = url.includes('leetcode.com') || window.location.hostname.includes('leetcode.com');
      
      let isLeetCodeSubmit = false;
      let isLeetCodeRun = false;
      
      if (isLeetCode) {
        if (url.includes('/submit/') && method === 'POST') {
          isLeetCodeSubmit = true;
        } else if (url.includes('/interpret_solution/') && method === 'POST') {
          isLeetCodeRun = true;
        }
      }
      
      if (isLeetCodeSubmit || isLeetCodeRun) {
        try {
          const bodyText = config && config.body;
          if (bodyText) {
            const payload = JSON.parse(bodyText);
            log('[Interceptor] Captured LeetCode code request:', url, payload);
            window.postMessage({
              type: isLeetCodeSubmit ? 'LEETCODE_CODE_SUBMIT' : 'LEETCODE_CODE_RUN',
              payload: {
                language: payload.lang,
                usercode: payload.typed_code,
                question_id: payload.question_id
              }
            }, '*');
          }
        } catch (e) {
          error('[Interceptor] Error parsing LeetCode payload:', e);
        }
      }
      
      // Execute original fetch
      const response = await originalFetch.apply(this, arguments);
      
      if (isLeetCode) {
        try {
          const clonedResponse = response.clone();
          
          if (isLeetCodeSubmit) {
            clonedResponse.json().then(data => {
              log('[Interceptor] Captured LeetCode submit response:', data);
              if (data && data.submission_id) {
                window.postMessage({
                  type: 'LEETCODE_SUBMIT_ID',
                  payload: { submission_id: data.submission_id }
                }, '*');
              }
            }).catch(e => error('[Interceptor] Error parsing LeetCode submit response:', e));
          } else if (isLeetCodeRun) {
            clonedResponse.json().then(data => {
              log('[Interceptor] Captured LeetCode run response:', data);
              if (data && data.interpret_id) {
                window.postMessage({
                  type: 'LEETCODE_RUN_ID',
                  payload: { interpret_id: data.interpret_id }
                }, '*');
              }
            }).catch(e => error('[Interceptor] Error parsing LeetCode run response:', e));
          } else if (url.includes('/check/')) {
            const match = url.match(/\/detail\/([^\/]+)\/(?:v2\/)?check\/?/);
            const checkId = match ? match[1] : null;
            
            if (checkId) {
              clonedResponse.json().then(data => {
                log('[Interceptor] Captured LeetCode check response for ID:', checkId, data);
                if (data && data.state === 'SUCCESS') {
                  window.postMessage({
                    type: 'LEETCODE_CHECK_RESPONSE',
                    payload: {
                      id: checkId,
                      data: data
                    }
                  }, '*');
                }
              }).catch(e => error('[Interceptor] Error parsing LeetCode check response:', e));
            }
          }
        } catch (e) {
          error('[Interceptor] Error in LeetCode response clone/parse:', e);
        }
      }
      
      return response;
    };
  }

  // --- XMLHttpRequest Interceptor (TakeUforward & LeetCode fallback) ---
  const XHR = XMLHttpRequest.prototype;
  const open = XHR.open;
  const send = XHR.send;

  XHR.open = function (method, url) {
    this.method = method;
    this.url = url;
    return open.apply(this, arguments);
  };

  XHR.send = function (body) {
    log('[Interceptor] XHR send called for URL:', this.url, 'Method:', this.method);

    const url = this.url || '';
    const method = (this.method || '').toUpperCase();
    const isLeetCode = url.includes('leetcode.com') || window.location.hostname.includes('leetcode.com');

    // LeetCode XHR Interception
    if (isLeetCode) {
      if (url.includes('/submit/') && method === 'POST') {
        try {
          const payload = JSON.parse(body);
          window.postMessage({
            type: 'LEETCODE_CODE_SUBMIT',
            payload: {
              language: payload.lang,
              usercode: payload.typed_code,
              question_id: payload.question_id
            }
          }, '*');
        } catch (e) {
          error('[Interceptor] Error parsing LeetCode submit payload (XHR):', e);
        }
      } else if (url.includes('/interpret_solution/') && method === 'POST') {
        try {
          const payload = JSON.parse(body);
          window.postMessage({
            type: 'LEETCODE_CODE_RUN',
            payload: {
              language: payload.lang,
              usercode: payload.typed_code,
              question_id: payload.question_id
            }
          }, '*');
        } catch (e) {
          error('[Interceptor] Error parsing LeetCode run payload (XHR):', e);
        }
      }
    }

    // TakeUforward XHR Interception: Intercept submit request to capture code
    if (
      url.includes('backend-go.takeuforward.org/api/v1/plus/judge/submit') &&
      method === 'POST'
    ) {
      log('[Interceptor] Intercepting TUF submit request...');
      try {
        const payload = JSON.parse(body);
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
      } catch (errorDetails) {
        error('[Interceptor] Error parsing TUF submit payload:', errorDetails);
      }
    } else if (
      url.includes('backend-go.takeuforward.org/api/v1/plus/judge/run') &&
      method === 'POST'
    ) {
      log('[Interceptor] Intercepting TUF run request...');
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
      } catch (errorDetails) {
        error('[Interceptor] Error parsing TUF run payload:', errorDetails);
      }
    }

    // Add load event listener to capture responses
    this.addEventListener('load', function () {
      log('[Interceptor] XHR load for URL:', url);
      try {
        // LeetCode responses via XHR
        if (isLeetCode) {
          const response = JSON.parse(this.responseText);
          if (url.includes('/submit/') && method === 'POST') {
            if (response && response.submission_id) {
              window.postMessage({
                type: 'LEETCODE_SUBMIT_ID',
                payload: { submission_id: response.submission_id }
              }, '*');
            }
          } else if (url.includes('/interpret_solution/') && method === 'POST') {
            if (response && response.interpret_id) {
              window.postMessage({
                type: 'LEETCODE_RUN_ID',
                payload: { interpret_id: response.interpret_id }
              }, '*');
            }
          } else if (url.includes('/check/')) {
            const match = url.match(/\/detail\/([^\/]+)\/(?:v2\/)?check\/?/);
            const checkId = match ? match[1] : null;
            if (checkId && response && response.state === 'SUCCESS') {
              window.postMessage({
                type: 'LEETCODE_CHECK_RESPONSE',
                payload: {
                  id: checkId,
                  data: response
                }
              }, '*');
            }
          }
        }

        // TakeUforward responses via XHR
        if (
          url.includes('backend-go.takeuforward.org/api/v1/plus/judge/check-submit') &&
          method === 'GET'
        ) {
          log('[Interceptor] Intercepting TUF submission check response...');
          const response = JSON.parse(this.responseText);

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
            window.postMessage(
              {
                type: 'SUBMISSION_RESPONSE',
                payload: submissionData,
              },
              '*',
            );
          }
        }

        if (
          url.includes('backend-go.takeuforward.org/api/v1/plus/judge/check-run') &&
          method === 'GET'
        ) {
          log('[Interceptor] Intercepting TUF run check response...');
          const response = JSON.parse(this.responseText);

          if (response.success && response.data) {
            const data = response.data;
            const runData = {
              success: data.status === 'Accepted',
              status: data.status,
              totalTestCases: data.total_test_cases,
              passedTestCases: data.passed_test_cases,
            };
            window.postMessage(
              {
                type: 'RUN_RESPONSE',
                payload: runData,
              },
              '*',
            );
          }
        }
      } catch (err) {
        error('[Interceptor] Error processing XHR response:', err);
      }
    });

    return send.apply(this, arguments);
  };

  log('[Interceptor] Submission/Run network interceptor fully loaded');
})();