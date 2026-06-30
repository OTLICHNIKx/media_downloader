import { getHostFromUrl } from "../../shared/format.js";

export const siteHostElement = document.getElementById("siteHost");
export const siteToggleElement = document.getElementById("siteToggle");
export const statusElement = document.getElementById("status");
export const streamsListElement = document.getElementById("streamsList");
export const diagnosticsListElement = document.getElementById("diagnosticsList");
export const refreshButtonElement = document.getElementById("refreshButton");
export const clearButtonElement = document.getElementById("clearButton");
export const openPanelButtonElement = document.getElementById("openPanelButton");
export const streamsCounterElement = document.getElementById("streamsCounter");
export const filterButtonElements = Array.from(document.querySelectorAll("[data-stream-filter]"));

export let currentTab = null;
export let currentFilter = "all";
export let currentStreams = [];

export function setCurrentTab(tab) {
  currentTab = tab;
}

export function setCurrentFilter(filter) {
  currentFilter = filter;
}

export function setCurrentStreams(streams) {
  currentStreams = streams;
}

export function setStatus(text) {
  statusElement.textContent = text;
}

export function getDisabledSites(callback) {
  chrome.storage.local.get(
    {
      disabledSites: {}
    },
    (result) => {
      callback(result.disabledSites || {});
    }
  );
}

export function setDisabledSites(disabledSites, callback) {
  chrome.storage.local.set(
    {
      disabledSites
    },
    callback
  );
}

export function sendStateToCurrentTab(tabId, enabled) {
  chrome.tabs.sendMessage(
    tabId,
    {
      type: "SET_MEDIA_DOWNLOADER_UI",
      enabled
    },
    () => {
      if (chrome.runtime.lastError) {
        setStatus("Настройка сохранена. Обнови страницу, если кнопки не изменились.");
        return;
      }

      setStatus(enabled ? "Кнопки включены на этом сайте." : "Кнопки скрыты на этом сайте.");
    }
  );
}

export { getHostFromUrl };
