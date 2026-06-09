const siteHostElement = document.getElementById("siteHost");
const siteToggleElement = document.getElementById("siteToggle");
const statusElement = document.getElementById("status");
const streamsListElement = document.getElementById("streamsList");
const diagnosticsListElement = document.getElementById("diagnosticsList");
const refreshButtonElement = document.getElementById("refreshButton");
const clearButtonElement = document.getElementById("clearButton");

let currentTab = null;

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

function formatStreamType(stream) {
  if (!stream) return "media";

  if (stream.type === "hls") return "HLS";
  if (stream.type === "dash") return "DASH";
  if (stream.type === "audio") return "Audio";
  if (stream.type === "video") return "Video";

  return stream.type || "media";
}

function sanitizeFilename(filename) {
  return filename
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function getFilenameFromUrl(url, fallbackExtension = "media") {
  try {
    const parsedUrl = new URL(url);
    const parts = parsedUrl.pathname.split("/");
    const lastPart = parts[parts.length - 1];

    if (lastPart && lastPart.includes(".")) {
      return sanitizeFilename(decodeURIComponent(lastPart));
    }

    return `media-file.${fallbackExtension}`;
  } catch {
    return `media-file.${fallbackExtension}`;
  }
}

function getStreamFilename(stream) {
  const extension = stream.extension || "media";
  return getFilenameFromUrl(stream.url, extension);
}

function formatTime(timestamp) {
  if (!timestamp) return "";

  const date = new Date(timestamp);

  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function downloadDirectStream(stream, buttonElement) {
  buttonElement.disabled = true;
  buttonElement.textContent = "Старт...";

  chrome.runtime.sendMessage(
    {
      type: "DOWNLOAD_MEDIA",
      url: stream.url,
      filename: getStreamFilename(stream)
    },
    (response) => {
      buttonElement.disabled = false;

      if (!response || !response.ok) {
        buttonElement.textContent = "Ошибка";
        setStatus(response?.error || "Не удалось начать скачивание.");
        return;
      }

      buttonElement.textContent = "Скачать";
      setStatus("Скачивание запущено.");
    }
  );
}

function openStreamTool(stream) {
  const filename = getStreamFilename(stream);

  if (stream.type === "hls") {
    chrome.tabs.create({
      url:
        chrome.runtime.getURL("hls/hls.html") +
        `?url=${encodeURIComponent(stream.url)}` +
        `&filename=${encodeURIComponent(filename)}`
    });

    return;
  }

  if (stream.type === "dash") {
    chrome.tabs.create({
      url:
        chrome.runtime.getURL("dash/dash.html") +
        `?url=${encodeURIComponent(stream.url)}` +
        `&filename=${encodeURIComponent(filename)}`
    });
  }
}

function createStreamElement(stream) {
  const item = document.createElement("div");
  item.className = "stream-item";

  const main = document.createElement("div");
  main.className = "stream-main";

  const title = document.createElement("div");
  title.className = "stream-title";
  title.textContent = `${formatStreamType(stream)} · .${stream.extension || "?"}`;

  const meta = document.createElement("div");
  meta.className = "stream-meta";

  const parts = [];

  if (stream.contentType) parts.push(stream.contentType);
  if (stream.source) parts.push(`source: ${stream.source}`);
  if (stream.requestType) parts.push(stream.requestType);
  if (stream.foundAt) parts.push(formatTime(stream.foundAt));

  meta.textContent = parts.join(" · ");

  const url = document.createElement("div");
  url.className = "stream-url";
  url.textContent = stream.url;

  main.appendChild(title);
  main.appendChild(meta);
  main.appendChild(url);

  const actionButton = document.createElement("button");
  actionButton.className = "stream-action";
  actionButton.type = "button";

  if (stream.type === "hls" || stream.type === "dash") {
    actionButton.textContent = "Открыть";
    actionButton.addEventListener("click", () => {
      openStreamTool(stream);
    });
  } else {
    actionButton.textContent = "Скачать";
    actionButton.addEventListener("click", () => {
      downloadDirectStream(stream, actionButton);
    });
  }

  item.appendChild(main);
  item.appendChild(actionButton);

  return item;
}

function renderStreams(streams) {
  streamsListElement.innerHTML = "";

  if (!streams || streams.length === 0) {
    streamsListElement.className = "list-box empty";
    streamsListElement.textContent =
      "Пока ничего не найдено. Запусти воспроизведение на странице и обнови popup.";
    return;
  }

  streamsListElement.className = "list-box";

  streams.forEach((stream) => {
    streamsListElement.appendChild(createStreamElement(stream));
  });
}

function renderDiagnostics(diagnostics) {
  diagnosticsListElement.innerHTML = "";

  if (!diagnostics || diagnostics.length === 0) {
    diagnosticsListElement.className = "list-box empty";
    diagnosticsListElement.textContent = "Диагностики пока нет.";
    return;
  }

  diagnosticsListElement.className = "list-box";

  diagnostics.slice(0, 8).forEach((diagnostic) => {
    const item = document.createElement("div");
    item.className = "diagnostic-item";

    const title = document.createElement("div");
    title.className = "diagnostic-title";
    title.textContent = diagnostic.message || diagnostic.code || "diagnostic";

    const meta = document.createElement("div");
    meta.className = "diagnostic-meta";

    const parts = [];

    if (diagnostic.code) parts.push(diagnostic.code);
    if (diagnostic.createdAt) parts.push(formatTime(diagnostic.createdAt));

    meta.textContent = parts.join(" · ");

    item.appendChild(title);
    item.appendChild(meta);

    diagnosticsListElement.appendChild(item);
  });
}

function refreshMediaState() {
  if (!currentTab || typeof currentTab.id !== "number") return;

  chrome.runtime.sendMessage(
    {
      type: "GET_MEDIA_DOWNLOADER_STATE",
      tabId: currentTab.id
    },
    (response) => {
      if (!response || !response.ok) {
        renderStreams([]);
        renderDiagnostics([]);
        return;
      }

      renderStreams(response.streams || []);
      renderDiagnostics(response.diagnostics || []);
    }
  );
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
  currentTab = tab;

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

  refreshButtonElement.addEventListener("click", refreshMediaState);
  clearButtonElement.addEventListener("click", clearDiagnostics);

  refreshMediaState();
}

initPopup();