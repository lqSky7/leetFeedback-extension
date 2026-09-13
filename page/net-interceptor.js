// Traverse — generic MAIN-world network interceptor.
//
// Runs in the page's own JS context at document_start, so it patches
// window.fetch and XMLHttpRequest before any site code can capture them.
//
// It knows nothing about any specific website. It serves two independent
// consumers, which is why there are two config channels and two event channels:
//
//   1. **Platform mode** (TRV_NET_CONFIG / TRV_NET_EVENT) — the filter-driven
//      path. The content script sends a list of URL filters (see
//      core/net-protocol.js); every matching request and response is forwarded
//      back, and the platform adapter decides what it means. Only matching
//      traffic is emitted.
//
//   2. **Recon mode** (TRV_RECON_CONFIG / TRV_RECON_EVENT) — the capture-all
//      path used on platforms that have no verified adapter yet. It records
//      every request and response with headers, timing, sizes and the JS
//      initiator stack, so a human can work out which call is the submit, where
//      the code lives and which field carries the verdict.
//
// The two are deliberately separate rather than one flag: a domain can have
// both active at once (GeeksforGeeks has an adapter *and* is recon-armed), and
// a shared rule list would have them clobbering each other.
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

  const RECON_CONFIG = 'TRV_RECON_CONFIG';
  const RECON_ACK = 'TRV_RECON_ACK';
  const RECON_EVENT = 'TRV_RECON_EVENT';

  const PHASE_REQUEST = 'request';
  const PHASE_REQUEST_BODY = 'request-body';
  const PHASE_RESPONSE = 'response';

  const MAX_STRING_BODY = 10000;

  // Headers whose values must never leave the page. Presence is still reported
  // (so we can tell an authenticated call from an anonymous one) but the value
  // is replaced — captures get emailed and written to disk.
  const SENSITIVE_HEADERS = [
    'authorization',
    'cookie',
    'set-cookie',
    'proxy-authorization',
    'x-api-key',
    'x-auth-token',
    'x-csrf-token',
    'x-xsrf-token',
    'x-session-token',
    'x-access-token',
  ];
  const REDACTED = '[redacted]';

  const MAX_STACK_FRAMES = 4;
  const MAX_HEADER_VALUE_CHARS = 300;

  let rules = [];
  let debug = false;

  let recon = {
    enabled: false,
    maxBodyChars: 100000,
    maxEvents: 2500,
    excludePattern: null,
  };
  let reconSeq = 0;
  let reconEventCount = 0;
  let reconStopped = false;

  function log(...args) {
    if (debug) console.log('[Traverse][net]', ...args);
  }

  /* ── shared helpers ── */

  /** Parse a request/response body. JSON when possible, short strings as-is. */
  function parseBody(text) {
    if (typeof text !== 'string' || text.length === 0) return undefined;
    try {
      return JSON.parse(text);
    } catch (_) {
      return text.length <= MAX_STRING_BODY ? text : undefined;
    }
  }

  /**
   * Recon bodies are kept as raw text (parsed downstream when possible) and
   * capped, because a single endpoint can return megabytes.
   */
  function capBody(text, maxChars) {
    if (typeof text !== 'string') return { value: undefined, truncated: false };
    if (text.length <= maxChars) return { value: text, truncated: false };
    return { value: text.slice(0, maxChars), truncated: true };
  }

  function isSensitiveHeader(name) {
    return SENSITIVE_HEADERS.includes(String(name || '').toLowerCase());
  }

  /** Normalise any of the shapes headers arrive in into a plain object. */
  function headersToObject(headers) {
    const out = {};

    if (!headers) return out;

    try {
      if (typeof headers.forEach === 'function' && typeof headers.get === 'function') {
        headers.forEach((value, key) => {
          out[key] = value;
        });
        return redactHeaders(out);
      }

      if (Array.isArray(headers)) {
        for (const pair of headers) {
          if (Array.isArray(pair) && pair.length >= 2) out[pair[0]] = pair[1];
        }
        return redactHeaders(out);
      }

      if (typeof headers === 'object') {
        for (const key of Object.keys(headers)) out[key] = headers[key];
      }
    } catch (_) {
      /* opaque or already-consumed header bag */
    }

    return redactHeaders(out);
  }

  function redactHeaders(headers) {
    const out = {};
    for (const key of Object.keys(headers || {})) {
      if (isSensitiveHeader(key)) {
        out[key] = REDACTED;
        continue;
      }
      const value = headers[key];
      out[key] = typeof value === 'string' && value.length > MAX_HEADER_VALUE_CHARS
        ? `${value.slice(0, MAX_HEADER_VALUE_CHARS)}…`
        : value;
    }
    return out;
  }

  /** Parse an XHR `getAllResponseHeaders()` string into a redacted object. */
  function parseRawHeaders(raw) {
    const out = {};
    if (typeof raw !== 'string') return out;

    for (const line of raw.split(/\r?\n/)) {
      const index = line.indexOf(':');
      if (index <= 0) continue;
      out[line.slice(0, index).trim()] = line.slice(index + 1).trim();
    }
    return redactHeaders(out);
  }

  /**
   * A short JS call stack, captured at request time. This is the single most
   * useful signal for identifying which call is the real submit: the frame
   * names point straight at the site's own submit handler.
   */
  function captureInitiator() {
    try {
      const stack = new Error().stack;
      if (typeof stack !== 'string') return null;

      const frames = stack
        .split('\n')
        .slice(1)
        // Drop our own frames and the generic "at <anonymous>".
        .filter((line) => !line.includes('traverse') && !line.includes('net-interceptor'))
        .slice(0, MAX_STACK_FRAMES)
        .map((line) => line.trim().replace(/^at\s+/, ''));

      return frames.length > 0 ? frames : null;
    } catch (_) {
      return null;
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

  /** Recon capture is active and still under its event budget. */
  function reconActive() {
    return recon.enabled && !reconStopped;
  }

  function reconUrlExcluded(url) {
    const target = String(url || '');
    if (!target) return true;
    if (target.startsWith('data:') || target.startsWith('blob:')) return true;
    if (recon.excludePattern && recon.excludePattern.test(target)) return true;
    return false;
  }

  function emitRecon(payload) {
    if (!reconActive()) return;

    reconEventCount += 1;
    if (reconEventCount > recon.maxEvents) {
      reconStopped = true;
      log('recon event budget exhausted');
      try {
        window.postMessage({ type: RECON_EVENT, phase: 'overflow', emitted: reconEventCount }, '*');
      } catch (_) {
        /* page teardown */
      }
      return;
    }

    try {
      window.postMessage({ type: RECON_EVENT, ...payload }, '*');
    } catch (_) {
      /* page teardown */
    }
  }

  /* ── fetch ── */

  function readFetchRequest(input, init) {
    let url = '';
    let method = 'GET';

    if (typeof input === 'string') {
      url = input;
    } else if (input && typeof input === 'object' && input.url) {
      url = input.url;
      method = input.method || 'GET';
    }
    if (init && init.method) method = init.method;

    return { url, method: String(method).toUpperCase(), isRequestObject: typeof input === 'object' && input !== null && typeof input.url === 'string' };
  }

  function serialiseBody(body) {
    if (body === undefined || body === null) return undefined;
    if (typeof body === 'string') return body;
    if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString();
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      try {
        const pairs = [];
        body.forEach((value, key) => {
          pairs.push(`${key}=${typeof value === 'string' ? value : '[file]'}`);
        });
        return pairs.join('&');
      } catch (_) {
        return '[formdata]';
      }
    }
    if (typeof body === 'object') {
      try {
        return JSON.stringify(body);
      } catch (_) {
        return '[unserialisable body]';
      }
    }
    return undefined;
  }

  function patchFetch() {
    if (typeof window.fetch !== 'function') return;
    const originalFetch = window.fetch;

    window.fetch = function (input, init) {
      const { url, method, isRequestObject } = readFetchRequest(input, init);

      const reconOn = reconActive() && !reconUrlExcluded(url);
      const rule = reconOn ? null : findRule(url, method);

      if (!reconOn && !rule) return originalFetch.apply(this, arguments);

      if (reconOn) {
        const seq = ++reconSeq;
        const startedAt = Date.now();
        const initiator = captureInitiator();
        const requestHeaders = headersToObject((init && init.headers) || (input && input.headers));
        const rawRequestBody = serialiseBody(init && init.body);
        const capped = capBody(rawRequestBody, recon.maxBodyChars);

        log('recon fetch', method, url);
        emitRecon({
          seq,
          phase: PHASE_REQUEST,
          url,
          method,
          initiator,
          startedAt,
          requestHeaders,
          requestBody: capped.value,
          requestTruncated: capped.truncated,
        });

        // A Request object hides its body behind an async clone; report it
        // separately under the same seq so ordering doesn't matter.
        if (isRequestObject && !init) {
          try {
            input
              .clone()
              .text()
              .then((text) => {
                const bodyCapped = capBody(text, recon.maxBodyChars);
                if (bodyCapped.value) {
                  emitRecon({
                    seq,
                    phase: PHASE_REQUEST_BODY,
                    url,
                    method,
                    requestBody: bodyCapped.value,
                    requestTruncated: bodyCapped.truncated,
                  });
                }
              })
              .catch(() => {});
          } catch (_) {
            /* body already consumed */
          }
        }

        const pending = originalFetch.apply(this, arguments);

        return pending.then((response) => {
          // Never let capture break the page: clone and read out-of-band.
          try {
            const responseHeaders = headersToObject(response.headers);
            response
              .clone()
              .text()
              .then((text) => {
                const bodyCapped = capBody(text, recon.maxBodyChars);
                emitRecon({
                  seq,
                  phase: PHASE_RESPONSE,
                  url,
                  method,
                  status: response.status,
                  ok: response.ok,
                  durationMs: Date.now() - startedAt,
                  responseHeaders,
                  responseBody: bodyCapped.value,
                  responseTruncated: bodyCapped.truncated,
                });
              })
              .catch(() => {});
          } catch (_) {
            /* body already consumed or opaque response */
          }
          return response;
        });
      }

      const requestBody = parseBody(init && typeof init.body === 'string' ? init.body : undefined);
      log('fetch', method, url);
      emit(url, method, { phase: PHASE_REQUEST, requestBody });

      const pending = originalFetch.apply(this, arguments);

      return pending.then((response) => {
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
    const originalSetRequestHeader = proto.setRequestHeader;

    proto.open = function (method, url) {
      this.__traverseMethod = method;
      this.__traverseUrl = url;
      this.__traverseHeaders = {};
      return originalOpen.apply(this, arguments);
    };

    proto.setRequestHeader = function (name, value) {
      try {
        if (!this.__traverseHeaders) this.__traverseHeaders = {};
        this.__traverseHeaders[name] = value;
      } catch (_) {
        /* ignore */
      }
      return originalSetRequestHeader.apply(this, arguments);
    };

    proto.send = function (body) {
      const url = this.__traverseUrl || '';
      const method = String(this.__traverseMethod || 'GET').toUpperCase();

      const reconOn = reconActive() && !reconUrlExcluded(url);
      const rule = reconOn ? null : findRule(url, method);

      if (!reconOn && !rule) return originalSend.apply(this, arguments);

      if (reconOn) {
        const seq = ++reconSeq;
        const startedAt = Date.now();
        const initiator = captureInitiator();
        const requestHeaders = redactHeaders(this.__traverseHeaders || {});
        const capped = capBody(serialiseBody(body), recon.maxBodyChars);

        log('recon xhr', method, url);
        emitRecon({
          seq,
          phase: PHASE_REQUEST,
          url,
          method,
          initiator,
          startedAt,
          requestHeaders,
          requestBody: capped.value,
          requestTruncated: capped.truncated,
        });

        const finish = (eventName) => {
          this.addEventListener(eventName, () => {
            let responseText;
            try {
              responseText = this.responseType === '' || this.responseType === 'text'
                ? this.responseText
                : undefined;
            } catch (_) {
              responseText = undefined;
            }

            const bodyCapped = capBody(responseText, recon.maxBodyChars);
            emitRecon({
              seq,
              phase: PHASE_RESPONSE,
              url,
              method,
              status: this.status,
              ok: this.status >= 200 && this.status < 300,
              durationMs: Date.now() - startedAt,
              responseHeaders: parseRawHeaders(
                typeof this.getAllResponseHeaders === 'function' ? this.getAllResponseHeaders() : ''
              ),
              responseBody: bodyCapped.value,
              responseTruncated: bodyCapped.truncated,
              failed: eventName === 'error' || eventName === 'timeout',
            });
          });
        };

        finish('load');
        finish('error');
        finish('timeout');

        return originalSend.apply(this, arguments);
      }

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

  function applyReconConfig(data) {
    const enabling = data.enabled !== false;
    const wasCapturing = reconActive();

    recon = {
      enabled: enabling,
      maxBodyChars: Number(data.maxBodyChars) > 0 ? Number(data.maxBodyChars) : 100000,
      maxEvents: Number(data.maxEvents) > 0 ? Number(data.maxEvents) : 2500,
      excludePattern: null,
    };

    if (typeof data.excludeUrl === 'string' && data.excludeUrl) {
      try {
        recon.excludePattern = new RegExp(data.excludeUrl);
      } catch (error) {
        log('ignoring invalid recon excludeUrl', error);
      }
    }

    if (enabling && !wasCapturing) {
      // Only a genuine start of capture resets the budget.
      //
      // `reconSeq` is deliberately NOT reset. The controller keys its event map
      // by `seq`, so if this counter restarted while that map still held records
      // from the previous generation, every new event would land on an unrelated
      // record — the request body of one call paired with the response body of
      // another, which is silent data corruption in the uploaded bundle. The
      // controller only re-arms via arm(), which clears its map; seq therefore
      // has to stay monotonic for the lifetime of the page, and the controller's
      // `sort((a, b) => a.seq - b.seq)` copes with any starting value.
      reconEventCount = 0;
      reconStopped = false;
    }

    log('recon', enabling ? 'enabled' : 'disabled');
    window.postMessage({ type: RECON_ACK, enabled: recon.enabled }, '*');
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data) return;

    if (data.type === CONFIG) {
      debug = Boolean(data.debug);
      applyConfig(data.filters);
      return;
    }

    if (data.type === RECON_CONFIG) {
      debug = Boolean(data.debug) || debug;
      applyReconConfig(data);
    }
  });

  // Patch immediately with no rules so requests made before the content script
  // configures us are not lost — they are simply not matched yet.
  patchFetch();
  patchXhr();
  log('interceptor installed');
})();
