/**
 * interceptor.js - Runs in MAIN world to intercept Power Automate API calls.
 * Patches fetch() and XMLHttpRequest to capture flow definitions and auth tokens.
 * Also extracts MSAL tokens from sessionStorage/localStorage.
 */

(function () {
  'use strict';

  // Broad patterns to catch all possible Power Automate API calls
  const API_PATTERNS = [
    /\/providers\/Microsoft\.ProcessSimple\//i,
    /api\.flow\.microsoft\.com/i,
    /api\.powerautomate\.com/i,
    /tip\d*\.api\.powerautomate\.com/i,
    /make\.powerautomate\.com\/api\//i,
    /flow\.microsoft\.com\/api\//i,
    /\/flows\/[0-9a-f-]+/i,
    /\/workflows\(/i,
    /\.dynamics\.com\/api\/data\//i
  ];

  const FLOW_ID_PATTERN = /\/flows\/([0-9a-f-]+)/i;
  const ENV_PATTERN = /\/environments\/([^/\s?#]+)/i;

  let capturedToken = null;
  let capturedFlowData = null;

  // --- JWT utilities ---
  function parseJwt(token) {
    try {
      const bearerless = token.startsWith('Bearer ') ? token.substring(7) : token;
      const parts = bearerless.split('.');
      if (parts.length !== 3) return null;
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload;
    } catch (e) {
      return null;
    }
  }

  function isTokenExpired(token) {
    const payload = parseJwt(token);
    if (!payload || !payload.exp) return false; // can't tell, assume valid
    const nowSec = Math.floor(Date.now() / 1000);
    return payload.exp <= nowSec + 60; // expired or expires within 60s
  }

  function isTokenForFlowApi(token) {
    const payload = parseJwt(token);
    if (!payload) return false;
    const aud = (payload.aud || '').toLowerCase();
    // The Flow API expects tokens with these audiences
    return aud.includes('service.flow.microsoft.com') ||
           aud.includes('flow.microsoft.com') ||
           aud.includes('api.flow.microsoft.com') ||
           aud.includes('processimple') ||
           aud.includes('https://gov.service.flow') ||
           aud.includes('https://service.flow');
  }

  function getTokenDebugInfo(token) {
    const payload = parseJwt(token);
    if (!payload) return 'unparseable';
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresIn = payload.exp ? (payload.exp - nowSec) : '?';
    return `aud=${payload.aud || '?'}, exp_in=${expiresIn}s, scp=${payload.scp || '?'}`;
  }

  function isRelevantUrl(url) {
    if (!url) return false;
    return API_PATTERNS.some(p => p.test(url));
  }

  function looksLikeFlowData(data) {
    if (!data) return false;
    // Check various shapes the flow data can come in
    if (data.properties?.definition) return true;
    if (data.properties?.connectionReferences) return true;
    if (data.clientData) return true;
    if (data.definition?.triggers) return true;
    if (data.definition?.actions) return true;
    if (data.definition?.$schema?.includes('workflowdefinition')) return true;
    return false;
  }

  function extractFlowInfo(url) {
    const envMatch = url.match(ENV_PATTERN);
    const flowMatch = url.match(FLOW_ID_PATTERN);
    return {
      environmentId: envMatch ? envMatch[1] : null,
      flowId: flowMatch ? flowMatch[1] : null
    };
  }

  function captureAuthToken(headers) {
    if (!headers) return;
    let authHeader = null;

    if (headers instanceof Headers) {
      authHeader = headers.get('Authorization');
    } else if (Array.isArray(headers)) {
      const entry = headers.find(([k]) => k.toLowerCase() === 'authorization');
      if (entry) authHeader = entry[1];
    } else if (typeof headers === 'object' && !(headers instanceof Headers)) {
      for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === 'authorization') {
          authHeader = value;
          break;
        }
      }
    }

    if (authHeader && authHeader.startsWith('Bearer ')) {
      capturedToken = authHeader;
      window.postMessage({ type: 'AUTOMATEFLOW_TOKEN', token: authHeader }, '*');
    }
  }

  function sendFlowData(url, data, method) {
    capturedFlowData = data;
    window.postMessage({
      type: 'AUTOMATEFLOW_DATA',
      url: url,
      method: method,
      flowInfo: extractFlowInfo(url),
      data: data,
      timestamp: Date.now()
    }, '*');
  }

  // --- Patch fetch() ---
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const request = args[0];
    const init = args[1] || {};

    let url = '';
    let headers = null;

    if (typeof request === 'string') {
      url = request;
      headers = init.headers;
    } else if (request instanceof URL) {
      url = request.href;
      headers = init.headers;
    } else if (request instanceof Request) {
      url = request.url;
      headers = request.headers;
    }

    // Capture auth token from ANY request to Microsoft domains
    if (url && (url.includes('microsoft.com') || url.includes('dynamics.com') || url.includes('powerautomate.com'))) {
      captureAuthToken(headers || init.headers);
    }

    const response = await originalFetch.apply(this, args);

    // Check if this is a relevant API call
    if (isRelevantUrl(url)) {
      const method = (init.method || request?.method || 'GET').toUpperCase();
      try {
        const clone = response.clone();
        clone.text().then(text => {
          try {
            const body = JSON.parse(text);
            if (looksLikeFlowData(body)) {
              sendFlowData(url, body, method);
            }
            // Also check if it's a list response with flow items
            if (body.value && Array.isArray(body.value)) {
              body.value.forEach(item => {
                if (looksLikeFlowData(item)) {
                  sendFlowData(url, item, method);
                }
              });
            }
          } catch (e) { /* Not JSON */ }
        }).catch(() => {});
      } catch (e) { /* Cloning error */ }
    }

    return response;
  };

  // --- Patch XMLHttpRequest ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._af_url = typeof url === 'string' ? url : url?.toString?.() || '';
    this._af_method = method;
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (name.toLowerCase() === 'authorization' && value.startsWith('Bearer ')) {
      capturedToken = value;
      window.postMessage({ type: 'AUTOMATEFLOW_TOKEN', token: value }, '*');
    }
    return origSetHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (this._af_url && isRelevantUrl(this._af_url)) {
      this.addEventListener('load', () => {
        try {
          const data = JSON.parse(this.responseText);
          if (looksLikeFlowData(data)) {
            sendFlowData(this._af_url, data, this._af_method);
          }
        } catch (e) { /* Not JSON */ }
      });
    }
    return origSend.call(this, body);
  };

  // --- Extract MSAL tokens from storage ---
  // MSAL v2 stores access tokens as JSON objects with keys containing "accesstoken".
  // Each entry has: { secret, target, expiresOn, ... } or { accessToken, ... }
  // We need to find the one whose audience matches the Flow API.
  function findAllMsalTokens() {
    const candidates = [];
    const storages = [sessionStorage, localStorage];

    for (const storage of storages) {
      try {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (!key) continue;
          const keyLower = key.toLowerCase();

          // MSAL v2 format: key contains "accesstoken"
          if (keyLower.includes('accesstoken') || keyLower.includes('access_token')) {
            try {
              const val = JSON.parse(storage.getItem(key));
              if (val.secret) {
                const bearer = 'Bearer ' + val.secret;
                const expired = isTokenExpired(bearer);
                const forFlow = isTokenForFlowApi(bearer);
                const target = (val.target || '').toLowerCase();
                const targetMatch = target.includes('flow') || target.includes('processimple') ||
                                    target.includes('powerautomate') || target.includes('service.flow');
                candidates.push({
                  token: bearer,
                  expired,
                  forFlow,
                  targetMatch,
                  // Score: higher = better
                  score: (forFlow ? 100 : 0) + (targetMatch ? 50 : 0) + (expired ? -200 : 0),
                  source: 'msal-v2',
                  debug: getTokenDebugInfo(bearer)
                });
              }
              if (val.accessToken) {
                const bearer = 'Bearer ' + val.accessToken;
                const expired = isTokenExpired(bearer);
                const forFlow = isTokenForFlowApi(bearer);
                candidates.push({
                  token: bearer,
                  expired,
                  forFlow,
                  targetMatch: false,
                  score: (forFlow ? 100 : 0) + (expired ? -200 : 0),
                  source: 'msal-accessToken',
                  debug: getTokenDebugInfo(bearer)
                });
              }
            } catch (e) { /* Not JSON */ }
          }
        }
      } catch (e) { /* Storage access error */ }
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }

  function findMsalToken() {
    const candidates = findAllMsalTokens();
    if (candidates.length === 0) return null;

    // Return the best non-expired token that matches the Flow API audience
    const best = candidates.find(c => !c.expired && c.forFlow);
    if (best) return best.token;

    // Fallback: any non-expired token with matching target
    const fallback = candidates.find(c => !c.expired && c.targetMatch);
    if (fallback) return fallback.token;

    // Last resort: any non-expired token (may not work but worth trying)
    const anyValid = candidates.find(c => !c.expired);
    if (anyValid) return anyValid.token;

    // Everything is expired
    return null;
  }

  function getFreshToken() {
    // Always re-scan storage for the freshest token
    const fresh = findMsalToken();
    if (fresh) {
      capturedToken = fresh;
      return fresh;
    }
    // Fall back to captured token if it's still valid
    if (capturedToken && !isTokenExpired(capturedToken)) {
      return capturedToken;
    }
    return null;
  }

  // --- Handle requests from content.js ---
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;

    if (event.data?.type === 'AUTOMATEFLOW_REQUEST_TOKEN') {
      // Always re-scan for the freshest valid token
      const token = getFreshToken();
      if (token) {
        window.postMessage({ type: 'AUTOMATEFLOW_TOKEN', token }, '*');
      }
    }

    if (event.data?.type === 'AUTOMATEFLOW_DEBUG_TOKENS') {
      // Return all found tokens with debug info (for troubleshooting)
      const candidates = findAllMsalTokens();
      const capturedInfo = capturedToken ? {
        expired: isTokenExpired(capturedToken),
        forFlow: isTokenForFlowApi(capturedToken),
        debug: getTokenDebugInfo(capturedToken)
      } : null;
      window.postMessage({
        type: 'AUTOMATEFLOW_DEBUG_TOKENS_RESULT',
        captured: capturedInfo,
        candidates: candidates.map(c => ({
          expired: c.expired,
          forFlow: c.forFlow,
          targetMatch: c.targetMatch,
          score: c.score,
          source: c.source,
          debug: c.debug
        })),
        totalFound: candidates.length
      }, '*');
    }

    if (event.data?.type === 'AUTOMATEFLOW_FETCH_FLOW') {
      const { environmentId, flowId } = event.data;
      const token = getFreshToken();

      if (!token) {
        window.postMessage({
          type: 'AUTOMATEFLOW_FETCH_RESULT',
          success: false,
          error: 'Nenhum token valido encontrado. Tente interagir com o designer do flow (ex: clicar em uma acao) e tente novamente.'
        }, '*');
        return;
      }

      const apiUrl = `https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/${environmentId}/flows/${flowId}?api-version=2016-11-01`;

      originalFetch(apiUrl, {
        method: 'GET',
        headers: {
          'Authorization': token,
          'Accept': 'application/json'
        }
      })
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
          return r.json();
        })
        .then(data => {
          capturedFlowData = data;
          window.postMessage({
            type: 'AUTOMATEFLOW_FETCH_RESULT',
            success: true,
            data: data,
            url: apiUrl
          }, '*');
          // Also send as normal flow data
          sendFlowData(apiUrl, data, 'GET');
        })
        .catch(err => {
          window.postMessage({
            type: 'AUTOMATEFLOW_FETCH_RESULT',
            success: false,
            error: err.message
          }, '*');
        });
    }

    if (event.data?.type === 'AUTOMATEFLOW_SAVE_FLOW') {
      const { url, flowData } = event.data;

      // Always get the freshest token for save operations
      const authToken = getFreshToken();

      if (!authToken) {
        window.postMessage({
          type: 'AUTOMATEFLOW_SAVE_RESULT',
          success: false,
          error: 'Nenhum token de autenticacao valido. O token pode ter expirado. Recarregue a pagina do Power Automate e interaja com o designer antes de tentar salvar.'
        }, '*');
        return;
      }

      function doSave(tokenToUse, isRetry) {
        originalFetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': tokenToUse
          },
          body: JSON.stringify(flowData)
        })
          .then(r => {
            if (r.status === 401 || r.status === 403) {
              if (!isRetry) {
                // Token rejected - try to get a completely fresh one from MSAL
                const freshToken = findMsalToken();
                if (freshToken && freshToken !== tokenToUse) {
                  capturedToken = freshToken;
                  doSave(freshToken, true);
                  return;
                }
              }
              return r.text().then(text => {
                let errorMsg = `HTTP ${r.status}: Autenticacao falhou.`;
                try {
                  const errorBody = JSON.parse(text);
                  errorMsg = errorBody.error?.message || errorBody.message || errorMsg;
                } catch (e) { /* not JSON */ }
                errorMsg += ' Recarregue a pagina do Power Automate e tente novamente.';
                throw new Error(errorMsg);
              });
            }
            if (!r.ok) {
              return r.text().then(text => {
                let errorMsg = `HTTP ${r.status}: ${r.statusText}`;
                try {
                  const errorBody = JSON.parse(text);
                  errorMsg = errorBody.error?.message || errorBody.message || errorMsg;
                } catch (e) { /* not JSON */ }
                throw new Error(errorMsg);
              });
            }
            return r.json();
          })
          .then(data => {
            if (data) {
              window.postMessage({
                type: 'AUTOMATEFLOW_SAVE_RESULT',
                success: true,
                data: data
              }, '*');
            }
          })
          .catch(err => {
            window.postMessage({
              type: 'AUTOMATEFLOW_SAVE_RESULT',
              success: false,
              error: err.message
            }, '*');
          });
      }

      doSave(authToken, false);
    }
  });

  // Signal ready
  window.postMessage({ type: 'AUTOMATEFLOW_INTERCEPTOR_READY' }, '*');

  // Proactively try to find a token on load
  setTimeout(() => {
    const token = getFreshToken();
    if (token) {
      window.postMessage({ type: 'AUTOMATEFLOW_TOKEN', token }, '*');
    }
  }, 2000);

})();
