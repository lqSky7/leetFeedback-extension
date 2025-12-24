// Interceptor script for TakeUforward submission monitoring

(function() {
  'use strict';

  const XHR = XMLHttpRequest.prototype;
  const open = XHR.open;
  const send = XHR.send;

  XHR.open = function (method, url) {
    this.method = method;
    this.url = url;
    return open.apply(this, arguments);
  };

  XHR.send = function (body) {
    console.log('[TUF Interceptor] XHR send called for URL:', this.url, 'Method:', this.method);
    
    // Intercept submit request to capture code
    if (
      this.url.includes('backend-go.takeuforward.org/api/v1/plus/judge/submit') &&
      this.method.toLowerCase() === 'post'
    ) {
      console.log('[TUF Interceptor] Intercepting submit request...');
      console.log('[TUF Interceptor] Submit body:', body);
      try {
        const payload = JSON.parse(body);
        console.log('[TUF Interceptor] Submit payload:', payload);
        
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
        console.error('[TUF Interceptor] Error parsing submit payload:', error);
      }
    } else if (
      this.url.includes('backend-go.takeuforward.org/api/v1/plus/judge/run') &&
      this.method.toLowerCase() === 'post'
    ) {
      console.log('[TUF Interceptor] Intercepting run request...');
      try {
        const payload = JSON.parse(body);
        window.postMessage(
          {
            type: 'CODE_RUN',
            payload: {
              problem_id: payload.problem_id,
            },
          },
          '*',
        );
      } catch (error) {
        console.error('[TUF Interceptor] Error parsing run payload:', error);
      }
    }
    
    // Add load event listener to capture responses
    this.addEventListener('load', function () {
      console.log('[TUF Interceptor] XHR load for URL:', this.url);
      try {
        if (
          this.url.includes('backend-go.takeuforward.org/api/v1/plus/judge/check-submit') &&
          this.method.toLowerCase() === 'get'
        ) {
          console.log('[TUF Interceptor] Intercepting submission check response...');
          const response = JSON.parse(this.responseText);
          console.log('[TUF Interceptor] Submission check response:', response);
          
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
            console.log('[TUF Interceptor] Processed submission data:', submissionData);

            // Send data back to content script
            window.postMessage(
              {
                type: 'SUBMISSION_RESPONSE',
                payload: submissionData,
              },
              '*',
            );
          } else {
            console.log('[TUF Interceptor] Submission check not successful or no data');
          }
        }
      } catch (error) {
        console.error('[TUF Interceptor] Error in interceptor:', error);
      }
    });
    
    return send.apply(this, arguments);
  };

  console.log('[TUF Interceptor] TakeUforward submission interceptor loaded');
})();