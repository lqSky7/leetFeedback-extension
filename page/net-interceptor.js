// Traverse — generic MAIN-world network interceptor.
//
// Runs in the page's own JS context at document_start, so it patches
// window.fetch and XMLHttpRequest before any site code can capture them.
//
// It knows nothing about any specific website. The content script sends it a
// list of URL filters (see core/net-protocol.js); every matching request and
// response is forwarded back as a TRV_NET_EVENT message, and the platform
// adapter decides what it means.
//
// This file CANNOT load extension modules — it is declared with
// "world": "MAIN" in manifest.json. The message type strings below are
// duplicated from core/net-protocol.js and must stay in sync with it.

(function () {
  'use strict';

  // Already installed (e.g. the page re-ran the script tag): do nothing.
  if (window.__traverseNetInterceptorInstalled) return;
  window.__traverseNetInterceptorInstalled = true;

  const CONFIG = 'TRV_NET_CONFIG';
  const ACK = 'TRV_NET_ACK';
  const EVENT = 'TRV_NET_EVENT';
  const PHASE_REQUEST = 'request';
  const PHASE_RESPONSE = 'response';

  const MAX_STRING_BODY = 10000;

  let rules = [];
  let debug = false;

  function log(...args) {
    if (debug) console.log('[Traverse][net]', ...args);
  }

  /** Parse a request/response body. JSON when possible, short strings as-is. */
  function parseBody(text) {
    if (typeof text !== 'string' || text.length === 0) return undefined;
    try {
      return JSON.parse(text);
    } catch (_) {
      return text.length <= MAX_STRING_BODY ? text : undefined;
    }
  }

  /** First configured rule whose URL pattern and method match, or null. */
  function findRule(url, method) {
    const target = String(url || '');
    const verb = String(method || 'GET').toUpperCase();

    for (const rule of rules) {
      if (!rule.regex) continue;
      if (rule.methods.length > 0 && !rule.methods.includes(verb)) continue;
      if (rule.regex.test(target)) return rule;
    }
    return null;
  }

  function emit(url, method, payload) {
    try {
      window.postMessage(
        {
          type: EVENT,
          url: String(url || ''),
          method: String(method || 'GET').toUpperCase(),
          ...payload,
        },
        '*'
      );
    } catch (_) {
      /* postMessage can only fail if the page is being torn down */
    }
  }

  /* ── fetch ── */

  function patchFetch() {
    if (typeof window.fetch !== 'function') return;
    const originalFetch = window.fetch;

    window.fetch = function (input, init) {
      let url = '';
      let method = 'GET';

      if (typeof input === 'string') {
        url = input;
      } else if (input && typeof input === 'object' && input.url) {
        url = input.url;
        method = input.method || 'GET';
      }
      if (init && init.method) method = init.method;

      const rule = findRule(url, method);
      if (!rule) return originalFetch.apply(this, arguments);

      const requestBody = parseBody(init && typeof init.body === 'string' ? init.body : undefined);
      log('fetch', method, url);
      emit(url, method, { phase: PHASE_REQUEST, requestBody });

      const pending = originalFetch.apply(this, arguments);

      return pending.then((response) => {
        // Never let capture break the page: clone and read out-of-band.
        try {
          response
            .clone()
            .text()
            .then((text) =>
              emit(url, method, {
                phase: PHASE_RESPONSE,
                requestBody,
                status: response.status,
                response: parseBody(text),
              })
            )
            .catch(() => {});
        } catch (_) {
          /* body already consumed or opaque response */
        }
        return response;
      });
    };
  }

  /* ── XMLHttpRequest ── */

  function patchXhr() {
    if (typeof XMLHttpRequest === 'undefined') return;

    const proto = XMLHttpRequest.prototype;
    const originalOpen = proto.open;
    const originalSend = proto.send;

    proto.open = function (method, url) {
      this.__traverseMethod = method;
      this.__traverseUrl = url;
      return originalOpen.apply(this, arguments);
    };

    proto.send = function (body) {
      const url = this.__traverseUrl || '';
      const method = this.__traverseMethod || 'GET';
      const rule = findRule(url, method);

      if (!rule) return originalSend.apply(this, arguments);

      const requestBody = parseBody(typeof body === 'string' ? body : undefined);
      log('xhr', method, url);
      emit(url, method, { phase: PHASE_REQUEST, requestBody });

      this.addEventListener('load', () => {
        let response;
        try {
          response = parseBody(this.responseText);
        } catch (_) {
          response = undefined;
        }
        emit(url, method, {
          phase: PHASE_RESPONSE,
          requestBody,
          status: this.status,
          response,
        });
      });

      return originalSend.apply(this, arguments);
    };
  }

  /* ── config ── */

  function applyConfig(filters) {
    rules = (Array.isArray(filters) ? filters : [])
      .map((filter) => {
        if (!filter || !filter.url) return null;
        try {
          return {
            regex: new RegExp(filter.url),
            methods: (filter.methods || []).map((m) => String(m).toUpperCase()),
          };
        } catch (error) {
          log('ignoring invalid filter', filter, error);
          return null;
        }
      })
      .filter(Boolean);

    log('applied', rules.length, 'rule(s)');
    window.postMessage({ type: ACK, count: rules.length }, '*');
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== CONFIG) return;

    debug = Boolean(data.debug);
    applyConfig(data.filters);
  });

  // Patch immediately with no rules so requests made before the content script
  // configures us are not lost — they are simply not matched yet.
  patchFetch();
  patchXhr();
  log('interceptor installed');
})();
