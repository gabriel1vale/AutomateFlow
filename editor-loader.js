/**
 * editor-loader.js
 * Bootstraps Monaco Editor in a Chrome Extension context.
 * Must be loaded as a separate file (not inline) due to MV3 CSP: script-src 'self'.
 */

// === ERROR DISPLAY HELPER ===
function showLoadError(msg, detail) {
  console.error('[AutomateFlow] ' + msg, detail || '');
  var flowName = document.getElementById('flowName');
  if (flowName) flowName.textContent = 'Erro ao carregar editor';
  var container = document.getElementById('monacoContainer');
  if (container) {
    container.innerHTML =
      '<div style="padding:32px;color:#e05252;font-family:Segoe UI,sans-serif;">' +
        '<h2 style="color:#ff6b6b;margin-bottom:12px;">Erro ao carregar o Monaco Editor</h2>' +
        '<p style="color:#ccc;margin-bottom:8px;">' + msg + '</p>' +
        (detail ? '<pre style="color:#aaa;font-size:11px;white-space:pre-wrap;margin-top:8px;padding:12px;background:#1e1e1e;border:1px solid #444;border-radius:4px;max-height:200px;overflow:auto;">' + detail + '</pre>' : '') +
        '<p style="color:#888;margin-top:16px;font-size:12px;">Verifique o console do navegador (F12) para mais detalhes.</p>' +
      '</div>';
  }
  var status = document.getElementById('statusMessage');
  if (status) status.textContent = 'Erro: Monaco nao carregou';
}

// === VERIFY AMD LOADER ===
if (typeof require === 'undefined' || typeof require.config === 'undefined') {
  showLoadError(
    'O AMD loader (loader.js) nao foi carregado corretamente.',
    'A funcao "require" nao esta definida. Verifique se lib/monaco/vs/loader.js existe e esta acessivel.'
  );
} else {
  // Configure Monaco worker URLs for Chrome extension CSP compatibility.
  // Workers must be loaded from local extension files (no blob: URLs allowed by CSP).
  self.MonacoEnvironment = {
    getWorker: function (workerId, label) {
      var workerMap = {
        json: 'lib/monaco/vs/assets/json.worker-DKiEKt88.js',
        css: 'lib/monaco/vs/assets/css.worker-HnVq6Ewq.js',
        scss: 'lib/monaco/vs/assets/css.worker-HnVq6Ewq.js',
        less: 'lib/monaco/vs/assets/css.worker-HnVq6Ewq.js',
        html: 'lib/monaco/vs/assets/html.worker-B51mlPHg.js',
        handlebars: 'lib/monaco/vs/assets/html.worker-B51mlPHg.js',
        razor: 'lib/monaco/vs/assets/html.worker-B51mlPHg.js',
        typescript: 'lib/monaco/vs/assets/ts.worker-CMbG-7ft.js',
        javascript: 'lib/monaco/vs/assets/ts.worker-CMbG-7ft.js'
      };
      var workerPath = workerMap[label] || 'lib/monaco/vs/assets/editor.worker-Be8ye1pW.js';
      console.log('[AutomateFlow] Creating worker for label:', label, '->', workerPath);
      try {
        return new Worker(workerPath, { name: label });
      } catch (e) {
        console.error('[AutomateFlow] Worker creation failed for', label, e);
        try {
          return new Worker(workerPath);
        } catch (e2) {
          console.error('[AutomateFlow] Worker fallback also failed for', label, e2);
          throw e2;
        }
      }
    }
  };

  // Configure AMD loader for Monaco
  require.config({
    paths: { vs: 'lib/monaco/vs' }
  });

  // Global AMD error handler
  require.config({
    onError: function (err) {
      console.error('[AutomateFlow] AMD require error:', err);
      showLoadError(
        'Um modulo do Monaco falhou ao carregar.',
        err && err.message ? err.message : String(err)
      );
    }
  });

  // Loading timeout — if Monaco doesn't load within 15s, show error
  var monacoLoadTimeout = setTimeout(function () {
    if (typeof monaco === 'undefined') {
      showLoadError(
        'Tempo esgotado ao carregar o Monaco Editor (15s).',
        'O require([\'vs/editor/editor.main\']) nao completou a tempo.\n' +
        'Possiveis causas:\n' +
        '- Um arquivo .js do Monaco nao foi encontrado (404)\n' +
        '- CSP esta bloqueando o carregamento de scripts\n' +
        '- Um modulo AMD tem dependencias circulares ou faltantes\n\n' +
        'Abra o DevTools (F12) > Console e Network para verificar erros.'
      );
    }
  }, 15000);

  // Load Monaco then start editor.js
  console.log('[AutomateFlow] Starting Monaco AMD require...');
  require(['vs/editor/editor.main'], function () {
    clearTimeout(monacoLoadTimeout);
    console.log('[AutomateFlow] Monaco loaded successfully. monaco:', typeof monaco);

    var script = document.createElement('script');
    script.src = 'editor.js';
    script.onerror = function () {
      showLoadError(
        'Falha ao carregar editor.js',
        'O arquivo editor.js nao pode ser carregado. Verifique se existe na raiz da extensao.'
      );
    };
    document.body.appendChild(script);
  }, function (err) {
    clearTimeout(monacoLoadTimeout);
    console.error('[AutomateFlow] Monaco require() failed:', err);
    var detail = '';
    if (err && err.requireModules) {
      detail = 'Modulos que falharam: ' + err.requireModules.join(', ');
    }
    if (err && err.message) {
      detail += '\n' + err.message;
    }
    showLoadError('O Monaco Editor falhou ao carregar via AMD require.', detail || String(err));
  });
}
