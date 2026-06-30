import {
  siteHostElement,
  siteToggleElement,
  refreshButtonElement,
  filterButtonElements,
  openPanelButtonElement,
  clearButtonElement,
  currentTab,
  currentStreams,
  setCurrentTab,
  setCurrentFilter,
  setStatus,
  getHostFromUrl,
  getDisabledSites,
  setDisabledSites,
  sendStateToCurrentTab
} from "./ui-state.js";
import { renderStreams, getFilteredStreams } from "./streams-render.js";
import { refreshMediaState } from "./media-state.js";

async function getCurrentTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0];
}

function openStreamsPanel() {
  if (!currentTab || typeof currentTab.id !== "number") {
    setStatus("Не удалось определить текущую вкладку.");
    return;
  }

  const params = new URLSearchParams({
    tabId: String(currentTab.id),
    tabUrl: currentTab.url || "",
    title: currentTab.title || ""
  });

  chrome.tabs.create({
    url: chrome.runtime.getURL(`panel/panel.html?${params.toString()}`)
  });
}

function clearDiagnostics() {
  if (!currentTab || typeof currentTab.id !== "number") return;

  chrome.runtime.sendMessage(
    {
      type: "CLEAR_MEDIA_DOWNLOADER_DIAGNOSTICS",
      tabId: currentTab.id
    },
    () => {
      refreshMediaState();
    }
  );
}

async function initPopup() {
  const tab = await getCurrentTab();
  setCurrentTab(tab);

  if (!tab || !tab.url) {
    siteHostElement.textContent = "Не удалось определить сайт";
    siteToggleElement.disabled = true;
    return;
  }

  const host = getHostFromUrl(tab.url);

  if (!host) {
    siteHostElement.textContent = "Этот тип страницы не поддерживается";
    siteToggleElement.disabled = true;
    return;
  }

  siteHostElement.textContent = host;

  getDisabledSites((disabledSites) => {
    const isDisabled = Boolean(disabledSites[host]);

    siteToggleElement.checked = isDisabled;
    setStatus(isDisabled ? "Кнопки скрыты на этом сайте." : "Кнопки включены на этом сайте.");
  });

  siteToggleElement.addEventListener("change", () => {
    const shouldDisable = siteToggleElement.checked;

    getDisabledSites((disabledSites) => {
      if (shouldDisable) {
        disabledSites[host] = true;
      } else {
        delete disabledSites[host];
      }

      setDisabledSites(disabledSites, () => {
        sendStateToCurrentTab(tab.id, !shouldDisable);
      });
    });
  });

  refreshButtonElement.addEventListener("click", () => {
    refreshMediaState({ forceRescan: true });
  });

  filterButtonElements.forEach((button) => {
    button.addEventListener("click", () => {
      setCurrentFilter(button.dataset.streamFilter || "all");
      renderStreams(currentStreams);
      setStatus(`Фильтр: ${button.dataset.streamFilter || "all"}. Показано: ${getFilteredStreams(currentStreams).length}.`);
    });
  });

  openPanelButtonElement.addEventListener("click", openStreamsPanel);
  clearButtonElement.addEventListener("click", clearDiagnostics);

  refreshMediaState({ forceRescan: true });

  setInterval(() => {
    refreshMediaState();
  }, 3000);
}

initPopup();
