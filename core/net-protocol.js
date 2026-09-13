// Traverse — page-world <-> content-script network messaging protocol.
//
// The MAIN-world interceptor (page/net-interceptor.js) and the isolated
// content script (core/net-bridge.js, core/recon-controller.js) talk over
// window.postMessage using this envelope. The interceptor file cannot load this
// module (it runs in the page context), so the message type strings are
// duplicated there and MUST stay in sync — change them in both places or
// neither.
//
// There are two independent channels:
//
//   Platform mode — filter-driven, low volume, consumed by NetBridge and the
//   platform adapters. Used by sites with a verified judge API.
//
//   Recon mode — capture-all, high volume, consumed by the recon controller.
//   Used to *discover* the judge API on sites that don't have an adapter yet.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  T.netProtocol = {
    // ── platform mode ──

    // content -> page: configure the interceptor.
    //   { type, filters: [{ url: <regex source>, methods?: ['POST', ...] }], debug: boolean }
    CONFIG: 'TRV_NET_CONFIG',

    // page -> content: ack after CONFIG is applied.
    ACK: 'TRV_NET_ACK',

    // page -> content: one captured network event. A single request emits two:
    //   { type, url, method, phase: 'request',  requestBody }
    //   { type, url, method, phase: 'response', requestBody, status, response }
    // requestBody / response are parsed JSON objects when possible (a plain
    // string for non-JSON bodies under 10 kB, otherwise undefined).
    // The phase literals are duplicated in page/net-interceptor.js and matched
    // by the platform adapters; there is no shared constant because the
    // interceptor cannot load this file.
    EVENT: 'TRV_NET_EVENT',

    // ── recon mode ──

    // content -> page: turn capture-all recording on or off.
    //   {
    //     type, enabled: boolean,
    //     maxBodyChars: number,   // per-body character cap
    //     maxEvents: number,      // hard event budget for the session
    //     excludeUrl: string,     // regex source; the ingest endpoint goes here
    //                             // so uploading a capture isn't itself captured
    //   }
    RECON_CONFIG: 'TRV_RECON_CONFIG',

    // page -> content: ack after RECON_CONFIG is applied.
    RECON_ACK: 'TRV_RECON_ACK',

    // page -> content: one recon capture event. Phases:
    //   'request'      — { seq, url, method, initiator, startedAt, requestHeaders, requestBody, requestTruncated }
    //   'request-body' — { seq, url, method, requestBody, requestTruncated }  (async Request body)
    //   'response'     — { seq, url, method, status, ok, durationMs, responseHeaders, responseBody, responseTruncated }
    //   'overflow'     — { emitted }  the session hit its event budget and stopped
    // Events sharing a `seq` belong to the same request. Bodies are raw strings
    // (not parsed) because the controller may want the exact bytes.
    RECON_EVENT: 'TRV_RECON_EVENT',
  };
})();
