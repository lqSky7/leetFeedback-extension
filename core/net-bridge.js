// Traverse — NetBridge: the isolated-world side of the network interceptor.
//
// The interceptor itself is a static MAIN-world content script
// (page/net-interceptor.js, declared in manifest.json) that patches
// window.fetch / XMLHttpRequest before any site code runs. NetBridge sends it
// the platform's URL filters and forwards captured traffic to the adapter.

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});

  class NetBridge {
    /**
     * @param {Object} handlers
     * @param {Function} handlers.onEvent - called with one captured network
     *   event: { phase, url, method, requestBody, status?, response? }
     */
    constructor({ onEvent } = {}) {
      this.onEvent = onEvent || null;
      this.ackReceived = false;
      this._listener = null;
    }

    /**
     * Sends the interceptor config and starts listening for captured traffic.
     * @param {Array<{url: string, methods?: string[]}>} filters - URL regex sources
     */
    connect(filters = []) {
      const protocol = T.netProtocol;
      if (!protocol) return;

      this._listener = (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data) return;

        if (data.type === protocol.ACK) {
          this.ackReceived = true;
          return;
        }

        if (data.type === protocol.EVENT && typeof this.onEvent === 'function') {
          this.onEvent({
            phase: data.phase,
            url: data.url,
            method: data.method,
            requestBody: data.requestBody,
            status: data.status,
            response: data.response,
          });
        }
      };
      window.addEventListener('message', this._listener);

      this._sendConfig(filters);

      // The static MAIN-world script is injected at document_start, well
      // before this script runs at document_end — but re-send once after a
      // short delay in case of an unlikely load-order race.
      setTimeout(() => {
        if (!this.ackReceived) this._sendConfig(filters);
      }, 1500);
    }

    _sendConfig(filters) {
      window.postMessage(
        {
          type: T.netProtocol.CONFIG,
          filters,
          debug: T.logger ? T.logger.isDebugMode() : false,
        },
        '*'
      );
    }

    disconnect() {
      if (this._listener) {
        window.removeEventListener('message', this._listener);
        this._listener = null;
      }
    }
  }

  T.NetBridge = NetBridge;
})();
