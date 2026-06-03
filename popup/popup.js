const siteHostElement = document.getElementById("siteHost");
const siteToggleElement = document.getElementById("siteToggle");
const statusElement = document.getElementById("status");

function getDisabledSites(callback) {
  chrome.storage.local.get(
    {
      disabledSites: {}
    },
    (result) => {
      callback(result.disabledSites || {});
    }
  );
}

function setDisabledSites(disabledSites, callback) {
  chrome.storage.local.set(
    {
      disabledSites
    },
    callback
  );
}

function getHostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function setStatus(text) {
  statusElement.textContent = text;
}

function sendStateToCurrentTab(tabId, enabled) {
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

async function getCurrentTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0];
}

async function initPopup() {
  const tab = await getCurrentTab();

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
}

initPopup();