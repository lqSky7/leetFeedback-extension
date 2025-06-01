// Content script for website-extension authentication communication
(function() {
  'use strict';

  // Only run on the LeetFeedback website
  const isLeetFeedbackSite = window.location.hostname.includes('leet-feedback') || 
                            window.location.hostname.includes('leetfeedback') || 
                            window.location.hostname.includes('vercel.app') ||
                            window.location.hostname.includes('netlify.app');

  if (!isLeetFeedbackSite) return;

  console.log('[LeetFeedback Extension] Website auth content script loaded on:', window.location.hostname);

  // Notify extension that content script is ready
  chrome.runtime.sendMessage({
    type: 'CONTENT_SCRIPT_READY',
    url: window.location.href
  }).catch(() => {
    // Ignore errors if extension context is invalidated
  });

  // Message handler for extension communication
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[LeetFeedback Extension] Received message:', message);

    switch (message.type) {
      case 'AUTH_STATUS_REQUEST':
        handleAuthStatusRequest(sendResponse);
        return true; // Keep message channel open for async response

      case 'SIGN_OUT_REQUEST':
        handleSignOutRequest(sendResponse);
        return true;

      default:
        console.log('[LeetFeedback Extension] Unknown message type:', message.type);
        break;
    }
  });

  // Handle auth status request from extension
  function handleAuthStatusRequest(sendResponse) {
    try {
      console.log('[LeetFeedback Extension] Handling auth status request');
      
      // First check localStorage for immediate response
      const cachedUser = localStorage.getItem('firebase_user');
      if (cachedUser) {
        try {
          const userData = JSON.parse(cachedUser);
          console.log('[LeetFeedback Extension] Found cached user data');
          sendResponse({
            type: 'AUTH_STATUS_RESPONSE',
            isAuthenticated: true,
            user: userData
          });
          return;
        } catch (e) {
          console.log('[LeetFeedback Extension] Invalid cached user data');
        }
      }

      // Request auth status from the website
      window.postMessage({
        type: 'AUTH_STATUS_REQUEST',
        source: 'extension'
      }, window.location.origin);

      // Wait for response from website
      const authResponseHandler = (event) => {
        if (event.origin !== window.location.origin) return;
        
        if (event.data.type === 'AUTH_STATUS_RESPONSE' && event.data.source !== 'extension') {
          console.log('[LeetFeedback Extension] Received auth response from website:', event.data);
          window.removeEventListener('message', authResponseHandler);
          sendResponse({
            type: 'AUTH_STATUS_RESPONSE',
            isAuthenticated: event.data.isAuthenticated,
            user: event.data.user
          });
        }
      };

      window.addEventListener('message', authResponseHandler);

      // Timeout after 3 seconds
      setTimeout(() => {
        window.removeEventListener('message', authResponseHandler);
        console.log('[LeetFeedback Extension] Auth request timeout, sending no auth response');
        sendResponse({
          type: 'AUTH_STATUS_RESPONSE',
          isAuthenticated: false,
          user: null,
          error: 'Timeout'
        });
      }, 3000);

    } catch (error) {
      console.error('[LeetFeedback Extension] Error handling auth status request:', error);
      sendResponse({
        type: 'AUTH_STATUS_RESPONSE',
        isAuthenticated: false,
        user: null,
        error: error.message
      });
    }
  }

  // Handle sign out request from extension
  function handleSignOutRequest(sendResponse) {
    try {
      // Request sign out from the website
      window.postMessage({
        type: 'SIGN_OUT_REQUEST',
        source: 'extension'
      }, window.location.origin);

      // Listen for confirmation
      const signOutHandler = (event) => {
        if (event.origin !== window.location.origin) return;
        
        if (event.data.type === 'SIGN_OUT_RESPONSE' && event.data.source !== 'extension') {
          window.removeEventListener('message', signOutHandler);
          sendResponse({
            type: 'SIGN_OUT_RESPONSE',
            success: event.data.success
          });
        }
      };

      window.addEventListener('message', signOutHandler);

      // Timeout after 3 seconds
      setTimeout(() => {
        window.removeEventListener('message', signOutHandler);
        sendResponse({
          type: 'SIGN_OUT_RESPONSE',
          success: false,
          error: 'Timeout'
        });
      }, 3000);

    } catch (error) {
      console.error('[LeetFeedback Extension] Error handling sign out request:', error);
      sendResponse({
        type: 'SIGN_OUT_RESPONSE',
        success: false,
        error: error.message
      });
    }
  }

  // Listen for auth state changes from the website
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    
    if (event.data.type === 'AUTH_STATE_CHANGED' && event.data.source !== 'extension') {
      console.log('[LeetFeedback Extension] Auth state changed:', event.data);
      
      // Forward auth state change to extension background script
      chrome.runtime.sendMessage({
        type: 'AUTH_STATE_CHANGED',
        isAuthenticated: event.data.isAuthenticated,
        user: event.data.user
      }).catch(error => {
        console.error('[LeetFeedback Extension] Error forwarding auth state change:', error);
      });
    }
  });

  // Check for existing auth data on load
  setTimeout(() => {
    const cachedUser = localStorage.getItem('firebase_user');
    if (cachedUser) {
      try {
        const userData = JSON.parse(cachedUser);
        console.log('[LeetFeedback Extension] Found existing auth data, forwarding to extension');
        chrome.runtime.sendMessage({
          type: 'AUTH_STATE_CHANGED',
          isAuthenticated: true,
          user: userData
        }).catch(() => {
          // Ignore if extension context is invalid
        });
      } catch (e) {
        console.error('[LeetFeedback Extension] Error parsing cached user data:', e);
      }
    }
  }, 1000);

  // Initialize communication
  console.log('[LeetFeedback Extension] Website-extension communication initialized');
})();