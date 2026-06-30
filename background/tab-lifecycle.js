import {
  streamsByTabId,
  activeCapturesByTabId,
  capturedStreamsByTabId,
  diagnosticsByTabId,
  diagnosticSignaturesByTabId,
  scanSummariesByTabId
} from "./state.js";
import { cleanupSoundCloudFallbacksForTab } from "./soundcloud-fragment.js";

export function registerTabLifecycleListeners() {
  chrome.tabs.onRemoved.addListener((tabId) => {
    delete streamsByTabId[tabId];
    delete activeCapturesByTabId[tabId];
    delete capturedStreamsByTabId[tabId];
    delete diagnosticsByTabId[tabId];
    delete diagnosticSignaturesByTabId[tabId];
    delete scanSummariesByTabId[tabId];
    cleanupSoundCloudFallbacksForTab(tabId);
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status !== "loading") return;

    delete streamsByTabId[tabId];
    delete activeCapturesByTabId[tabId];
    delete capturedStreamsByTabId[tabId];
    delete diagnosticsByTabId[tabId];
    delete diagnosticSignaturesByTabId[tabId];
    delete scanSummariesByTabId[tabId];
    cleanupSoundCloudFallbacksForTab(tabId);
  });
}
