// Interceptor script for TakeUforward submission monitoring

(function() {
  'use strict';

  // Store original fetch and XMLHttpRequest
  const originalFetch = window.fetch;
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  // Intercept fetch requests
  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    
    // Check if this is a submission request
    const url = args[0];
    if (typeof url === 'string' && url.includes('/api/submit')) {
      // Clone response to read it
      const clonedResponse = response.clone();
      
      try {
        const data = await clonedResponse.json();
        
        // Post submission response to content script
        window.postMessage({
          type: 'SUBMISSION_RESPONSE',
          payload: data
        }, '*');
        
      } catch (error) {
        console.log('Error parsing submission response:', error);
      }
    }
    
    return response;
  };

  // Intercept XMLHttpRequest
  XMLHttpRequest.prototype.open = function(method, url, ...args) {
    this._url = url;
    this._method = method;
    return originalXHROpen.apply(this, [method, url, ...args]);
  };

  XMLHttpRequest.prototype.send = function(data) {
    // Store reference to xhr instance
    const xhr = this;
    
    // Add load event listener
    xhr.addEventListener('load', function() {
      if (xhr._url && xhr._url.includes('/api/submit')) {
        try {
          const responseData = JSON.parse(xhr.responseText);
          
          // Post submission response to content script
          window.postMessage({
            type: 'SUBMISSION_RESPONSE',
            payload: responseData
          }, '*');
          
        } catch (error) {
          console.log('Error parsing XHR submission response:', error);
        }
      }
    });
    
    return originalXHRSend.apply(this, [data]);
  };

  console.log('TakeUforward submission interceptor loaded');
})();