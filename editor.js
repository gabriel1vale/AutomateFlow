/**
 * editor.js - Main logic for the AutomateFlow JSON Editor (v2.0 - Monaco).
 * Features: Monaco Editor with JSON language, tree view, action explorer,
 *           Monaco diff view, import/export, validation, save to PA,
 *           auto-save to chrome.storage.local with recovery.
 */

(function () {
  'use strict';
  console.log('[AutomateFlow editor.js] Script loaded. monaco available:', typeof monaco !== 'undefined');

  // ===== STATE =====
  let originalJson = null;     // Original JSON string (for diff)
  let originalData = null;     // Original parsed data
  let currentTabId = null;     // Tab ID of the Power Automate page
  let authToken = null;        // Bearer token
  let flowInfo = null;         // { environmentId, flowId }
  let flowApiUrl = null;       // Full API URL for saving
  let lastSavedContent = '';
  let monacoEditor = null;     // Monaco editor instance
  let diffEditor = null;       // Monaco diff editor instance

  // Auto-save state
  let autoSaveTimer = null;
  const AUTO_SAVE_INTERVAL = 30000; // 30 seconds

  // ===== DOM REFERENCES =====
  const flowNameEl = document.getElementById('flowName');
  const flowStateEl = document.getElementById('flowState');
  const statusMessage = document.getElementById('statusMessage');
  const statusPosition = document.getElementById('statusPosition');
  const statusSize = document.getElementById('statusSize');
  const statusValidation = document.getElementById('statusValidation');
  const treeView = document.getElementById('treeView');
  const treeFilter = document.getElementById('treeFilter');
  const actionsList = document.getElementById('actionsList');
  const actionFilter = document.getElementById('actionFilter');
  const actionSearch = document.getElementById('actionSearch');
  const toastContainer = document.getElementById('toastContainer');
  const fileInput = document.getElementById('fileInput');

  // ===== HELPER: get/set editor value =====
  function getEditorValue() {
    return monacoEditor ? monacoEditor.getValue() : '';
  }

  function setEditorValue(value) {
    if (monacoEditor) {
      // Use pushEditOperations so it's undoable
      const fullRange = monacoEditor.getModel().getFullModelRange();
      monacoEditor.getModel().pushEditOperations(
        [],
        [{ range: fullRange, text: value }],
        () => null
      );
    }
  }

  // ===== INIT =====
  async function init() {
    console.log('[AutomateFlow editor.js] init() starting...');

    try {
      // Create Monaco editor
      console.log('[AutomateFlow editor.js] Creating Monaco editor instance...');
      monacoEditor = monaco.editor.create(document.getElementById('monacoContainer'), {
        value: '',
        language: 'json',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 13,
        fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
        minimap: { enabled: true },
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        lineNumbers: 'on',
        renderWhitespace: 'selection',
        tabSize: 2,
        insertSpaces: true,
        formatOnPaste: true,
        folding: true,
        foldingStrategy: 'indentation',
        bracketPairColorization: { enabled: true },
        guides: {
          bracketPairs: true,
          indentation: true
        },
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        cursorSmoothCaretAnimation: 'on',
        padding: { top: 8, bottom: 8 },
        suggest: {
          showWords: false
        },
        quickSuggestions: false
      });
      console.log('[AutomateFlow editor.js] Monaco editor created successfully.');

      // Monaco cursor position tracking
      monacoEditor.onDidChangeCursorPosition((e) => {
        statusPosition.textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
      });

      // Monaco content change tracking
      monacoEditor.onDidChangeModelContent(() => {
        updateStatus();
        validateJson();
        scheduleAutoSave();
      });

      // Override Ctrl+S to save to PA (not browser save dialog)
      monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        confirmAndSave();
      });

      // Load flow data
      console.log('[AutomateFlow editor.js] Loading flow data from chrome.storage.local...');
      const autoSaved = await chrome.storage.local.get('autoSaveDraft');
      const stored = await chrome.storage.local.get('editorData');

      if (stored.editorData) {
        console.log('[AutomateFlow editor.js] editorData found in storage.');
        const { tabId, flowData, token } = stored.editorData;
        currentTabId = tabId;
        authToken = token;

        if (flowData?.data) {
          originalData = flowData.data;
          originalJson = JSON.stringify(originalData, null, 2);
          lastSavedContent = originalJson;

          // Extract info
          const props = originalData.properties || {};
          flowNameEl.textContent = props.displayName || originalData.name || 'Flow sem nome';
          const state = (props.state || '').toLowerCase();
          flowStateEl.textContent = state || '';
          flowStateEl.className = 'flow-badge ' + (state === 'started' ? 'started' : state === 'stopped' ? 'stopped' : 'suspended');

          // Build API URL
          if (flowData.flowInfo) {
            flowInfo = flowData.flowInfo;
          }

          // Try to extract env/flow IDs from multiple sources
          let envId = flowInfo?.environmentId || null;
          let fId = flowInfo?.flowId || null;

          // Fallback: extract from the original API URL that was captured
          if ((!envId || !fId) && flowData.url) {
            const urlEnvMatch = flowData.url.match(/\/environments\/([^/\s?#]+)/i);
            const urlFlowMatch = flowData.url.match(/\/flows\/([0-9a-f-]+)/i);
            if (!envId && urlEnvMatch) envId = urlEnvMatch[1];
            if (!fId && urlFlowMatch) fId = urlFlowMatch[1];
          }

          // Fallback: extract from the flow data itself
          if (!envId && originalData.properties?.environment?.name) {
            envId = originalData.properties.environment.name;
          }
          if (!fId && originalData.name) {
            fId = originalData.name;
          }

          // Update flowInfo with resolved values
          flowInfo = { environmentId: envId, flowId: fId };

          if (envId && fId) {
            flowApiUrl = `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${envId}/flows/${fId}?api-version=2016-11-01`;
          } else if (flowData.url) {
            flowApiUrl = flowData.url;
          }

          // Check for auto-saved draft for this flow
          let contentToLoad = originalJson;
          if (autoSaved.autoSaveDraft && autoSaved.autoSaveDraft.flowId === fId) {
            const draftContent = autoSaved.autoSaveDraft.content;
            if (draftContent && draftContent !== originalJson) {
              const useDraft = await showRecoveryDialog(autoSaved.autoSaveDraft.timestamp);
              if (useDraft) {
                contentToLoad = draftContent;
                toast('Rascunho recuperado', 'success');
              } else {
                // Clear the draft
                chrome.storage.local.remove('autoSaveDraft');
              }
            }
          }

          // Load into Monaco
          monacoEditor.setValue(contentToLoad);
          updateStatus();
          validateJson();
          renderTree();
          renderActions();

          setStatus('Flow carregado com sucesso');
          toast('Flow carregado', 'success');
          console.log('[AutomateFlow editor.js] Flow loaded successfully:', props.displayName || originalData.name);
          if (envId && fId) {
            toast(`Env: ${envId.substring(0, 20)}... | Flow: ${fId.substring(0, 12)}...`, 'info');
          } else {
            toast('Aviso: Nao foi possivel determinar o ambiente ou ID do flow. Salvar pode nao funcionar.', 'warning');
          }
          updateSaveButton();
        } else {
          console.warn('[AutomateFlow editor.js] editorData found but flowData.data is empty/null.');
          flowNameEl.textContent = 'Sem dados do flow';
          setStatus('Nenhum dado de flow encontrado');
          toast('Nenhum dado de flow encontrado. O flow pode nao ter sido capturado corretamente.', 'warning');
        }

        // Clean up
        chrome.storage.local.remove('editorData');
      } else {
        console.warn('[AutomateFlow editor.js] No editorData in storage.');
        flowNameEl.textContent = 'Nenhum dado disponivel';
        setStatus('Nenhum dado disponivel. Abra o popup na pagina do Power Automate.');
        toast('Nenhum dado disponivel. Abra o popup na pagina do Power Automate e capture um flow.', 'error');
      }
    } catch (err) {
      console.error('[AutomateFlow editor.js] init() error:', err);
      flowNameEl.textContent = 'Erro ao carregar';
      setStatus('Erro ao carregar: ' + err.message);
      toast('Erro ao carregar: ' + err.message, 'error');

      // Show a visible error in the editor area if Monaco didn't initialize
      if (!monacoEditor) {
        const container = document.getElementById('monacoContainer');
        if (container) {
          container.innerHTML =
            '<div style="padding:32px;color:#e05252;font-family:Segoe UI,sans-serif;">' +
              '<h2 style="color:#ff6b6b;margin-bottom:12px;">Erro na inicializacao</h2>' +
              '<p style="color:#ccc;">' + err.message + '</p>' +
              '<pre style="color:#aaa;font-size:11px;white-space:pre-wrap;margin-top:12px;padding:12px;background:#1e1e1e;border:1px solid #444;border-radius:4px;">' + err.stack + '</pre>' +
            '</div>';
        }
      }
    }
  }

  // ===== AUTO-SAVE =====
  function scheduleAutoSave() {
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(performAutoSave, AUTO_SAVE_INTERVAL);
  }

  function performAutoSave() {
    const content = getEditorValue();
    if (content && content !== lastSavedContent && flowInfo?.flowId) {
      chrome.storage.local.set({
        autoSaveDraft: {
          flowId: flowInfo.flowId,
          content: content,
          timestamp: Date.now()
        }
      });
    }
  }

  function showRecoveryDialog(timestamp) {
    return new Promise((resolve) => {
      const date = new Date(timestamp);
      const timeStr = date.toLocaleString('pt-BR');

      const overlay = document.createElement('div');
      overlay.id = 'recoveryDialog';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';

      const dialog = document.createElement('div');
      dialog.style.cssText = 'background:#2d2d2d;border:1px solid #555;border-radius:8px;padding:24px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.5);';

      dialog.innerHTML = `
        <h3 style="color:#fff;margin-bottom:8px;font-size:15px;">Rascunho encontrado</h3>
        <p style="color:#aaa;font-size:13px;margin-bottom:20px;line-height:1.5;">
          Foi encontrado um rascunho salvo automaticamente em <strong style="color:#ccc;">${timeStr}</strong>.<br>
          Deseja recuperar este rascunho?
        </p>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="recoveryDiscard" style="background:#444;color:#ccc;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:13px;font-family:inherit;">Descartar</button>
          <button id="recoveryRestore" style="background:#0078d4;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit;">Recuperar Rascunho</button>
        </div>
      `;

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      document.getElementById('recoveryDiscard').addEventListener('click', () => {
        overlay.remove();
        resolve(false);
      });
      document.getElementById('recoveryRestore').addEventListener('click', () => {
        overlay.remove();
        resolve(true);
      });
    });
  }

  // ===== TABS =====
  document.getElementById('tabBar').addEventListener('click', (e) => {
    if (!e.target.classList.contains('tab')) return;
    const tabName = e.target.dataset.tab;

    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

    e.target.classList.add('active');
    document.getElementById('tab-' + tabName).classList.add('active');

    if (tabName === 'editor') {
      // Force Monaco to re-layout when switching back
      setTimeout(() => monacoEditor && monacoEditor.layout(), 0);
    }
    if (tabName === 'tree') renderTree();
    if (tabName === 'actions') renderActions();
    if (tabName === 'diff') renderDiff();
    if (tabName === 'visual') renderFlowVisualization();
    if (tabName === 'connections') renderConnections();
  });

  // ===== STATUS =====
  function updateStatus() {
    const val = getEditorValue();
    const size = new Blob([val]).size;
    statusSize.textContent = formatBytes(size);
  }

  function setStatus(msg) {
    statusMessage.textContent = msg;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  // ===== VALIDATION =====
  function validateJson() {
    const val = getEditorValue();
    try {
      JSON.parse(val);
      statusValidation.textContent = 'JSON valido';
      statusValidation.className = 'valid';
      return true;
    } catch (e) {
      const match = e.message.match(/position\s+(\d+)/i);
      let detail = e.message;
      if (match) {
        const errorPos = parseInt(match[1]);
        const lines = val.substring(0, errorPos).split('\n');
        detail = `Erro na linha ${lines.length}, col ${lines[lines.length - 1].length + 1}`;
      }
      statusValidation.textContent = detail;
      statusValidation.className = 'invalid';
      return false;
    }
  }

  // ===== FORMAT / MINIFY =====
  document.getElementById('btnFormat').addEventListener('click', () => {
    try {
      const data = JSON.parse(getEditorValue());
      setEditorValue(JSON.stringify(data, null, 2));
      updateStatus();
      validateJson();
      toast('JSON formatado', 'success');
    } catch (e) {
      toast('JSON invalido - corrija os erros antes de formatar', 'error');
    }
  });

  document.getElementById('btnMinify').addEventListener('click', () => {
    try {
      const data = JSON.parse(getEditorValue());
      setEditorValue(JSON.stringify(data));
      updateStatus();
      validateJson();
      toast('JSON minificado', 'success');
    } catch (e) {
      toast('JSON invalido - corrija os erros antes de minificar', 'error');
    }
  });

  // ===== VALIDATE BUTTON =====
  document.getElementById('btnValidate').addEventListener('click', () => {
    if (validateJson()) {
      try {
        const data = JSON.parse(getEditorValue());
        const structIssues = validateFlowStructure(data);
        const exprIssues = validateExpressions(getEditorValue(), data);

        // Normalize all issues to strings for display
        const allMessages = [
          ...structIssues,
          ...exprIssues.map(i => i.message)
        ];

        // Set Monaco markers for inline squiggles
        setValidationMarkers(exprIssues);

        if (allMessages.length === 0) {
          toast('JSON valido, estrutura e expressoes corretas', 'success');
        } else {
          const summary = allMessages.length <= 5
            ? allMessages.join('\n')
            : allMessages.slice(0, 5).join('\n') + `\n... e mais ${allMessages.length - 5} aviso(s)`;
          toast('Avisos encontrados:\n' + summary, 'warning');
        }
      } catch (e) {
        toast('JSON valido', 'success');
      }
    } else {
      toast('JSON invalido - veja a barra de status para detalhes', 'error');
    }
  });

  function validateFlowStructure(data) {
    const issues = [];
    const props = data.properties;
    if (!props) {
      issues.push('Faltando "properties"');
      return issues;
    }
    const def = props.definition;
    if (!def) {
      issues.push('Faltando "properties.definition"');
      return issues;
    }
    if (!def.triggers || Object.keys(def.triggers).length === 0) {
      issues.push('Nenhum trigger definido');
    }
    if (!def.actions || Object.keys(def.actions).length === 0) {
      issues.push('Nenhuma action definida');
    }
    if (!def['$schema']) {
      issues.push('Faltando "$schema" na definition');
    }

    // Validate runAfter references
    if (def.actions) {
      const actionNames = new Set(Object.keys(def.actions));
      for (const [name, action] of Object.entries(def.actions)) {
        if (action.runAfter) {
          for (const dep of Object.keys(action.runAfter)) {
            if (!actionNames.has(dep) && !Object.keys(def.triggers || {}).includes(dep)) {
              issues.push(`Action "${name}" referencia "${dep}" em runAfter, mas essa action nao existe`);
            }
          }
        }
      }
    }

    return issues;
  }

  // ===== EXPRESSION VALIDATION (Power Automate WDL) =====
  // Known Power Automate expression functions
  const PA_FUNCTIONS = new Set([
    // String functions
    'concat', 'substring', 'replace', 'toLower', 'toUpper', 'trim', 'length',
    'indexOf', 'lastIndexOf', 'startsWith', 'endsWith', 'contains', 'split',
    'slice', 'join', 'nthIndexOf', 'chunk',
    // Collection functions
    'first', 'last', 'take', 'skip', 'union', 'intersection', 'except',
    'empty', 'item', 'items', 'createArray', 'range', 'sort', 'reverse',
    // Logical functions
    'if', 'equals', 'and', 'or', 'not', 'less', 'lessOrEquals',
    'greater', 'greaterOrEquals',
    // Conversion functions
    'int', 'float', 'string', 'bool', 'json', 'xml', 'array',
    'base64', 'base64ToBinary', 'base64ToString', 'binary',
    'dataUri', 'dataUriToBinary', 'dataUriToString', 'uriComponent',
    'uriComponentToString', 'decodeBase64', 'encodeUriComponent',
    'decodeUriComponent',
    // Math functions
    'add', 'sub', 'mul', 'div', 'mod', 'min', 'max', 'rand',
    // Date/Time functions
    'utcNow', 'addDays', 'addHours', 'addMinutes', 'addSeconds',
    'addToTime', 'subtractFromTime', 'convertFromUtc', 'convertToUtc',
    'convertTimeZone', 'dayOfWeek', 'dayOfMonth', 'dayOfYear',
    'startOfDay', 'startOfMonth', 'startOfHour', 'formatDateTime',
    'parseDateTime', 'ticks', 'getPastTime', 'getFutureTime',
    'dateDifference',
    // Workflow functions
    'trigger', 'triggerBody', 'triggerOutputs', 'triggerFormDataValue',
    'triggerFormDataMultiValues', 'triggerMultipartBody',
    'body', 'actions', 'action', 'actionBody', 'actionOutputs',
    'parameters', 'result', 'outputs', 'workflow',
    // URI/Reference functions
    'uriHost', 'uriPath', 'uriPort', 'uriScheme', 'uriQuery',
    'uriPathAndQuery',
    // Manipulation functions
    'coalesce', 'setProperty', 'removeProperty', 'addProperty',
    'xpath', 'formDataValue', 'formDataMultiValues',
    // Variables
    'variables',
    // Environment
    'environment',
    // Misc
    'guid', 'null', 'true', 'false', 'noop',
    'encodeURIComponent', 'decodeURIComponent',
    // Connector helpers
    'outputs', 'body', 'items', 'iterationIndexes'
  ]);

  function validateExpressions(jsonText, data) {
    const issues = [];

    // Find all Power Automate expressions: @{...} or plain @functionName(...)
    // They appear as string values in JSON
    const exprRegex = /@\{([^}]+)\}|@([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;

    let match;
    while ((match = exprRegex.exec(jsonText)) !== null) {
      const expr = match[1] || match[2];
      const position = match.index;

      if (match[1]) {
        // @{expression} — validate inner expression
        const innerIssues = validateExpressionInner(match[1], position);
        issues.push(...innerIssues);
      } else if (match[2]) {
        // @functionName( — validate function name
        const funcName = match[2];
        if (!PA_FUNCTIONS.has(funcName) && !PA_FUNCTIONS.has(funcName.toLowerCase())) {
          const lines = jsonText.substring(0, position).split('\n');
          const lineNum = lines.length;
          issues.push({
            message: `Funcao desconhecida: "${funcName}" (linha ${lineNum})`,
            line: lineNum,
            col: lines[lines.length - 1].length + 1,
            endCol: lines[lines.length - 1].length + 1 + funcName.length + 1,
            severity: 'warning'
          });
        }
      }
    }

    // Also check for common expression mistakes in string values
    const commonErrors = validateCommonExpressionErrors(data);
    issues.push(...commonErrors);

    return issues;
  }

  function validateExpressionInner(expr, basePosition) {
    const issues = [];

    // Check for balanced parentheses
    let depth = 0;
    for (let i = 0; i < expr.length; i++) {
      if (expr[i] === '(') depth++;
      if (expr[i] === ')') depth--;
      if (depth < 0) {
        issues.push({
          message: `Parentese de fechamento sem abertura na expressao: @{${expr.substring(0, 30)}...}`,
          severity: 'error'
        });
        break;
      }
    }
    if (depth > 0) {
      issues.push({
        message: `${depth} parentese(s) nao fechado(s) na expressao: @{${expr.substring(0, 30)}...}`,
        severity: 'error'
      });
    }

    // Check for balanced brackets
    let bracketDepth = 0;
    for (let i = 0; i < expr.length; i++) {
      if (expr[i] === '[') bracketDepth++;
      if (expr[i] === ']') bracketDepth--;
      if (bracketDepth < 0) {
        issues.push({
          message: `Colchete de fechamento sem abertura na expressao: @{${expr.substring(0, 30)}...}`,
          severity: 'error'
        });
        break;
      }
    }
    if (bracketDepth > 0) {
      issues.push({
        message: `${bracketDepth} colchete(s) nao fechado(s) na expressao: @{${expr.substring(0, 30)}...}`,
        severity: 'error'
      });
    }

    // Check for balanced single quotes
    let inQuote = false;
    for (let i = 0; i < expr.length; i++) {
      if (expr[i] === "'") inQuote = !inQuote;
    }
    if (inQuote) {
      issues.push({
        message: `Aspas simples nao fechadas na expressao: @{${expr.substring(0, 30)}...}`,
        severity: 'error'
      });
    }

    // Extract and validate function names within the expression
    const funcCallRegex = /([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
    let funcMatch;
    while ((funcMatch = funcCallRegex.exec(expr)) !== null) {
      const funcName = funcMatch[1];
      if (!PA_FUNCTIONS.has(funcName) && !PA_FUNCTIONS.has(funcName.toLowerCase())) {
        issues.push({
          message: `Funcao desconhecida na expressao: "${funcName}"`,
          severity: 'warning'
        });
      }
    }

    return issues;
  }

  function validateCommonExpressionErrors(data) {
    const issues = [];
    const def = data?.properties?.definition;
    if (!def) return issues;

    // Check actions for common expression issues
    if (def.actions) {
      checkActionsForExpressionIssues(def.actions, '', issues);
    }

    return issues;
  }

  function checkActionsForExpressionIssues(actions, prefix, issues) {
    for (const [name, action] of Object.entries(actions)) {
      const fullName = prefix ? `${prefix} > ${name}` : name;

      // Check for body() references to non-existent actions
      const actionJson = JSON.stringify(action);
      const bodyRefRegex = /body\('([^']+)'\)/g;
      let bodyMatch;
      while ((bodyMatch = bodyRefRegex.exec(actionJson)) !== null) {
        const referencedAction = bodyMatch[1];
        // Check if this action exists (we check the parent actions set)
        if (actions && !actions[referencedAction]) {
          issues.push({
            message: `"${fullName}": body('${referencedAction}') pode referenciar action inexistente no mesmo escopo`,
            severity: 'info'
          });
        }
      }

      // Check for outputs() references
      const outputsRefRegex = /outputs\('([^']+)'\)/g;
      let outputsMatch;
      while ((outputsMatch = outputsRefRegex.exec(actionJson)) !== null) {
        const referencedAction = outputsMatch[1];
        if (actions && !actions[referencedAction]) {
          issues.push({
            message: `"${fullName}": outputs('${referencedAction}') pode referenciar action inexistente no mesmo escopo`,
            severity: 'info'
          });
        }
      }

      // Recurse into nested actions
      if (action.actions) checkActionsForExpressionIssues(action.actions, fullName, issues);
      if (action.else?.actions) checkActionsForExpressionIssues(action.else.actions, fullName + ' (Else)', issues);
      if (action.cases) {
        for (const [caseName, caseData] of Object.entries(action.cases)) {
          if (caseData.actions) checkActionsForExpressionIssues(caseData.actions, fullName + ` [${caseName}]`, issues);
        }
      }
      if (action.default?.actions) checkActionsForExpressionIssues(action.default.actions, fullName + ' [Default]', issues);
    }
  }

  function setValidationMarkers(exprIssues) {
    if (!monacoEditor) return;
    const model = monacoEditor.getModel();
    if (!model) return;

    const markers = exprIssues
      .filter(issue => issue.line)
      .map(issue => ({
        severity: issue.severity === 'error'
          ? monaco.MarkerSeverity.Error
          : issue.severity === 'warning'
            ? monaco.MarkerSeverity.Warning
            : monaco.MarkerSeverity.Info,
        message: issue.message,
        startLineNumber: issue.line,
        startColumn: issue.col || 1,
        endLineNumber: issue.line,
        endColumn: issue.endCol || (issue.col ? issue.col + 20 : 80)
      }));

    monaco.editor.setModelMarkers(model, 'expression-validator', markers);
  }
  document.getElementById('btnImport').addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        setEditorValue(JSON.stringify(data, null, 2));
        updateStatus();
        validateJson();
        renderTree();
        renderActions();
        toast('JSON importado de ' + file.name, 'success');
      } catch (err) {
        toast('Arquivo nao contem JSON valido', 'error');
      }
    };
    reader.readAsText(file);
    fileInput.value = '';
  });

  document.getElementById('btnExport').addEventListener('click', () => {
    const json = getEditorValue();
    let filename = 'flow.json';
    try {
      const data = JSON.parse(json);
      const name = data.properties?.displayName || data.name || 'flow';
      filename = name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
    } catch (e) { /* use default */ }

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast('JSON exportado como ' + filename, 'success');
  });

  document.getElementById('btnCopy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(getEditorValue());
    toast('JSON copiado para a area de transferencia', 'success');
  });

  // ===== SAVE TO POWER AUTOMATE =====
  document.getElementById('btnSave').addEventListener('click', confirmAndSave);

  function confirmAndSave() {
    if (!flowApiUrl) {
      toast('URL da API nao disponivel. Nao e possivel salvar.', 'error');
      return;
    }
    if (flowApiUrl.includes('/null/') || flowApiUrl.includes('/undefined/')) {
      toast('ID do ambiente ou flow nao detectado corretamente. Feche o editor, recarregue a pagina do PA e capture o flow novamente.', 'error');
      return;
    }
    if (!authToken) {
      toast('Token de autenticacao nao disponivel. Recarregue a pagina do PA e capture novamente.', 'error');
      return;
    }
    if (!validateJson()) {
      toast('Corrija os erros no JSON antes de salvar', 'error');
      return;
    }
    if (getEditorValue() === lastSavedContent) {
      toast('Nenhuma alteracao para salvar', 'info');
      return;
    }

    // Show confirmation dialog
    showConfirmDialog(
      'Salvar alteracoes no Power Automate?',
      'As alteracoes serao enviadas diretamente para o flow. Esta acao pode afetar o flow em producao.',
      () => saveFlow()
    );
  }

  function showConfirmDialog(title, message, onConfirm) {
    // Remove any existing dialog
    const existing = document.getElementById('confirmDialog');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'confirmDialog';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#2d2d2d;border:1px solid #555;border-radius:8px;padding:24px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.5);';

    dialog.innerHTML = `
      <h3 style="color:#fff;margin-bottom:8px;font-size:15px;">${title}</h3>
      <p style="color:#aaa;font-size:13px;margin-bottom:20px;line-height:1.5;">${message}</p>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="confirmCancel" style="background:#444;color:#ccc;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:13px;font-family:inherit;">Cancelar</button>
        <button id="confirmOk" style="background:#0078d4;color:#fff;border:none;padding:8px 16px;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit;">Confirmar e Salvar</button>
      </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    document.getElementById('confirmCancel').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.getElementById('confirmOk').addEventListener('click', () => {
      overlay.remove();
      onConfirm();
    });
  }

  async function saveFlow() {
    try {
      const editedData = JSON.parse(getEditorValue());
      const payload = { properties: editedData.properties };

      setStatus('Salvando...');
      const btnSave = document.getElementById('btnSave');
      btnSave.disabled = true;
      btnSave.textContent = 'Salvando...';

      if (currentTabId) {
        chrome.runtime.sendMessage({
          type: 'SAVE_FLOW_FROM_EDITOR',
          tabId: currentTabId,
          url: flowApiUrl,
          flowData: payload,
          token: authToken
        });

        const resultHandler = (msg) => {
          if (msg.type === 'EDITOR_SAVE_RESULT') {
            chrome.runtime.onMessage.removeListener(resultHandler);
            btnSave.disabled = false;
            btnSave.innerHTML = '&#128190; Salvar';
            if (msg.success) {
              lastSavedContent = getEditorValue();
              originalJson = getEditorValue();
              originalData = editedData;
              // Clear auto-save draft on successful save
              chrome.storage.local.remove('autoSaveDraft');
              setStatus('Salvo com sucesso');
              toast('Flow salvo no Power Automate! Recarregue a pagina do PA para ver as alteracoes.', 'success');
            } else {
              setStatus('Erro ao salvar');
              let errorDisplay = msg.error || 'desconhecido';
              if (errorDisplay.toLowerCase().includes('auth') || errorDisplay.includes('401') || errorDisplay.includes('403')) {
                errorDisplay += '\n\nDica: Recarregue a pagina do Power Automate, interaja com o designer e tente salvar novamente.';
              }
              toast('Erro ao salvar: ' + errorDisplay, 'error');
            }
          }
        };
        chrome.runtime.onMessage.addListener(resultHandler);

        setTimeout(() => {
          chrome.runtime.onMessage.removeListener(resultHandler);
          btnSave.disabled = false;
          btnSave.innerHTML = '&#128190; Salvar';
        }, 30000);
      } else {
        btnSave.disabled = false;
        btnSave.innerHTML = '&#128190; Salvar';
        toast('Tab do Power Automate nao encontrada', 'error');
      }
    } catch (e) {
      const btnSave = document.getElementById('btnSave');
      btnSave.disabled = false;
      btnSave.innerHTML = '&#128190; Salvar';
      toast('Erro: ' + e.message, 'error');
    }
  }

  // Update save button state based on token availability
  function updateSaveButton() {
    const btn = document.getElementById('btnSave');
    if (!authToken || !flowApiUrl) {
      btn.title = 'Token ou URL da API nao disponivel';
      btn.style.opacity = '0.6';
    } else {
      btn.title = 'Salvar no Power Automate (Ctrl+S)';
      btn.style.opacity = '1';
    }
  }

  // ===== TREE VIEW =====
  function renderTree() {
    try {
      const data = JSON.parse(getEditorValue());
      treeView.innerHTML = '';
      const root = buildTreeNode('root', data, true);
      treeView.appendChild(root);
    } catch (e) {
      treeView.innerHTML = '<div style="padding:20px;color:#e05252;">JSON invalido - corrija os erros no editor para ver a arvore.</div>';
    }
  }

  function buildTreeNode(key, value, expanded = false) {
    const container = document.createElement('div');
    container.className = 'tree-node';

    const header = document.createElement('div');
    header.className = 'tree-node-header';

    const type = getType(value);
    const isExpandable = type === 'object' || type === 'array';

    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle';
    toggle.textContent = isExpandable ? (expanded ? '\u25BC' : '\u25B6') : ' ';

    const keySpan = document.createElement('span');
    keySpan.className = 'tree-key';
    keySpan.textContent = key;

    const separator = document.createElement('span');
    separator.className = 'tree-separator';
    separator.textContent = ': ';

    header.appendChild(toggle);
    header.appendChild(keySpan);
    header.appendChild(separator);

    if (isExpandable) {
      const typeSpan = document.createElement('span');
      typeSpan.className = 'tree-type';
      if (type === 'array') {
        typeSpan.textContent = `Array[${value.length}]`;
      } else {
        typeSpan.textContent = `Object{${Object.keys(value).length}}`;
      }
      header.appendChild(typeSpan);

      const children = document.createElement('div');
      children.className = 'tree-children' + (expanded ? '' : ' collapsed');

      if (type === 'array') {
        value.forEach((item, idx) => {
          children.appendChild(buildTreeNode(idx, item, false));
        });
      } else {
        for (const [k, v] of Object.entries(value)) {
          children.appendChild(buildTreeNode(k, v, false));
        }
      }

      header.addEventListener('click', () => {
        children.classList.toggle('collapsed');
        toggle.textContent = children.classList.contains('collapsed') ? '\u25B6' : '\u25BC';
      });

      container.appendChild(header);
      container.appendChild(children);
    } else {
      const valueSpan = document.createElement('span');
      valueSpan.className = 'tree-value ' + type;
      if (type === 'string') {
        const display = value.length > 100 ? value.substring(0, 100) + '...' : value;
        valueSpan.textContent = `"${display}"`;
      } else {
        valueSpan.textContent = String(value);
      }
      header.appendChild(valueSpan);
      container.appendChild(header);
    }

    return container;
  }

  function getType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  // Tree filter
  treeFilter.addEventListener('input', () => {
    const query = treeFilter.value.toLowerCase();
    const headers = treeView.querySelectorAll('.tree-node-header');
    headers.forEach(h => {
      const key = h.querySelector('.tree-key')?.textContent?.toLowerCase() || '';
      if (query && key.includes(query)) {
        h.classList.add('matched');
        // Expand parents
        let parent = h.parentElement;
        while (parent) {
          const children = parent.querySelector('.tree-children');
          if (children) children.classList.remove('collapsed');
          const tog = parent.querySelector('.tree-toggle');
          if (tog) tog.textContent = '\u25BC';
          parent = parent.parentElement?.closest('.tree-node');
        }
      } else {
        h.classList.remove('matched');
      }
    });
  });

  document.getElementById('btnExpandAll').addEventListener('click', () => {
    treeView.querySelectorAll('.tree-children').forEach(c => c.classList.remove('collapsed'));
    treeView.querySelectorAll('.tree-toggle').forEach(t => { if (t.textContent.trim()) t.textContent = '\u25BC'; });
  });

  document.getElementById('btnCollapseAll').addEventListener('click', () => {
    treeView.querySelectorAll('.tree-children').forEach(c => c.classList.add('collapsed'));
    treeView.querySelectorAll('.tree-toggle').forEach(t => { if (t.textContent.trim()) t.textContent = '\u25B6'; });
  });

  // ===== ACTIONS VIEW =====
  function renderActions() {
    try {
      const data = JSON.parse(getEditorValue());
      const definition = data.properties?.definition;
      if (!definition) {
        actionsList.innerHTML = '<div style="padding:20px;color:#888;">Nenhuma definition encontrada no flow.</div>';
        return;
      }

      const filter = actionFilter.value;
      const search = actionSearch.value.toLowerCase();
      let items = [];

      // Add triggers
      if (definition.triggers && (filter === 'all' || filter === 'triggers')) {
        for (const [name, trigger] of Object.entries(definition.triggers)) {
          if (search && !name.toLowerCase().includes(search) && !trigger.type?.toLowerCase().includes(search)) continue;
          items.push({ name, data: trigger, category: 'trigger' });
        }
      }

      // Add actions
      if (definition.actions) {
        const actions = flattenActions(definition.actions, '');
        for (const { name, action, depth } of actions) {
          const category = getActionCategory(action);
          if (filter !== 'all' && filter !== category + 's') continue;
          if (search && !name.toLowerCase().includes(search) && !action.type?.toLowerCase().includes(search)) continue;
          items.push({ name, data: action, category, depth });
        }
      }

      if (items.length === 0) {
        actionsList.innerHTML = '<div style="padding:20px;color:#888;">Nenhuma acao encontrada.</div>';
        return;
      }

      actionsList.innerHTML = '';
      for (const item of items) {
        actionsList.appendChild(createActionCard(item));
      }
    } catch (e) {
      actionsList.innerHTML = '<div style="padding:20px;color:#e05252;">JSON invalido.</div>';
    }
  }

  function flattenActions(actions, prefix, depth = 0) {
    const result = [];
    for (const [name, action] of Object.entries(actions)) {
      const fullName = prefix ? `${prefix} > ${name}` : name;
      result.push({ name: fullName, action, depth });

      // Recurse into scopes, conditions, loops
      if (action.actions) {
        result.push(...flattenActions(action.actions, fullName, depth + 1));
      }
      if (action.else?.actions) {
        result.push(...flattenActions(action.else.actions, fullName + ' (Else)', depth + 1));
      }
      if (action.cases) {
        for (const [caseName, caseData] of Object.entries(action.cases)) {
          if (caseData.actions) {
            result.push(...flattenActions(caseData.actions, fullName + ` [${caseName}]`, depth + 1));
          }
        }
      }
      if (action.default?.actions) {
        result.push(...flattenActions(action.default.actions, fullName + ' [Default]', depth + 1));
      }
    }
    return result;
  }

  function getActionCategory(action) {
    const type = (action.type || '').toLowerCase();
    if (['if', 'switch'].includes(type)) return 'condition';
    if (['foreach', 'until'].includes(type)) return 'loop';
    if (['scope'].includes(type)) return 'scope';
    return 'action';
  }

  function createActionCard(item) {
    const card = document.createElement('div');
    card.className = 'action-card';
    if (item.depth) {
      card.style.marginLeft = (item.depth * 16) + 'px';
    }

    const iconClass = item.category;
    const iconLetter = item.category === 'trigger' ? 'T' :
                       item.category === 'condition' ? '?' :
                       item.category === 'loop' ? '\u21BB' :
                       item.category === 'scope' ? 'S' : 'A';

    card.innerHTML = `
      <div class="action-card-header">
        <div class="action-icon ${iconClass}">${iconLetter}</div>
        <span class="action-card-name">${escapeHtml(item.name)}</span>
        <span class="action-card-type">${escapeHtml(item.data.type || '---')}</span>
        <span class="action-card-toggle">\u25B6</span>
      </div>
      <div class="action-card-body">
        <pre>${escapeHtml(JSON.stringify(item.data, null, 2))}</pre>
        <div class="action-card-actions">
          <button class="toolbar-btn copy-action-btn">Copiar JSON</button>
          <button class="toolbar-btn goto-action-btn">Ir para no Editor</button>
        </div>
      </div>
    `;

    const header = card.querySelector('.action-card-header');
    header.addEventListener('click', () => {
      card.classList.toggle('expanded');
    });

    card.querySelector('.copy-action-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(JSON.stringify(item.data, null, 2));
      toast('JSON da acao copiado', 'success');
    });

    card.querySelector('.goto-action-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      // Find the action name in the editor and navigate to it
      const simpleName = item.name.split(' > ').pop().split(' [')[0].split(' (')[0];
      const searchText = `"${simpleName}"`;
      const content = getEditorValue();
      const idx = content.indexOf(searchText);
      if (idx >= 0) {
        // Switch to editor tab
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-tab="editor"]').classList.add('active');
        document.getElementById('tab-editor').classList.add('active');

        // Use Monaco to navigate to position
        const linesBefore = content.substring(0, idx).split('\n');
        const lineNumber = linesBefore.length;
        const column = linesBefore[linesBefore.length - 1].length + 1;

        setTimeout(() => {
          monacoEditor.layout();
          monacoEditor.revealLineInCenter(lineNumber);
          monacoEditor.setSelection(new monaco.Range(
            lineNumber, column,
            lineNumber, column + searchText.length
          ));
          monacoEditor.focus();
        }, 50);
      }
    });

    return card;
  }

  actionFilter.addEventListener('change', renderActions);
  actionSearch.addEventListener('input', renderActions);

  // ===== DIFF VIEW (Monaco Diff Editor) =====
  let diffOriginalModel = null;
  let diffModifiedModel = null;

  function renderDiff() {
    if (!originalJson) {
      return;
    }

    const container = document.getElementById('monacoDiffContainer');

    // Dispose previous diff editor and models if they exist
    if (diffEditor) {
      diffEditor.dispose();
      diffEditor = null;
    }
    if (diffOriginalModel) {
      diffOriginalModel.dispose();
      diffOriginalModel = null;
    }
    if (diffModifiedModel) {
      diffModifiedModel.dispose();
      diffModifiedModel = null;
    }

    diffEditor = monaco.editor.createDiffEditor(container, {
      theme: 'vs-dark',
      automaticLayout: true,
      readOnly: true,
      fontSize: 13,
      fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
      renderSideBySide: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      lineNumbers: 'on',
      folding: true,
      originalEditable: false,
      padding: { top: 8, bottom: 8 }
    });

    diffOriginalModel = monaco.editor.createModel(originalJson, 'json');
    diffModifiedModel = monaco.editor.createModel(getEditorValue(), 'json');

    diffEditor.setModel({
      original: diffOriginalModel,
      modified: diffModifiedModel
    });
  }

  document.getElementById('btnRefreshDiff').addEventListener('click', renderDiff);

  // ===== KEYBOARD SHORTCUTS (global, non-Monaco) =====
  document.addEventListener('keydown', (e) => {
    // Ctrl+S = Save (when focus is not in Monaco, Monaco handles its own)
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      confirmAndSave();
    }
    // Escape = close dialogs
    if (e.key === 'Escape') {
      const dialog = document.getElementById('confirmDialog');
      if (dialog) dialog.remove();
    }
  });

  // ===== TOAST =====
  function toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    toastContainer.appendChild(el);

    setTimeout(() => {
      el.classList.add('toast-exit');
      setTimeout(() => el.remove(), 300);
    }, 4000);
  }

  // ===== CONNECTION REFERENCES PANEL =====
  function renderConnections() {
    const connectionsList = document.getElementById('connectionsList');
    try {
      const data = JSON.parse(getEditorValue());
      const connRefs = data.properties?.connectionReferences;
      const connParams = data.properties?.definition?.parameters;

      if (!connRefs && !connParams) {
        connectionsList.innerHTML = '<div class="connections-empty">Nenhuma conexao encontrada neste flow.</div>';
        return;
      }

      connectionsList.innerHTML = '';

      // Connection References
      if (connRefs && Object.keys(connRefs).length > 0) {
        const section = document.createElement('div');
        section.className = 'connections-section';
        section.innerHTML = '<h3 class="connections-section-title">Referencia de Conexoes</h3>';

        for (const [refName, ref] of Object.entries(connRefs)) {
          const card = document.createElement('div');
          card.className = 'connection-card';

          const connId = ref.connectionName || ref.connection?.connectionId || '---';
          const apiId = ref.api?.name || ref.id || '---';
          const displayName = ref.displayName || refName;

          // Extract connector name from API ID
          let connectorName = apiId;
          const apiMatch = apiId.match(/\/apis\/(.+)$/);
          if (apiMatch) connectorName = apiMatch[1];

          card.innerHTML = `
            <div class="connection-card-header">
              <div class="connection-icon">${getConnectorIcon(connectorName)}</div>
              <div class="connection-card-info">
                <span class="connection-card-name">${escapeHtml(displayName)}</span>
                <span class="connection-card-connector">${escapeHtml(connectorName)}</span>
              </div>
            </div>
            <div class="connection-card-details">
              <div class="connection-detail-row">
                <span class="connection-detail-label">Referencia</span>
                <span class="connection-detail-value">${escapeHtml(refName)}</span>
              </div>
              <div class="connection-detail-row">
                <span class="connection-detail-label">Conexao ID</span>
                <span class="connection-detail-value">${escapeHtml(typeof connId === 'string' ? connId : JSON.stringify(connId))}</span>
              </div>
              <div class="connection-detail-row">
                <span class="connection-detail-label">API</span>
                <span class="connection-detail-value">${escapeHtml(apiId)}</span>
              </div>
            </div>
          `;

          // Toggle details on click
          const header = card.querySelector('.connection-card-header');
          header.addEventListener('click', () => {
            card.classList.toggle('expanded');
          });

          section.appendChild(card);
        }

        connectionsList.appendChild(section);
      }

      // Definition parameters (connection parameters like $connections)
      if (connParams) {
        const connParam = connParams['$connections'];
        if (connParam && connParam.defaultValue) {
          const section = document.createElement('div');
          section.className = 'connections-section';
          section.innerHTML = '<h3 class="connections-section-title">Parametros de Conexao ($connections)</h3>';

          for (const [paramName, paramData] of Object.entries(connParam.defaultValue)) {
            const card = document.createElement('div');
            card.className = 'connection-card';

            const connId = paramData.connectionId || '---';
            const connName = paramData.connectionName || paramName;
            const connIdShort = typeof connId === 'string' && connId.length > 50
              ? connId.substring(connId.lastIndexOf('/') + 1)
              : connId;

            card.innerHTML = `
              <div class="connection-card-header">
                <div class="connection-icon">${getConnectorIcon(paramName)}</div>
                <div class="connection-card-info">
                  <span class="connection-card-name">${escapeHtml(connName)}</span>
                  <span class="connection-card-connector">${escapeHtml(paramName)}</span>
                </div>
              </div>
              <div class="connection-card-details">
                <div class="connection-detail-row">
                  <span class="connection-detail-label">Connection ID</span>
                  <span class="connection-detail-value">${escapeHtml(String(connIdShort))}</span>
                </div>
                <div class="connection-detail-row">
                  <span class="connection-detail-label">ID Completo</span>
                  <span class="connection-detail-value" style="word-break:break-all;font-size:10px;">${escapeHtml(String(connId))}</span>
                </div>
              </div>
            `;

            const header = card.querySelector('.connection-card-header');
            header.addEventListener('click', () => {
              card.classList.toggle('expanded');
            });

            section.appendChild(card);
          }

          connectionsList.appendChild(section);
        }
      }

      if (connectionsList.children.length === 0) {
        connectionsList.innerHTML = '<div class="connections-empty">Nenhuma conexao encontrada neste flow.</div>';
      }

    } catch (e) {
      connectionsList.innerHTML = '<div class="connections-empty" style="color:#e05252;">JSON invalido - corrija os erros para ver as conexoes.</div>';
    }
  }

  function getConnectorIcon(connectorName) {
    const name = (connectorName || '').toLowerCase();
    if (name.includes('sharepoint')) return 'SP';
    if (name.includes('outlook') || name.includes('office365')) return 'OL';
    if (name.includes('teams')) return 'TM';
    if (name.includes('onedrive')) return 'OD';
    if (name.includes('excel')) return 'XL';
    if (name.includes('sql') || name.includes('azuresql')) return 'SQ';
    if (name.includes('http')) return 'HT';
    if (name.includes('twitter') || name.includes('x')) return 'TW';
    if (name.includes('slack')) return 'SL';
    if (name.includes('dynamicscrm') || name.includes('commondataservice') || name.includes('dataverse')) return 'DV';
    if (name.includes('azureblob') || name.includes('azurestorage')) return 'AB';
    if (name.includes('cognitiveservices') || name.includes('openai')) return 'AI';
    if (name.includes('keyvault')) return 'KV';
    if (name.includes('approval')) return 'AP';
    if (name.includes('notification')) return 'NT';
    return 'CN';
  }

  document.getElementById('btnRefreshConnections').addEventListener('click', renderConnections);

  // ===== FLOW VISUALIZATION (SVG) =====
  let visualZoom = 1;
  const NODE_W = 220;
  const NODE_H = 56;
  const NODE_GAP_X = 40;
  const NODE_GAP_Y = 80;
  const BRANCH_GAP_X = 30;

  function renderFlowVisualization() {
    try {
      const data = JSON.parse(getEditorValue());
      const definition = data.properties?.definition;
      if (!definition) {
        showVisualError('Nenhuma definition encontrada no flow.');
        return;
      }
      drawFlow(definition);
    } catch (e) {
      showVisualError('JSON invalido - corrija os erros no editor.');
    }
  }

  function showVisualError(msg) {
    const svg = document.getElementById('flowSvg');
    svg.innerHTML = `<text x="20" y="40" fill="#e05252" font-size="14" font-family="Segoe UI, sans-serif">${msg}</text>`;
    svg.setAttribute('width', '600');
    svg.setAttribute('height', '80');
  }

  function drawFlow(definition) {
    const svg = document.getElementById('flowSvg');
    svg.innerHTML = '';

    // Build a linear list of flow nodes from triggers + actions
    const nodes = [];

    // Add triggers
    if (definition.triggers) {
      for (const [name, trigger] of Object.entries(definition.triggers)) {
        nodes.push({
          id: name,
          label: name,
          type: 'trigger',
          actionType: trigger.type || 'Trigger',
          data: trigger,
          children: [],
          branches: null
        });
      }
    }

    // Build action dependency graph for ordering
    if (definition.actions) {
      const orderedActions = topologicalSortActions(definition.actions);
      for (const name of orderedActions) {
        const action = definition.actions[name];
        const node = buildVisualNode(name, action);
        nodes.push(node);
      }
    }

    // Layout: vertical top-down flow
    const layout = layoutNodes(nodes, 0, 0);

    // Set SVG size
    const totalW = Math.max(layout.width + 60, 400);
    const totalH = Math.max(layout.height + 60, 200);
    svg.setAttribute('width', totalW * visualZoom);
    svg.setAttribute('height', totalH * visualZoom);
    svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);

    // Draw
    const g = createSvgElement('g');
    g.setAttribute('transform', `translate(30, 30)`);
    drawNodes(g, layout.items, layout.width);
    svg.appendChild(g);
  }

  function buildVisualNode(name, action) {
    const type = (action.type || '').toLowerCase();
    const node = {
      id: name,
      label: name,
      type: 'action',
      actionType: action.type || 'Action',
      data: action,
      children: [],
      branches: null
    };

    if (type === 'if') {
      node.type = 'condition';
      node.branches = [];
      // True branch
      const trueBranch = { label: 'Sim', children: [] };
      if (action.actions) {
        for (const [n, a] of Object.entries(action.actions)) {
          trueBranch.children.push(buildVisualNode(n, a));
        }
      }
      node.branches.push(trueBranch);
      // False branch
      const falseBranch = { label: 'Nao', children: [] };
      if (action.else?.actions) {
        for (const [n, a] of Object.entries(action.else.actions)) {
          falseBranch.children.push(buildVisualNode(n, a));
        }
      }
      node.branches.push(falseBranch);
    } else if (type === 'switch') {
      node.type = 'condition';
      node.branches = [];
      if (action.cases) {
        for (const [caseName, caseData] of Object.entries(action.cases)) {
          const branch = { label: caseName, children: [] };
          if (caseData.actions) {
            for (const [n, a] of Object.entries(caseData.actions)) {
              branch.children.push(buildVisualNode(n, a));
            }
          }
          node.branches.push(branch);
        }
      }
      if (action.default?.actions) {
        const defaultBranch = { label: 'Default', children: [] };
        for (const [n, a] of Object.entries(action.default.actions)) {
          defaultBranch.children.push(buildVisualNode(n, a));
        }
        node.branches.push(defaultBranch);
      }
    } else if (type === 'foreach' || type === 'until') {
      node.type = 'loop';
      if (action.actions) {
        for (const [n, a] of Object.entries(action.actions)) {
          node.children.push(buildVisualNode(n, a));
        }
      }
    } else if (type === 'scope') {
      node.type = 'scope';
      if (action.actions) {
        for (const [n, a] of Object.entries(action.actions)) {
          node.children.push(buildVisualNode(n, a));
        }
      }
    }

    return node;
  }

  function topologicalSortActions(actions) {
    const actionNames = Object.keys(actions);
    const inDegree = {};
    const adj = {};
    for (const name of actionNames) {
      inDegree[name] = 0;
      adj[name] = [];
    }
    for (const name of actionNames) {
      const action = actions[name];
      if (action.runAfter) {
        for (const dep of Object.keys(action.runAfter)) {
          if (adj[dep]) {
            adj[dep].push(name);
            inDegree[name]++;
          }
        }
      }
    }
    // BFS
    const queue = actionNames.filter(n => inDegree[n] === 0);
    const result = [];
    while (queue.length > 0) {
      const current = queue.shift();
      result.push(current);
      for (const next of adj[current]) {
        inDegree[next]--;
        if (inDegree[next] === 0) queue.push(next);
      }
    }
    // Add any remaining (cycles)
    for (const name of actionNames) {
      if (!result.includes(name)) result.push(name);
    }
    return result;
  }

  function layoutNodes(nodes, startX, startY) {
    const items = [];
    let y = startY;
    let maxWidth = NODE_W;

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      if (node.branches && node.branches.length > 0) {
        // Condition with branches
        items.push({ node, x: 0, y, w: NODE_W, h: NODE_H });
        const condY = y;
        y += NODE_H + NODE_GAP_Y;

        // Layout branches side by side
        const branchLayouts = [];
        let totalBranchWidth = 0;
        for (const branch of node.branches) {
          const bLayout = layoutNodes(branch.children, 0, 0);
          bLayout.label = branch.label;
          branchLayouts.push(bLayout);
          totalBranchWidth += Math.max(bLayout.width, NODE_W) + BRANCH_GAP_X;
        }
        totalBranchWidth -= BRANCH_GAP_X; // Remove last gap
        maxWidth = Math.max(maxWidth, totalBranchWidth);

        let bx = 0;
        let maxBranchBottom = y;
        for (const bl of branchLayouts) {
          const branchW = Math.max(bl.width, NODE_W);
          items.push({
            branchLabel: bl.label,
            branchItems: bl.items,
            x: bx,
            y: y,
            w: branchW,
            h: bl.height,
            parentCondY: condY
          });
          bx += branchW + BRANCH_GAP_X;
          maxBranchBottom = Math.max(maxBranchBottom, y + bl.height);
        }
        y = maxBranchBottom + NODE_GAP_Y;
      } else if (node.children && node.children.length > 0) {
        // Scope or loop with inner children
        const innerLayout = layoutNodes(node.children, 0, 0);
        const scopeW = Math.max(innerLayout.width + 24, NODE_W + 24);
        const scopeH = NODE_H + 16 + innerLayout.height + 16;
        items.push({
          node, x: 0, y, w: scopeW, h: scopeH,
          innerItems: innerLayout.items, innerWidth: innerLayout.width
        });
        maxWidth = Math.max(maxWidth, scopeW);
        y += scopeH + NODE_GAP_Y;
      } else {
        items.push({ node, x: 0, y, w: NODE_W, h: NODE_H });
        y += NODE_H + NODE_GAP_Y;
      }
    }

    return { items, width: maxWidth, height: Math.max(y - NODE_GAP_Y, 0) };
  }

  function drawNodes(parent, items, totalWidth) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (item.branchItems) {
        // Draw branch label
        const labelX = item.x + item.w / 2;
        const labelY = item.y - 8;
        const label = createSvgElement('text');
        label.setAttribute('x', labelX);
        label.setAttribute('y', labelY);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('fill', '#e0a852');
        label.setAttribute('font-size', '11');
        label.setAttribute('font-family', 'Segoe UI, sans-serif');
        label.textContent = item.branchLabel;
        parent.appendChild(label);

        // Draw branch items offset by branch X/Y
        const branchG = createSvgElement('g');
        branchG.setAttribute('transform', `translate(${item.x}, ${item.y})`);
        drawNodes(branchG, item.branchItems, item.w);
        parent.appendChild(branchG);
        continue;
      }

      if (!item.node) continue;

      const centerX = (totalWidth - NODE_W) / 2;
      const x = centerX;
      const y = item.y;

      // Draw connector line from previous item
      if (i > 0 && items[i - 1] && !items[i - 1].branchItems) {
        const prevItem = items[i - 1];
        const prevY = prevItem.y + (prevItem.h || NODE_H);
        const lineX = totalWidth / 2;
        drawArrow(parent, lineX, prevY, lineX, y);
      }

      if (item.innerItems) {
        // Draw scope/loop container
        drawScopeBox(parent, x - 12, y, item.w, item.h, item.node);
        // Draw inner items
        const innerG = createSvgElement('g');
        innerG.setAttribute('transform', `translate(${x}, ${y + NODE_H + 16})`);
        drawNodes(innerG, item.innerItems, item.innerWidth);
        parent.appendChild(innerG);
      } else {
        // Draw node box
        drawNodeBox(parent, x, y, item.node);
      }
    }
  }

  function drawNodeBox(parent, x, y, node) {
    const colors = {
      trigger: { bg: '#0e3a1e', border: '#4ec96b', text: '#4ec96b' },
      action:  { bg: '#1a3a5c', border: '#5ca8e0', text: '#5ca8e0' },
      condition: { bg: '#5c4a1a', border: '#e0c252', text: '#e0c252' },
      loop: { bg: '#4a1a5c', border: '#c252e0', text: '#c252e0' },
      scope: { bg: '#3a3a3a', border: '#aaaaaa', text: '#aaaaaa' }
    };
    const c = colors[node.type] || colors.action;

    // Box
    const rect = createSvgElement('rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', NODE_W);
    rect.setAttribute('height', NODE_H);
    rect.setAttribute('rx', '8');
    rect.setAttribute('fill', c.bg);
    rect.setAttribute('stroke', c.border);
    rect.setAttribute('stroke-width', '1.5');
    rect.style.cursor = 'pointer';
    parent.appendChild(rect);

    // Label (truncated)
    const labelText = node.label.length > 25 ? node.label.substring(0, 22) + '...' : node.label;
    const label = createSvgElement('text');
    label.setAttribute('x', x + NODE_W / 2);
    label.setAttribute('y', y + 22);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('fill', '#ffffff');
    label.setAttribute('font-size', '12');
    label.setAttribute('font-weight', '600');
    label.setAttribute('font-family', 'Segoe UI, sans-serif');
    label.textContent = labelText;
    parent.appendChild(label);

    // Type subtitle
    const subtitle = createSvgElement('text');
    subtitle.setAttribute('x', x + NODE_W / 2);
    subtitle.setAttribute('y', y + 40);
    subtitle.setAttribute('text-anchor', 'middle');
    subtitle.setAttribute('fill', c.text);
    subtitle.setAttribute('font-size', '10');
    subtitle.setAttribute('font-family', 'Segoe UI, sans-serif');
    subtitle.textContent = node.actionType;
    parent.appendChild(subtitle);

    // Icon indicator
    const icon = createSvgElement('circle');
    icon.setAttribute('cx', x + 16);
    icon.setAttribute('cy', y + NODE_H / 2);
    icon.setAttribute('r', '6');
    icon.setAttribute('fill', c.border);
    parent.appendChild(icon);

    // Click to go to action in editor
    rect.addEventListener('click', () => {
      const content = getEditorValue();
      const searchText = `"${node.label}"`;
      const idx = content.indexOf(searchText);
      if (idx >= 0) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
        document.querySelector('[data-tab="editor"]').classList.add('active');
        document.getElementById('tab-editor').classList.add('active');

        const linesBefore = content.substring(0, idx).split('\n');
        const lineNumber = linesBefore.length;
        const column = linesBefore[linesBefore.length - 1].length + 1;

        setTimeout(() => {
          monacoEditor.layout();
          monacoEditor.revealLineInCenter(lineNumber);
          monacoEditor.setSelection(new monaco.Range(lineNumber, column, lineNumber, column + searchText.length));
          monacoEditor.focus();
        }, 50);
      }
    });
  }

  function drawScopeBox(parent, x, y, w, h, node) {
    const colors = {
      loop: { border: '#c252e0', bg: 'rgba(74, 26, 92, 0.3)' },
      scope: { border: '#aaaaaa', bg: 'rgba(58, 58, 58, 0.3)' }
    };
    const c = colors[node.type] || colors.scope;

    const rect = createSvgElement('rect');
    rect.setAttribute('x', x);
    rect.setAttribute('y', y);
    rect.setAttribute('width', w);
    rect.setAttribute('height', h);
    rect.setAttribute('rx', '10');
    rect.setAttribute('fill', c.bg);
    rect.setAttribute('stroke', c.border);
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('stroke-dasharray', '6,3');
    parent.appendChild(rect);

    // Header
    drawNodeBox(parent, x + 12, y, node);
  }

  function drawArrow(parent, x1, y1, x2, y2) {
    const line = createSvgElement('line');
    line.setAttribute('x1', x1);
    line.setAttribute('y1', y1);
    line.setAttribute('x2', x2);
    line.setAttribute('y2', y2);
    line.setAttribute('stroke', '#555');
    line.setAttribute('stroke-width', '1.5');
    parent.appendChild(line);

    // Arrowhead
    const arrowSize = 6;
    const arrow = createSvgElement('polygon');
    arrow.setAttribute('points', `${x2},${y2} ${x2 - arrowSize},${y2 - arrowSize * 1.5} ${x2 + arrowSize},${y2 - arrowSize * 1.5}`);
    arrow.setAttribute('fill', '#555');
    parent.appendChild(arrow);
  }

  function createSvgElement(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
  }

  // Zoom controls
  document.getElementById('btnZoomIn').addEventListener('click', () => {
    visualZoom = Math.min(visualZoom + 0.2, 3);
    renderFlowVisualization();
  });
  document.getElementById('btnZoomOut').addEventListener('click', () => {
    visualZoom = Math.max(visualZoom - 0.2, 0.3);
    renderFlowVisualization();
  });
  document.getElementById('btnZoomReset').addEventListener('click', () => {
    visualZoom = 1;
    renderFlowVisualization();
  });
  document.getElementById('btnRefreshVisual').addEventListener('click', renderFlowVisualization);

  // ===== UTILS =====
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== WARN ON CLOSE WITH UNSAVED CHANGES =====
  window.addEventListener('beforeunload', (e) => {
    if (getEditorValue() !== lastSavedContent) {
      // Perform one last auto-save
      performAutoSave();
      e.preventDefault();
      e.returnValue = '';
    }
  });

  // ===== START =====
  console.log('[AutomateFlow editor.js] Calling init()...');
  init().then(() => {
    console.log('[AutomateFlow editor.js] init() completed successfully.');
  }).catch((err) => {
    console.error('[AutomateFlow editor.js] init() promise rejected:', err);
    flowNameEl.textContent = 'Erro ao carregar';
    setStatus('Erro fatal: ' + err.message);
  });

})();
