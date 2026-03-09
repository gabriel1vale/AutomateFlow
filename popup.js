/**
 * popup.js - Popup logic for AutomateFlow extension.
 * Supports both passive detection and active fetch of flow data.
 */

(function () {
  'use strict';

  const contentEl = document.getElementById('content');

  async function init() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab || !tab.url) {
        showNotPowerAutomate();
        return;
      }

      const isPowerAutomate =
        tab.url.includes('make.powerautomate.com') ||
        tab.url.includes('flow.microsoft.com');

      if (!isPowerAutomate) {
        showNotPowerAutomate();
        return;
      }

      // Parse environment and flow ID from the URL
      const envMatch = tab.url.match(/\/environments\/([^/\s?#]+)/i);
      const flowMatch = tab.url.match(/\/flows\/([0-9a-f-]+)/i);
      const envId = envMatch ? envMatch[1] : null;
      const flowId = flowMatch ? flowMatch[1] : null;

      // Try to get data from content script (passive interception)
      let response = null;
      try {
        response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_FLOW_DATA' });
      } catch (e) {
        // Content script not loaded yet
      }

      if (response && response.flowData) {
        showFlowDetected(tab, response);
      } else if (envId && flowId) {
        // We can see there's a flow open, offer to fetch it actively
        showFlowDetectable(tab, envId, flowId);
      } else {
        showWaitingForFlow(tab);
      }
    } catch (err) {
      showError(err.message);
    }
  }

  function showNotPowerAutomate() {
    contentEl.innerHTML = `
      <div class="status disconnected">
        <div class="status-dot"></div>
        Nao e uma pagina do Power Automate
      </div>
      <div class="no-flow">
        <strong>Extensao inativa</strong>
        Abra o Power Automate (make.powerautomate.com) e navegue ate um flow para usar o AutomateFlow.
      </div>
    `;
  }

  function showFlowDetectable(tab, envId, flowId) {
    contentEl.innerHTML = `
      <div class="status waiting">
        <div class="status-dot"></div>
        Flow identificado na URL
      </div>
      <div class="no-flow">
        <strong>Flow encontrado!</strong>
        Um flow foi detectado na URL desta pagina.
        Clique abaixo para capturar os dados do flow via API.
      </div>
      <div class="debug-info">
        <div><strong>Environment:</strong> ${envId.substring(0, 12)}...</div>
        <div><strong>Flow ID:</strong> ${flowId.substring(0, 12)}...</div>
      </div>
      <div class="actions" style="margin-top: 12px;">
        <button class="btn btn-success" id="btn-fetch">
          <span class="btn-icon">&#9889;</span> Capturar Flow
        </button>
        <button class="btn btn-secondary" id="btn-refresh">
          <span class="btn-icon">&#8635;</span> Recarregar Pagina
        </button>
      </div>
    `;

    document.getElementById('btn-fetch').addEventListener('click', () => {
      activeFetchFlow(tab, envId, flowId);
    });

    document.getElementById('btn-refresh').addEventListener('click', () => {
      chrome.tabs.reload(tab.id);
      window.close();
    });
  }

  async function activeFetchFlow(tab, envId, flowId) {
    contentEl.innerHTML = `
      <div class="status fetching">
        <div class="status-dot"></div>
        Buscando flow via API...
      </div>
      <div class="no-flow">
        <strong>Capturando dados...</strong>
        Extraindo token de autenticacao e buscando a definicao do flow.
      </div>
    `;

    try {
      const result = await chrome.tabs.sendMessage(tab.id, {
        type: 'ACTIVE_FETCH_FLOW',
        environmentId: envId,
        flowId: flowId
      });

      if (result && result.success && result.flowData) {
        showFlowDetected(tab, {
          flowData: result.flowData,
          token: result.token
        });
      } else {
        const errorMsg = result?.error || 'Nao foi possivel capturar o flow';
        showFetchError(tab, envId, flowId, errorMsg);
      }
    } catch (e) {
      showFetchError(tab, envId, flowId, e.message);
    }
  }

  function showFetchError(tab, envId, flowId, errorMsg) {
    contentEl.innerHTML = `
      <div class="status disconnected">
        <div class="status-dot"></div>
        Erro na captura
      </div>
      <div class="no-flow">
        <strong>Nao foi possivel capturar o flow</strong>
        O token de autenticacao pode nao estar disponivel ou ter expirado.
        Tente recarregar a pagina e interagir com o designer antes de tentar novamente.
      </div>
      <div class="error-detail">${escapeHtml(errorMsg)}</div>
      <div class="actions" style="margin-top: 12px;">
        <button class="btn btn-success" id="btn-retry">
          <span class="btn-icon">&#8635;</span> Tentar Novamente
        </button>
        <button class="btn btn-secondary" id="btn-reload-retry">
          <span class="btn-icon">&#9889;</span> Recarregar e Tentar
        </button>
        <button class="btn btn-secondary" id="btn-debug-tokens">
          <span class="btn-icon">&#128270;</span> Diagnosticar Tokens
        </button>
      </div>
      <div id="debug-tokens-output"></div>
    `;

    document.getElementById('btn-retry').addEventListener('click', () => {
      activeFetchFlow(tab, envId, flowId);
    });

    document.getElementById('btn-reload-retry').addEventListener('click', async () => {
      await chrome.tabs.reload(tab.id);
      // Wait for page to load, then retry
      contentEl.innerHTML = `
        <div class="status fetching">
          <div class="status-dot"></div>
          Recarregando pagina...
        </div>
        <div class="no-flow">Aguarde a pagina recarregar, depois abra o popup novamente.</div>
      `;
      setTimeout(() => window.close(), 2000);
    });

    document.getElementById('btn-debug-tokens').addEventListener('click', async () => {
      const output = document.getElementById('debug-tokens-output');
      output.innerHTML = '<div class="debug-info">Buscando tokens...</div>';
      try {
        const result = await chrome.tabs.sendMessage(tab.id, { type: 'DEBUG_TOKENS' });
        if (result.error) {
          output.innerHTML = `<div class="error-detail">Erro: ${escapeHtml(result.error)}</div>`;
          return;
        }
        let html = `<div class="debug-info">`;
        html += `<div><strong>Tokens encontrados:</strong> ${result.totalFound || 0}</div>`;
        if (result.captured) {
          html += `<div><strong>Token capturado:</strong> expired=${result.captured.expired}, forFlow=${result.captured.forFlow}</div>`;
          html += `<div style="font-size:10px;color:#666;">${escapeHtml(result.captured.debug)}</div>`;
        } else {
          html += `<div><strong>Token capturado:</strong> nenhum</div>`;
        }
        if (result.candidates && result.candidates.length > 0) {
          html += `<div style="margin-top:6px;"><strong>Candidatos (ordenados por score):</strong></div>`;
          result.candidates.forEach((c, i) => {
            const color = c.forFlow && !c.expired ? '#4ec96b' : c.expired ? '#e05252' : '#e0a852';
            html += `<div style="color:${color};font-size:10px;">#${i + 1} score=${c.score} | ${c.source} | ${escapeHtml(c.debug)}</div>`;
          });
        }
        html += `</div>`;
        output.innerHTML = html;
      } catch (e) {
        output.innerHTML = `<div class="error-detail">Erro: ${escapeHtml(e.message)}</div>`;
      }
    });
  }

  function showWaitingForFlow(tab) {
    contentEl.innerHTML = `
      <div class="status waiting">
        <div class="status-dot"></div>
        Nenhum flow detectado na URL
      </div>
      <div class="no-flow">
        <strong>Power Automate detectado</strong>
        Navegue ate a pagina de edicao de um flow.
        A URL deve conter /environments/.../flows/...
      </div>
      <div class="actions">
        <button class="btn btn-secondary" id="btn-refresh">
          <span class="btn-icon">&#8635;</span> Recarregar
        </button>
      </div>
    `;

    document.getElementById('btn-refresh').addEventListener('click', () => {
      chrome.tabs.reload(tab.id);
      window.close();
    });
  }

  function showFlowDetected(tab, response) {
    const flow = response.flowData;
    const data = flow.data;

    let flowName = 'Desconhecido';
    let flowState = '---';
    let triggerType = '---';
    let actionCount = 0;

    if (data) {
      flowName = data.properties?.displayName || data.name || 'Sem nome';
      flowState = data.properties?.state || '---';

      const definition = data.properties?.definition;
      if (definition) {
        const triggers = definition.triggers || {};
        const triggerKeys = Object.keys(triggers);
        if (triggerKeys.length > 0) {
          triggerType = triggers[triggerKeys[0]]?.type || '---';
        }
        actionCount = Object.keys(definition.actions || {}).length;
      }
    }

    contentEl.innerHTML = `
      <div class="status connected">
        <div class="status-dot"></div>
        Flow detectado!
      </div>
      <div class="flow-info">
        <div class="flow-info-row">
          <span class="label">Nome</span>
          <span class="value" title="${escapeHtml(flowName)}">${escapeHtml(flowName)}</span>
        </div>
        <div class="flow-info-row">
          <span class="label">Estado</span>
          <span class="value">${escapeHtml(flowState)}</span>
        </div>
        <div class="flow-info-row">
          <span class="label">Trigger</span>
          <span class="value">${escapeHtml(triggerType)}</span>
        </div>
        <div class="flow-info-row">
          <span class="label">Acoes</span>
          <span class="value">${actionCount}</span>
        </div>
        <div class="flow-info-row">
          <span class="label">Capturado em</span>
          <span class="value">${new Date(flow.timestamp).toLocaleTimeString('pt-BR')}</span>
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" id="btn-open-editor">
          <span class="btn-icon">{ }</span> Abrir Editor JSON
        </button>
        <button class="btn btn-secondary" id="btn-export">
          <span class="btn-icon">&#11015;</span> Exportar JSON
        </button>
        <button class="btn btn-secondary" id="btn-copy">
          <span class="btn-icon">&#128203;</span> Copiar JSON
        </button>
      </div>
    `;

    document.getElementById('btn-open-editor').addEventListener('click', () => {
      chrome.runtime.sendMessage({
        type: 'OPEN_EDITOR',
        tabId: tab.id,
        flowData: flow,
        token: response.token
      });
      window.close();
    });

    document.getElementById('btn-export').addEventListener('click', () => {
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sanitizeFilename(flowName)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById('btn-copy').addEventListener('click', async () => {
      const json = JSON.stringify(data, null, 2);
      await navigator.clipboard.writeText(json);
      const btn = document.getElementById('btn-copy');
      btn.textContent = 'Copiado!';
      setTimeout(() => {
        btn.innerHTML = '<span class="btn-icon">&#128203;</span> Copiar JSON';
      }, 2000);
    });
  }

  function showError(msg) {
    contentEl.innerHTML = `
      <div class="status disconnected">
        <div class="status-dot"></div>
        Erro: ${escapeHtml(msg)}
      </div>
    `;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 100);
  }

  init();

})();
