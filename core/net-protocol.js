// Traverse — page-world <-> content-script network messaging protocol.
//
// The MAIN-world interceptor (page/net-interceptor.js) and the isolated
// content script (core/net-bridge.js) talk over window.postMessage using this
// envelope. The interceptor file cannot load this module (it runs in the page
// context), so the message type strings are duplicated there and MUST stay in
// sync — change them in both places or neither.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  T.netProtocol = {
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
  };
})();
