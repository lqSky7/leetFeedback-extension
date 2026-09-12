// Traverse — platform reconnaissance controller (isolated world).
//
// Purpose: platforms that have no verified network adapter are discovered by
// recording a real session. This controller arms a capture-all recorder on
// problem pages of every platform except LeetCode and TakeUforward, labels what
// the user does, works out which response carried the verdict, scrapes the
// run/submit button selectors and the editor shape, and stages the whole bundle
// for upload.
//
// It is deliberately independent of `core/platform-adapter.js`:
//
//   • A domain can have both. GeeksforGeeks has a real adapter *and* is a
//     recon target, and the two must not fight over the interceptor — which is
//     why recon uses its own config/event channel (see core/net-protocol.js).
//   • Recon is about *discovery*, not about tracking a user's attempts. It does
//     not touch chrome.storage problem records, does not count runs, and does
//     not run the submission pipeline.
//
// Capture is gated on an upload token, but not on *user* setup: the token is
// baked into core/config.js (recon.defaultToken) so a user who never opens the
// sidepanel still contributes captures. The sidepanel field only overrides it.
// With no token at all the controller stays idle rather than silently
// accumulating data it cannot deliver.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});
  if (!T.config || !T.config.recon) return;

  const cfg = T.config.recon;
  const keys = cfg.keys;
  const DEFAULT_TOKEN = cfg.defaultToken || '';
  const logger = T.createLogger ? T.createLogger('recon') : console;

  const FLOW_IDS = ['run-pass', 'run-fail', 'submit-pass', 'submit-fail'];

  // Verdict vocabulary, split by how much it can be trusted on its own.
  //
  // STRONG tokens are specific enough that seeing one in a verdict-shaped field
  // (or on a verdict-shaped URL) is conclusive. WEAK tokens are generic words
  // that appear all over ordinary API envelopes — `{success: true}` on a
  // metadata call is not a submission verdict — so they only count when the URL
  // itself looks like a judge endpoint.
  const STRONG_ACCEPT_TOKENS = [
    'accepted', 'correct answer', 'correct', 'all test cases passed', 'right answer', 'solved',
  ];
  const STRONG_REJECT_TOKENS = [
    'wrong answer', 'incorrect', 'compilation error', 'compile error', 'runtime error',
    'time limit exceeded', 'memory limit exceeded', 'presentation error', 'not accepted', 'rejected',
  ];
  const WEAK_ACCEPT_TOKENS = ['passed', 'pass', 'success', 'ok'];
  const WEAK_REJECT_TOKENS = ['failed', 'fail', 'error', 'wrong'];

  // Field names that make a string a *verdict* rather than incidental copy.
  const VERDICT_KEY_HINT = /verdict|status|result|outcome|state|score|judge|evaluation|passed|success/i;
  const VERDICT_URL_HINT = /submit|run|judge|check|status|result|execute|evaluate|grade|compile/i;

  const BUTTON_TEXT_HINT = /(^|\b)(submit|run|compile|check|test|execute|judge|evaluate|verify)(\b|$)/i;
  const SUBMIT_TEXT_HINT = /submit|final|judge/i;
  const RUN_TEXT_HINT = /run|compile|test|execute|check|try/i;

  const MAX_SCAN_ELEMENTS = 400;
  const FLOW_WINDOW_TIMEOUT_MS = 45000;
  const DOM_SCAN_INTERVAL_MS = 3000;

  /* ── environment gating ── */

  function hostMatches(host, suffix) {
    return host === suffix || host.endsWith(`.${suffix}`);
  }

  function resolvePlatformId() {
    const host = window.location.hostname;
    let best = null;

    for (const suffix of Object.keys(cfg.platforms)) {
      if (!hostMatches(host, suffix)) continue;
      if (!best || suffix.length > best.suffix.length) best = { suffix, id: cfg.platforms[suffix] };
    }

    return best ? best.id : null;
  }

  function isExcludedHost() {
    const host = window.location.hostname;
    const all = [...cfg.excludedHosts, ...cfg.excludedHostsExtra];
    return all.some((suffix) => hostMatches(host, suffix));
  }

  function looksLikeProblemUrl() {
    const path = window.location.pathname.toLowerCase();
    return cfg.problemUrlPatterns.some((pattern) => path.includes(pattern));
  }

  /* ── selector generation ── */

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
  }

  function isUniqueSelector(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch (_) {
      return false;
    }
  }

  /**
   * Build the most stable selector we can for an element, preferring explicit
   * hooks (id, data-testid) over generated class names, which change on every
   * deploy and are useless in an adapter.
   */
  function stableSelector(element) {
    if (!element || element.nodeType !== 1) return null;

    for (const attribute of ['data-testid', 'data-test-id', 'data-cy', 'data-qa', 'name', 'aria-label']) {
      const value = element.getAttribute && element.getAttribute(attribute);
      if (value) {
        const candidate = `${element.tagName.toLowerCase()}[${attribute}="${value}"]`;
        if (isUniqueSelector(candidate)) return candidate;
      }
    }

    if (element.id) {
      const candidate = `#${cssEscape(element.id)}`;
      if (isUniqueSelector(candidate)) return candidate;
    }

    const classes = (element.className && typeof element.className === 'string')
      ? element.className.trim().split(/\s+/).filter((name) => name && name.length < 40).slice(0, 3)
      : [];

    const tag = element.tagName.toLowerCase();
    if (classes.length > 0) {
      const candidate = `${tag}${classes.map((name) => `.${cssEscape(name)}`).join('')}`;
      if (isUniqueSelector(candidate)) return candidate;
      // Not unique, but still the most useful description available.
      return candidate;
    }

    // Last resort: a structural path.
    const parts = [];
    let node = element;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      const parent = node.parentElement;
      if (!parent) break;
      const index = Array.prototype.indexOf.call(parent.children, node) + 1;
      parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
      node = parent;
      depth += 1;
    }

    return parts.length > 0 ? parts.join(' > ') : tag;
  }

  function visibleText(element) {
    const text = element && element.textContent ? element.textContent.trim().replace(/\s+/g, ' ') : '';
    return text.length > 80 ? text.slice(0, 80) : text;
  }

  /* ── DOM description ── */

  function describeButtons() {
    const results = [];
    const seen = new Set();

    const candidates = document.querySelectorAll('button, [role="button"], input[type="submit"], a.btn, a[class*="button"]');

    for (const element of Array.from(candidates).slice(0, MAX_SCAN_ELEMENTS)) {
      const text = visibleText(element) || (element.value ? String(element.value) : '');
      if (!text || !BUTTON_TEXT_HINT.test(text)) continue;

      const selector = stableSelector(element);
      if (!selector || seen.has(selector)) continue;
      seen.add(selector);

      const kind = SUBMIT_TEXT_HINT.test(text) ? 'submit' : RUN_TEXT_HINT.test(text) ? 'run' : 'other';

      results.push({
        kind,
        text,
        selector,
        matches: (() => {
          try {
            return document.querySelectorAll(selector).length;
          } catch (_) {
            return 0;
          }
        })(),
        disabled: Boolean(element.disabled),
      });
    }

    return results.slice(0, 25);
  }

  function describeEditors() {
    const editors = [];

    const frameworks = [
      { kind: 'monaco', selector: '.monaco-editor', languageSelector: '[data-mode-id]' },
      { kind: 'ace', selector: '.ace_editor', languageSelector: '.ace_editor[data-mode]' },
      { kind: 'codemirror', selector: '.CodeMirror', languageSelector: null },
      { kind: 'codemirror6', selector: '.cm-editor', languageSelector: null },
      { kind: 'textarea', selector: 'textarea', languageSelector: null },
    ];

    for (const framework of frameworks) {
      const element = document.querySelector(framework.selector);
      if (!element) continue;

      const textInput = framework.kind === 'ace' ? document.querySelector('.ace_text-input') : null;

      editors.push({
        kind: framework.kind,
        selector: framework.selector,
        languageSelector: framework.languageSelector,
        // Where the code can actually be read from, if a DOM read is possible.
        codeSelector: textInput ? '.ace_text-input' : null,
        lineSelector: framework.kind === 'ace' ? '.ace_line' : null,
        visible: Boolean(element.offsetParent),
      });
    }

    const languageTrigger = document.querySelector('[data-mode-id], [class*="language"] [role="option"], [class*="language-dropdown"]');
    if (languageTrigger) {
      editors.push({
        kind: 'language-picker',
        selector: stableSelector(languageTrigger) || '[class*="language"]',
        languageSelector: null,
        text: visibleText(languageTrigger),
      });
    }

    return editors;
  }

  function describeMetadata() {
    const candidates = [];

    const specs = [
      { kind: 'title', selectors: ['h1', 'h2', '[class*="title"] h1', '[class*="title"] h2', '[class*="problem-title"]', '[class*="question-title"]'] },
      { kind: 'difficulty', selectors: ['[class*="difficulty"]', '[class*="Difficulty"]', '[data-difficulty]'] },
      { kind: 'topics', selectors: ['[class*="tag"] a', '[class*="topic"] a', '[class*="category"] a'] },
      { kind: 'description', selectors: ['[class*="description"]', '[class*="problem-statement"]', '[class*="question-content"]'] },
    ];

    for (const spec of specs) {
      for (const selector of spec.selectors) {
        let element = null;
        try {
          element = document.querySelector(selector);
        } catch (_) {
          continue;
        }
        if (!element) continue;

        const text = visibleText(element);
        if (!text) continue;

        candidates.push({
          kind: spec.kind,
          selector,
          stableSelector: stableSelector(element),
          text,
          matches: (() => {
            try {
              return document.querySelectorAll(selector).length;
            } catch (_) {
              return 0;
            }
          })(),
        });
        break;
      }
    }

    return candidates;
  }

  /* ── verdict inference ── */

  function parseMaybe(text) {
    if (typeof text !== 'string' || text.length === 0) return undefined;
    try {
      return JSON.parse(text);
    } catch (_) {
      return text;
    }
  }

  /** Collect scalar strings with their dotted paths, bounded in depth/breadth. */
  function collectStrings(value, path = '', depth = 0, out = []) {
    if (out.length >= 200 || depth > 5) return out;

    if (typeof value === 'string') {
      out.push({ path, value });
      return out;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      out.push({ path, value: String(value) });
      return out;
    }
    if (Array.isArray(value)) {
      value.slice(0, 20).forEach((item, index) => collectStrings(item, `${path}[${index}]`, depth + 1, out));
      return out;
    }
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value).slice(0, 40)) {
        collectStrings(value[key], path ? `${path}.${key}` : key, depth + 1, out);
      }
    }
    return out;
  }

  /**
   * Word-boundary token match.
   *
   * A naive `includes` is wrong here: the token "ok" would match "lookup" and
   * "pass" would match "passed", so a field named `lookupToken` would be read
   * as an accepted verdict.
   */
  function matchToken(text, tokens) {
    const value = String(text || '').trim();
    if (!value || value.length > 160) return null;

    for (const token of tokens) {
      const pattern = new RegExp(`(^|[^a-z])${escapeRegex(token)}([^a-z]|$)`, 'i');
      if (pattern.test(value)) return token;
    }
    return null;
  }

  /**
   * Work out whether a response means "passed" or "failed", without knowing
   * anything about the platform.
   *
   * Returns null when the body carries no verdict at all — which is the common
   * case, because the site polls a status endpoint repeatedly while judging.
   */
  function inferVerdict(rawText, url) {
    if (typeof rawText !== 'string' || rawText.length === 0) return null;

    const parsed = parseMaybe(rawText);
    const strings = collectStrings(parsed);
    const urlLooksLikeVerdict = VERDICT_URL_HINT.test(String(url || ''));

    let best = null;

    for (const entry of strings) {
      const keyHint = VERDICT_KEY_HINT.test(entry.path);

      const strongAccept = matchToken(entry.value, STRONG_ACCEPT_TOKENS);
      const strongReject = strongAccept ? null : matchToken(entry.value, STRONG_REJECT_TOKENS);
      const acceptToken = strongAccept || matchToken(entry.value, WEAK_ACCEPT_TOKENS);
      const rejectToken = strongReject || matchToken(entry.value, WEAK_REJECT_TOKENS);

      if (!acceptToken && !rejectToken) continue;

      const isStrong = Boolean(strongAccept || strongReject);

      // A strong token needs a verdict-shaped field name or URL. A weak token
      // needs the URL, because `{success: true}` is on half the endpoints on
      // any given site and means nothing about a submission.
      if (isStrong) {
        if (!keyHint && !urlLooksLikeVerdict) continue;
      } else if (!urlLooksLikeVerdict) {
        continue;
      }

      const score =
        (isStrong ? 4 : 0) + (keyHint ? 2 : 0) + (urlLooksLikeVerdict ? 1 : 0) - entry.value.length / 400;

      if (!best || score > best.score) {
        best = {
          score,
          accepted: Boolean(acceptToken) && !rejectToken,
          status: String(entry.value).slice(0, 120),
          path: entry.path,
        };
      }
    }

    if (!best) return null;

    return {
      accepted: best.accepted,
      status: best.status,
      source: 'network',
      path: best.path,
      url: String(url || ''),
      acceptedFields: best.accepted ? [{ path: best.path, value: best.status }] : [],
    };
  }

  /* ── controller ── */

  class ReconController {
    constructor() {
      this.platform = resolvePlatformId();
      this.origin = window.location.origin;
      this.enabled = false;
      this.token = '';

      this.armed = false;
      this.startedAt = null;
      this.events = new Map(); // seq -> merged record
      this.overflowed = false;
      this.bundleChars = 0;

      this.flows = {};
      for (const id of FLOW_IDS) this.flows[id] = { status: 'missing' };

      this.pending = null; // { kind, at, flowTagged }
      this.lastEventAt = 0;
      this.uploadedAt = null;
      this.lastError = null;

      this.dom = { buttons: [], editors: [], metadata: { candidates: [] } };

      this._listener = null;
      this._clickHandler = null;
      this._scanTimer = null;
      this._windowTimer = null;
      this._urlObserver = null;
      this._currentHref = location.href;
      this._booted = false;
    }

    /* ── lifecycle ── */

    async init() {
      const stored = await chrome.storage.local.get([keys.enabled, keys.token]);
      this.enabled = stored[keys.enabled] !== false; // default on
      this.token = stored[keys.token] || DEFAULT_TOKEN;

      // Re-arm only when a *setting* changes.
      //
      // This listener fires for every write to chrome.storage.local, including
      // our own status/bundle writes. Re-evaluating unconditionally would loop
      // forever: evaluateArming -> publishStatus -> set -> listener -> ...
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;

        let settingsChanged = false;
        if (changes[keys.enabled]) {
          this.enabled = changes[keys.enabled].newValue !== false;
          settingsChanged = true;
        }
        if (changes[keys.token]) {
          this.token = changes[keys.token].newValue || DEFAULT_TOKEN;
          settingsChanged = true;
        }

        if (settingsChanged) {
          this.evaluateArming().catch((error) => logger.error('re-arm failed:', error));
        }
      });

      if (isExcludedHost() || !this.platform) {
        logger.log('recon idle — excluded host or untracked platform');
        return;
      }

      this._booted = true;
      this.attachListeners();
      this.watchNavigation();
      await this.evaluateArming();
    }

    /** Arm or disarm based on the current URL, the toggle and the token. */
    async evaluateArming() {
      if (!this._booted) return;

      const shouldArm = this.enabled && Boolean(this.token) && looksLikeProblemUrl();

      if (shouldArm && !this.armed) {
        await this.arm();
      } else if (!shouldArm && this.armed) {
        await this.disarm('left problem page');
      } else if (shouldArm && this.armed) {
        // Same page, but the token may have just appeared.
        this.pushConfig();
      }

      await this.publishStatus();
    }

    async arm() {
      this.armed = true;
      this.startedAt = new Date().toISOString();
      this.events = new Map();
      this.bundleChars = 0;
      this.overflowed = false;
      this.uploadedAt = null;
      this.lastError = null;
      this.pending = null;
      for (const id of FLOW_IDS) this.flows[id] = { status: 'missing' };

      this.scanDom();
      this.startScanTimer();
      this.pushConfig();

      logger.log(`recon armed for ${this.platform} on ${location.pathname}`);
      await this.persistBundle();
    }

    async disarm(reason) {
      this.armed = false;
      this.stopScanTimer();
      this.pushConfig();
      logger.log(`recon disarmed (${reason})`);
    }

    /** Send the recon config to the MAIN-world interceptor. */
    pushConfig() {
      const protocol = T.netProtocol;
      if (!protocol) return;

      try {
        window.postMessage(
          {
            type: protocol.RECON_CONFIG,
            enabled: this.armed,
            maxBodyChars: cfg.maxBodyChars,
            maxEvents: cfg.maxEvents,
            // Never capture our own upload — it would recurse and pollute the
            // bundle with the very request that delivers it.
            excludeUrl: escapeRegex(T.config.backendBaseURL || ''),
            debug: T.logger ? T.logger.isDebugMode() : false,
          },
          '*'
        );
      } catch (error) {
        logger.warn('could not push recon config:', error);
      }
    }

    attachListeners() {
      const protocol = T.netProtocol;
      if (!protocol) return;

      this._listener = (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.type !== protocol.RECON_EVENT) return;
        try {
          this.onReconEvent(data);
        } catch (error) {
          logger.error('recon event handling failed:', error);
        }
      };
      window.addEventListener('message', this._listener);

      // One delegated capture-phase listener: it must run before the site's own
      // handler so the pending window is open by the time the request fires.
      this._clickHandler = (event) => {
        const target = event.target && event.target.closest
          ? event.target.closest('button, [role="button"], input[type="submit"], a')
          : null;
        if (!target) return;

        const text = visibleText(target) || (target.value ? String(target.value) : '');
        if (!text || !BUTTON_TEXT_HINT.test(text)) return;

        const kind = SUBMIT_TEXT_HINT.test(text) ? 'submit' : 'run';
        this.openFlowWindow(kind, text);
      };
      document.addEventListener('click', this._clickHandler, true);
    }

    watchNavigation() {
      this._urlObserver = new MutationObserver(() => {
        if (location.href === this._currentHref) return;
        const previous = this._currentHref;
        this._currentHref = location.href;
        logger.log(`navigation: ${previous} -> ${location.href}`);
        this.evaluateArming().catch((error) => logger.error('re-arm failed:', error));
      });
      this._urlObserver.observe(document, { subtree: true, childList: true });
    }

    /* ── flow windows ── */

    openFlowWindow(kind, buttonText) {
      if (!this.armed) return;

      this.pending = { kind, at: Date.now(), buttonText, tagged: false };
      logger.log(`flow window opened: ${kind} ("${buttonText}")`);

      if (this._windowTimer) clearTimeout(this._windowTimer);
      this._windowTimer = setTimeout(() => {
        if (!this.pending) return;
        // A window that never produced a verdict is worth recording as
        // uncertain rather than silently dropped.
        logger.log(`flow window timed out without a verdict (${this.pending.kind})`);
        this.recordFlow(this.pending.kind, 'uncertain', {
          status: 'no verdict observed',
          source: 'timeout',
        });
        this.pending = null;
        this.persistBundle().catch(() => {});
      }, FLOW_WINDOW_TIMEOUT_MS);
    }

    /** Tag a network record with the flow currently in progress. */
    currentFlowTag() {
      if (!this.pending) return null;
      if (Date.now() - this.pending.at > FLOW_WINDOW_TIMEOUT_MS) return null;
      return this.pending.kind;
    }

    recordFlow(kind, outcome, verdict) {
      const id = `${kind}-${outcome}`;
      if (!FLOW_IDS.includes(id)) return;

      this.flows[id] = {
        status: 'observed',
        observedAt: new Date().toISOString(),
        verdict: verdict || null,
      };
      logger.log(`flow recorded: ${id}${verdict && verdict.status ? ` (${verdict.status})` : ''}`);
    }

    /* ── network events ── */

    onReconEvent(data) {
      if (!this.armed) return;

      if (data.phase === 'overflow') {
        this.overflowed = true;
        this.persistBundle().catch(() => {});
        return;
      }

      const seq = data.seq;
      if (typeof seq !== 'number') return;

      const record = this.events.get(seq) || {
        seq,
        url: data.url,
        method: data.method,
        flow: this.currentFlowTag(),
        initiator: data.initiator || null,
        startedAt: data.startedAt || Date.now(),
      };

      if (data.phase === 'request') {
        record.initiator = data.initiator || record.initiator;
        record.requestHeaders = data.requestHeaders;
        record.requestBody = parseMaybe(data.requestBody);
        record.requestTruncated = Boolean(data.requestTruncated);
      } else if (data.phase === 'request-body') {
        record.requestBody = parseMaybe(data.requestBody);
        record.requestTruncated = Boolean(data.requestTruncated);
      } else if (data.phase === 'response') {
        record.status = data.status;
        record.ok = data.ok;
        record.durationMs = data.durationMs;
        record.responseHeaders = data.responseHeaders;
        record.responseBody = parseMaybe(data.responseBody);
        record.responseTruncated = Boolean(data.responseTruncated);
        record.failed = Boolean(data.failed);

        this.considerVerdict(record, data);
      }

      this.events.set(seq, record);
      this.lastEventAt = Date.now();
      this.enforceBundleBudget();
      this.schedulePersist();
    }

    /** A response inside an open flow window may carry the judgement. */
    considerVerdict(record, data) {
      if (!this.pending) return;

      const verdict = inferVerdict(data.responseBody, data.url);
      if (!verdict) return;

      const outcome = verdict.accepted ? 'pass' : 'fail';
      this.recordFlow(this.pending.kind, outcome, verdict);

      if (this._windowTimer) clearTimeout(this._windowTimer);
      this.pending = null;

      this.maybeAutoUpload();
    }

    maybeAutoUpload() {
      if (!cfg.autoUpload) return;
      const allObserved = FLOW_IDS.every((id) => this.flows[id].status === 'observed');
      if (!allObserved) return;

      logger.log('all four flows observed — uploading');
      this.upload().catch((error) => logger.error('auto upload failed:', error));
    }

    /* ── bundle ── */

    /** Drop the oldest records once the bundle would exceed its character cap. */
    enforceBundleBudget() {
      const estimate = () => {
        let total = 0;
        for (const record of this.events.values()) {
          total += (record.requestBody ? JSON.stringify(record.requestBody).length : 0);
          total += (record.responseBody ? JSON.stringify(record.responseBody).length : 0);
          total += 400;
        }
        return total;
      };

      while (this.events.size > 50 && estimate() > cfg.maxBundleChars) {
        const oldest = this.events.keys().next();
        if (oldest.done) break;
        this.events.delete(oldest.value);
      }
    }

    buildBundle() {
      const network = Array.from(this.events.values()).sort((a, b) => a.seq - b.seq);

      return {
        schema: 'traverse.recon.v1',
        captureId: this.captureId(),
        platform: this.platform,
        origin: this.origin,
        startedAt: this.startedAt,
        endedAt: new Date().toISOString(),
        armed: this.armed,
        overflowed: this.overflowed,
        flows: this.flows,
        page: {
          url: location.href.split('?')[0],
          pathname: location.pathname,
          title: document.title,
          framework: this.detectFramework(),
        },
        network,
        dom: {
          buttons: this.dom.buttons,
          editors: this.dom.editors,
          metadata: this.dom.metadata,
        },
        environment: {
          userAgent: navigator.userAgent,
          language: navigator.language,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        },
      };
    }

    captureId() {
      const slug = String(this.platform || 'unknown').replace(/[^a-z0-9-]/gi, '-').toLowerCase();
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      return `recon-${slug}-${stamp}`;
    }

    detectFramework() {
      const found = [];
      if (window.__NEXT_DATA__) found.push('next');
      if (window.__NUXT__) found.push('nuxt');
      if (document.querySelector('[data-reactroot], #__next, #root')) found.push('react');
      if (document.querySelector('[ng-version], app-root')) found.push('angular');
      if (document.querySelector('[data-v-app]')) found.push('vue');
      return found;
    }

    schedulePersist() {
      if (this._persistTimer) return;
      this._persistTimer = setTimeout(() => {
        this._persistTimer = null;
        this.persistBundle().catch((error) => logger.warn('persist failed:', error));
      }, 1500);
    }

    async persistBundle() {
      const bundle = this.buildBundle();
      const serialised = JSON.stringify(bundle);
      this.bundleChars = serialised.length;

      await chrome.storage.local.set({
        [keys.bundle]: bundle,
        [keys.status]: this.statusSnapshot(),
      });
    }

    async publishStatus() {
      await chrome.storage.local.set({ [keys.status]: this.statusSnapshot() });
    }

    statusSnapshot() {
      return {
        platform: this.platform,
        origin: this.origin,
        host: window.location.hostname,
        enabled: this.enabled,
        hasToken: Boolean(this.token),
        armed: this.armed,
        excluded: isExcludedHost(),
        onProblemPage: looksLikeProblemUrl(),
        startedAt: this.startedAt,
        lastEventAt: this.lastEventAt || null,
        uploadedAt: this.uploadedAt,
        lastError: this.lastError,
        overflowed: this.overflowed,
        eventCount: this.events.size,
        bundleChars: this.bundleChars,
        flows: this.flows,
        buttons: this.dom.buttons.slice(0, 6),
        updatedAt: Date.now(),
      };
    }

    /* ── DOM scanning ── */

    scanDom() {
      try {
        this.dom = {
          buttons: describeButtons(),
          editors: describeEditors(),
          metadata: { candidates: describeMetadata() },
        };
        logger.log(
          `dom scan — ${this.dom.buttons.length} button(s), ${this.dom.editors.length} editor(s)`
        );
      } catch (error) {
        logger.warn('dom scan failed:', error);
      }
    }

    startScanTimer() {
      this.stopScanTimer();
      this._scanTimer = setInterval(() => {
        this.scanDom();
        this.schedulePersist();
      }, DOM_SCAN_INTERVAL_MS);
    }

    stopScanTimer() {
      if (this._scanTimer) {
        clearInterval(this._scanTimer);
        this._scanTimer = null;
      }
    }

    /* ── teardown ── */

    /**
     * Stop everything this controller owns.
     *
     * In production the content script lives for the page's lifetime, so this
     * is not on the normal path — but a controller that cannot be stopped is
     * untestable, and a lingering scan interval would keep writing status into
     * whatever storage context happens to exist later.
     */
    destroy() {
      this.stopScanTimer();

      if (this._windowTimer) {
        clearTimeout(this._windowTimer);
        this._windowTimer = null;
      }
      if (this._persistTimer) {
        clearTimeout(this._persistTimer);
        this._persistTimer = null;
      }
      if (this._urlObserver && typeof this._urlObserver.disconnect === 'function') {
        this._urlObserver.disconnect();
      }
      if (this._listener) {
        window.removeEventListener('message', this._listener);
        this._listener = null;
      }
      if (this._clickHandler) {
        document.removeEventListener('click', this._clickHandler, true);
        this._clickHandler = null;
      }

      this.armed = false;
      this.pending = null;
    }

    /* ── upload ── */

    async upload() {
      if (!this.token) {
        this.lastError = 'No recon token configured';
        await this.publishStatus();
        return { success: false, error: this.lastError };
      }

      this.scanDom();
      await this.persistBundle();

      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'RECON_UPLOAD' }, (result) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(result || { success: false, error: 'No response from background worker' });
        });
      });

      if (response.success) {
        this.uploadedAt = new Date().toISOString();
        this.lastError = null;
        logger.log('recon bundle uploaded');
      } else {
        this.lastError = response.error || 'Upload failed';
        logger.warn('recon upload failed:', this.lastError);
      }

      await this.publishStatus();
      return response;
    }
  }

  function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* ── boot ── */

  function boot() {
    const globalKey = '__traverseRecon';
    if (window[globalKey]) return;
    if (!T.netProtocol || !T.createLogger) {
      setTimeout(boot, 200);
      return;
    }

    window[globalKey] = new ReconController();
    window[globalKey].init().catch((error) => logger.error('recon init failed:', error));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
