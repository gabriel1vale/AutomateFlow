/**
 * background.js - Service worker for the AutomateFlow extension.
 * Manages state, coordinates communication, and handles editor window lifecycle.
 */

const tabData = {};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (message.type) {
    case 'FLOW_DATA_CAPTURED':
      if (tabId) {
        if (!tabData[tabId]) tabData[tabId] = {};
        tabData[tabId].flowData = message.payload;
        tabData[tabId].timestamp = Date.now();
        chrome.action.setBadgeText({ text: 'OK', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#107c10', tabId });
      }
      break;

    case 'TOKEN_CAPTURED':
      if (tabId) {
        if (!tabData[tabId]) tabData[tabId] = {};
        tabData[tabId].token = message.token;
      }
      break;

    case 'INTERCEPTOR_READY':
      if (tabId) {
        chrome.action.setBadgeText({ text: '...', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#888', tabId });
      }
      break;

    case 'URL_CHANGED':
      if (tabId) {
        // Reset data on navigation
        if (tabData[tabId]) {
          tabData[tabId].flowData = null;
        }
        tabData[tabId] = tabData[tabId] || {};
        tabData[tabId].url = message.url;
        chrome.action.setBadgeText({ text: '...', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#888', tabId });
      }
      break;

    case 'ACTIVE_FETCH_RESULT':
      if (tabId && message.success && message.data) {
        if (!tabData[tabId]) tabData[tabId] = {};
        tabData[tabId].flowData = {
          data: message.data,
          url: message.url,
          timestamp: Date.now()
        };
        chrome.action.setBadgeText({ text: 'OK', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#107c10', tabId });
      }
      break;

    case 'GET_TAB_DATA':
      sendResponse(tabData[message.tabId] || null);
      return true;

    case 'OPEN_EDITOR':
      openEditor(message.tabId, message.flowData, message.token);
      break;

    case 'SAVE_RESULT':
      chrome.runtime.sendMessage({
        type: 'EDITOR_SAVE_RESULT',
        success: message.success,
        data: message.data,
        error: message.error
      }).catch(() => {});
      break;

    case 'SAVE_FLOW_FROM_EDITOR':
      if (message.tabId) {
        chrome.tabs.sendMessage(message.tabId, {
          type: 'SAVE_FLOW',
          url: message.url,
          flowData: message.flowData,
          token: message.token
        }).catch(() => {});
      }
      break;
  }
});

function openEditor(tabId, flowData, token) {
  chrome.storage.local.set({
    editorData: { tabId, flowData, token, timestamp: Date.now() }
  }, () => {
    chrome.windows.create({
      url: chrome.runtime.getURL('editor.html'),
      type: 'popup',
      width: 1200,
      height: 800
    });
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  delete tabData[tabId];
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    if (tab.url.includes('make.powerautomate.com') || tab.url.includes('flow.microsoft.com')) {
      chrome.action.setBadgeText({ text: '...', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#888', tabId });
    }
  }
});
