// Traverse — Monaco editor bridge (page world).
//
// The content script cannot touch the page's `window.monaco`, so this MAIN-world
// script answers code requests over window.postMessage. It is the only way to
// read the editor's contents *before* a submission (network capture only sees
// code the user actually submitted).
//
// Protocol (see platforms/leetcode.js):
//   content -> page: { source: 'LeetFeedback', type: 'LEETFEEDBACK_REQUEST_CODE', requestId }
//   page -> content: { source: 'LeetFeedback', type: 'LEETFEEDBACK_CODE', requestId, code, language }

(function () {
  'use strict';

  const SOURCE = 'LeetFeedback';

  function sanitize(text) {
    if (!text) return '';
    return String(text)
      .replace(/\u00A0/g, ' ') // NBSP -> space
      .replace(/\u200B/g, '') // zero-width space
      .replace(/\r\n/g, '\n');
  }

  /** Read code + language from Monaco, falling back to scraping the rendered lines. */
  function getMonacoCodeAndLanguage() {
    try {
      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels ? window.monaco.editor.getModels() : [];
        if (models && models.length) {
          // The main editor is the longest model; extra models are scratch buffers.
          let best = models[0];
          for (const model of models) {
            try {
              if ((model.getValue() || '').length > (best.getValue() || '').length) best = model;
            } catch (_) {
              /* model disposed mid-iteration */
            }
          }

          const code = sanitize(best.getValue ? best.getValue() : '');

          // The language API has changed across Monaco versions; try each shape.
          let language = '';
          try {
            language = best.getLanguageId ? best.getLanguageId() : '';
          } catch (_) {}
          try {
            if (!language && best._languageIdentifier) language = best._languageIdentifier.language;
          } catch (_) {}
          try {
            if (!language && best.getModeId) language = best.getModeId();
          } catch (_) {}

          return { code, language: language || 'text' };
        }
      }
    } catch (_) {
      /* fall through to the DOM path */
    }

    // Fallback for pages where Monaco is not reachable from `window`.
    try {
      const container = document.querySelector('.monaco-editor .view-lines, .view-lines');
      if (container) {
        const lines = container.querySelectorAll('.view-line');
        const code = sanitize(Array.from(lines).map((line) => line.textContent || '').join('\n'));

        let language = 'text';
        const languageButton = document.querySelector('button[id*="headlessui-listbox-button"]');
        if (languageButton && languageButton.textContent) {
          language = languageButton.textContent.trim().toLowerCase();
        }
        return { code, language };
      }
    } catch (_) {}

    return { code: '', language: 'text' };
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    const data = event.data || {};
    if (data.source !== SOURCE || data.type !== 'LEETFEEDBACK_REQUEST_CODE') return;

    const { code, language } = getMonacoCodeAndLanguage();
    window.postMessage(
      { source: SOURCE, type: 'LEETFEEDBACK_CODE', requestId: data.requestId, code, language },
      '*'
    );
  });
})();
