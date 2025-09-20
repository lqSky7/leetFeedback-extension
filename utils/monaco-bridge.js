(function () {
  'use strict';

  function sanitize(text) {
    if (!text) return '';
    try {
      return String(text)
        .replace(/\u00A0/g, ' ') // NBSP -> space
        .replace(/\u200B/g, '') // zero-width space
        .replace(/\r\n/g, '\n');
    } catch (_) {
      return '';
    }
  }

  function getMonacoCodeAndLanguage() {
    try {
      if (window.monaco && window.monaco.editor) {
        const models = window.monaco.editor.getModels ? window.monaco.editor.getModels() : [];
        if (models && models.length) {
          // Pick the longest model (typically the main editor)
          let best = models[0];
          for (const m of models) {
            try {
              if ((m.getValue()?.length || 0) > (best.getValue()?.length || 0)) best = m;
            } catch (_) {}
          }
          const code = sanitize(best.getValue ? best.getValue() : '');
          // Language API changed across Monaco versions
          let lang = 'text';
          try { lang = best.getLanguageId ? best.getLanguageId() : lang; } catch (_) {}
          try { if (!lang && best._languageIdentifier) lang = best._languageIdentifier.language; } catch (_) {}
          try { if (!lang && best.getModeId) lang = best.getModeId(); } catch (_) {}
          return { code, language: lang || 'text' };
        }
      }
    } catch (e) {
      // fall through to DOM fallback
    }

    // Fallback: DOM scrape (less reliable)
    try {
      const container = document.querySelector('.monaco-editor .view-lines, .view-lines');
      if (container) {
        const lines = container.querySelectorAll('.view-line');
        const code = sanitize(Array.from(lines).map(l => l.textContent || '').join('\n'));
        // Try to infer language from page controls
        let lang = 'text';
        const langBtn = document.querySelector('button[id*="headlessui-listbox-button"]');
        if (langBtn && langBtn.textContent) lang = langBtn.textContent.trim().toLowerCase();
        return { code, language: lang };
      }
    } catch (_) {}

    return { code: '', language: 'text' };
  }

  window.addEventListener('message', (event) => {
    try {
      if (event.source !== window) return;
      const data = event.data || {};
      if (data.source !== 'LeetFeedback' || data.type !== 'LEETFEEDBACK_REQUEST_CODE') return;

      const { code, language } = getMonacoCodeAndLanguage();
      window.postMessage({
        source: 'LeetFeedback',
        type: 'LEETFEEDBACK_CODE',
        requestId: data.requestId,
        code,
        language
      }, '*');
    } catch (_) {
      // no-op
    }
  });

  // Optional: announce readiness
  try {
    window.postMessage({ source: 'LeetFeedback', type: 'LEETFEEDBACK_BRIDGE_READY' }, '*');
  } catch (_) {}
})();
