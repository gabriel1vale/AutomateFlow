/**
 * content.js - Runs in ISOLATED world.
 * Bridges messages between the MAIN world interceptor and the extension background.
 * Also handles active flow fetching when passive interception fails.
 */

(function () {
  'use strict';

  let latestFlowData = null;
  let latestToken = null;
  let flowHistory = [];
  const MAX_HISTORY = 20;

  // Parse environment ID and flow ID from the current page URL
  function parsePageUrl() {
    const url = window.location.href;
    // Patterns:
    // /environments/{envId}/flows/{flowId}
    // /environments/{envId}/solutions/~preferred/flows/{flowId}
    // /manage/environments/{envId}/flows/{flowId}
    const envMatch = url.match(/\/environments\/([^/\s?#]+)/i);
    const flowMatch = url.match(/\/flows\/([0-9a-f-]+)/i);
    return {
      environmentId: envMatch ? envMatch[1] : null,
      flowId: flowMatch ? flowMatch[1] : null,
      url: url
    };
  }

  // Listen for messages from the MAIN world interceptor
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;

    if (msg?.type === 'AUTOMATEFLOW_DATA') {
      latestFlowData = {
        url: msg.url,
        method: msg.method,
        flowInfo: msg.flowInfo,
        data: msg.data,
        timestamp: msg.timestamp
      };

      flowHistory.unshift(latestFlowData);
      if (flowHistory.length > MAX_HISTORY) {
        flowHistory = flowHistory.slice(0, MAX_HISTORY);
      }

      chrome.runtime.sendMessage({
        type: 'FLOW_DATA_CAPTURED',
        payload: latestFlowData
      }).catch(() => {});
    }

    if (msg?.type === 'AUTOMATEFLOW_TOKEN') {
      latestToken = msg.token;
      chrome.runtime.sendMessage({
        type: 'TOKEN_CAPTURED',
        token: msg.token
      }).catch(() => {});
    }

    if (msg?.type === 'AUTOMATEFLOW_SAVE_RESULT') {
      chrome.runtime.sendMessage({
        type: 'SAVE_RESULT',
        success: msg.success,
        data: msg.data,
        error: msg.error
      }).catch(() => {});
    }

    if (msg?.type === 'AUTOMATEFLOW_INTERCEPTOR_READY') {
      chrome.runtime.sendMessage({ type: 'INTERCEPTOR_READY' }).catch(() => {});
    }

    if (msg?.type === 'AUTOMATEFLOW_FETCH_RESULT') {
      // Forward active fetch result to whoever requested it
      chrome.runtime.sendMessage({
        type: 'ACTIVE_FETCH_RESULT',
        success: msg.success,
        data: msg.data,
        url: msg.url,
        error: msg.error
      }).catch(() => {});
    }

    if (msg?.type === 'AUTOMATEFLOW_DEBUG_TOKENS_RESULT') {
      chrome.runtime.sendMessage({
        type: 'DEBUG_TOKENS_RESULT',
        captured: msg.captured,
        candidates: msg.candidates,
        totalFound: msg.totalFound
      }).catch(() => {});
    }
  });

  // Listen for messages from popup / background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_FLOW_DATA') {
      sendResponse({
        flowData: latestFlowData,
        token: latestToken,
        history: flowHistory,
        pageUrl: window.location.href,
        pageInfo: parsePageUrl()
      });
      return true;
    }

    if (message.type === 'GET_PAGE_INFO') {
      const info = parsePageUrl();
      sendResponse({
        ...info,
        isPowerAutomate:
          info.url.includes('make.powerautomate.com') ||
          info.url.includes('flow.microsoft.com'),
        hasFlowData: !!latestFlowData,
        hasToken: !!latestToken
      });
      return true;
    }

    if (message.type === 'REQUEST_TOKEN') {
      window.postMessage({ type: 'AUTOMATEFLOW_REQUEST_TOKEN' }, '*');
      // Wait for token to come back
      const tokenWaiter = (event) => {
        if (event.source !== window) return;
        if (event.data?.type === 'AUTOMATEFLOW_TOKEN') {
          window.removeEventListener('message', tokenWaiter);
          latestToken = event.data.token;
          sendResponse({ token: latestToken });
        }
      };
      window.addEventListener('message', tokenWaiter);
      // Timeout
      setTimeout(() => {
        window.removeEventListener('message', tokenWaiter);
        sendResponse({ token: latestToken });
      }, 3000);
      return true;
    }

    if (message.type === 'ACTIVE_FETCH_FLOW') {
      // Ask the MAIN world interceptor to fetch the flow directly via API
      const info = parsePageUrl();
      const envId = message.environmentId || info.environmentId;
      const flowId = message.flowId || info.flowId;

      if (!envId || !flowId) {
        sendResponse({ success: false, error: 'Could not determine environment or flow ID from URL' });
        return true;
      }

      window.postMessage({
        type: 'AUTOMATEFLOW_FETCH_FLOW',
        environmentId: envId,
        flowId: flowId
      }, '*');

      // Listen for the result
      const fetchWaiter = (event) => {
        if (event.source !== window) return;
        if (event.data?.type === 'AUTOMATEFLOW_FETCH_RESULT') {
          window.removeEventListener('message', fetchWaiter);
          clearTimeout(fetchTimeout);
          if (event.data.success && event.data.data) {
            latestFlowData = {
              url: event.data.url,
              method: 'GET',
              flowInfo: { environmentId: envId, flowId: flowId },
              data: event.data.data,
              timestamp: Date.now()
            };
            latestToken = latestToken; // keep whatever we had
            sendResponse({
              success: true,
              flowData: latestFlowData,
              token: latestToken
            });
          } else {
            sendResponse({
              success: false,
              error: event.data.error || 'Unknown error'
            });
          }
        }
      };
      window.addEventListener('message', fetchWaiter);

      const fetchTimeout = setTimeout(() => {
        window.removeEventListener('message', fetchWaiter);
        sendResponse({ success: false, error: 'Timeout fetching flow data (15s)' });
      }, 15000);

      return true;
    }

    if (message.type === 'SAVE_FLOW') {
      window.postMessage({
        type: 'AUTOMATEFLOW_SAVE_FLOW',
        url: message.url,
        flowData: message.flowData,
        token: message.token || latestToken
      }, '*');
      sendResponse({ sent: true });
      return true;
    }

    if (message.type === 'DEBUG_TOKENS') {
      window.postMessage({ type: 'AUTOMATEFLOW_DEBUG_TOKENS' }, '*');
      const debugWaiter = (event) => {
        if (event.source !== window) return;
        if (event.data?.type === 'AUTOMATEFLOW_DEBUG_TOKENS_RESULT') {
          window.removeEventListener('message', debugWaiter);
          clearTimeout(debugTimeout);
          sendResponse(event.data);
        }
      };
      window.addEventListener('message', debugWaiter);
      const debugTimeout = setTimeout(() => {
        window.removeEventListener('message', debugWaiter);
        sendResponse({ error: 'Timeout' });
      }, 5000);
      return true;
    }
  });

  // Detect URL changes (SPA navigation) -- reset flow data on navigation
  let lastUrl = window.location.href;
  const checkUrl = () => {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      latestFlowData = null; // Reset on navigation
      chrome.runtime.sendMessage({
        type: 'URL_CHANGED',
        url: lastUrl
      }).catch(() => {});
    }
  };

  // Use multiple methods to detect SPA navigation
  const urlObserver = new MutationObserver(checkUrl);
  if (document.body) {
    urlObserver.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      urlObserver.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Also poll for URL changes (MutationObserver can miss some SPA navigations)
  setInterval(checkUrl, 1000);

})();
