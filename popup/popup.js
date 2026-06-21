const siteHostElement = document.getElementById("siteHost");
const siteToggleElement = document.getElementById("siteToggle");
const statusElement = document.getElementById("status");
const streamsListElement = document.getElementById("streamsList");
const diagnosticsListElement = document.getElementById("diagnosticsList");
const refreshButtonElement = document.getElementById("refreshButton");
const clearButtonElement = document.getElementById("clearButton");
const openPanelButtonElement = document.getElementById("openPanelButton");
const streamsCounterElement = document.getElementById("streamsCounter");
const filterButtonElements = Array.from(document.querySelectorAll("[data-stream-filter]"));

let currentTab = null;
let currentFilter = "all";
let currentStreams = [];

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

function getStreamTypeFromExtension(extension) {
  const cleanExtension = String(extension || "").replace(/^\./, "").toLowerCase();

  if (cleanExtension === "m3u8") return "hls";
  if (cleanExtension === "mpd") return "dash";

  if (["mp3", "m4a", "aac", "ogg", "opus", "wav", "flac"].includes(cleanExtension)) {
    return "audio";
  }

  if (["mp4", "webm", "m4v", "mov"].includes(cleanExtension)) {
    return "video";
  }

  return "media";
}

function getFilteredStreams(streams) {
  if (currentFilter === "all") {
    return streams;
  }

  if (currentFilter === "stream") {
    return streams.filter((stream) => stream.type === "hls" || stream.type === "dash");
  }

  return streams.filter((stream) => stream.type === currentFilter);
}

function updateFilterButtons() {
  filterButtonElements.forEach((button) => {
    button.classList.toggle("active", button.dataset.streamFilter === currentFilter);
  });
}

function setStreamsCounter(totalCount, visibleCount) {
  if (!streamsCounterElement) return;

  if (currentFilter === "all") {
    streamsCounterElement.textContent = String(totalCount);
    return;
  }

  streamsCounterElement.textContent = `${visibleCount}/${totalCount}`;
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
  if (stream.filename) return sanitizeFilename(stream.filename);

  const extension = stream.extension || "media";
  return getFilenameFromUrl(stream.url, extension);
}

function normalizePageMediaItem(mediaItem) {
  if (!mediaItem || !mediaItem.url) return null;

  const extension = mediaItem.extension || "media";
  const type = mediaItem.streamType || getStreamTypeFromExtension(extension);

  return {
    url: mediaItem.url,
    type,
    extension,
    contentType: null,
    contentLength: null,
    qualityLabel: mediaItem.quality && mediaItem.quality !== "unknown" ? mediaItem.quality : null,
    source: mediaItem.source ? `page:${mediaItem.source}` : "page",
    requestType: "page-scan",
    foundAt: Date.now(),
    filename: mediaItem.filename || getFilenameFromUrl(mediaItem.url, extension)
  };
}

function mergeStreams(backgroundStreams, pageMediaItems) {
  const resultByUrl = new Map();

  (backgroundStreams || []).forEach((stream) => {
    if (!stream || !stream.url) return;
    resultByUrl.set(stream.url, { ...stream });
  });

  (pageMediaItems || []).forEach((mediaItem) => {
    const pageStream = normalizePageMediaItem(mediaItem);
    if (!pageStream) return;

    const existingStream = resultByUrl.get(pageStream.url);

    if (existingStream) {
      resultByUrl.set(pageStream.url, {
        ...existingStream,
        type: existingStream.type || pageStream.type,
        extension: existingStream.extension || pageStream.extension,
        qualityLabel: existingStream.qualityLabel || pageStream.qualityLabel,
        filename: existingStream.filename || pageStream.filename,
        source:
          existingStream.source && !existingStream.source.includes(pageStream.source)
            ? `${existingStream.source}+${pageStream.source}`
            : existingStream.source || pageStream.source
      });

      return;
    }

    resultByUrl.set(pageStream.url, pageStream);
  });

  return Array.from(resultByUrl.values()).sort((a, b) => {
    return Number(b.foundAt || b.updatedAt || 0) - Number(a.foundAt || a.updatedAt || 0);
  });
}

function formatBytes(bytes) {
  const number = Number(bytes);

  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = number;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const formattedValue = value >= 10 ? value.toFixed(1) : value.toFixed(2);

  return `${formattedValue} ${units[unitIndex]}`;
}

function getHostFromStreamUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function getStreamMetaParts(stream) {
  const parts = [];

  const host = getHostFromStreamUrl(stream.url);
  const size = formatBytes(stream.contentLength);

  if (stream.contentType) parts.push(stream.contentType);
  if (host) parts.push(host);
  if (stream.qualityLabel) parts.push(stream.qualityLabel);
  if (size) parts.push(size);
  if (stream.statusCode) parts.push(`HTTP ${stream.statusCode}`);
  if (stream.acceptRanges) parts.push(`ranges: ${stream.acceptRanges}`);
  if (stream.source) parts.push(`source: ${stream.source}`);
  if (stream.requestType) parts.push(stream.requestType);
  if (stream.foundAt) parts.push(formatTime(stream.foundAt));

  return parts;
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

  const parts = getStreamMetaParts(stream);
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

function renderStreams(streams = currentStreams) {
  streamsListElement.innerHTML = "";

  const allStreams = Array.isArray(streams) ? streams : [];
  const filteredStreams = getFilteredStreams(allStreams);

  setStreamsCounter(allStreams.length, filteredStreams.length);
  updateFilterButtons();

  if (allStreams.length === 0) {
    streamsListElement.className = "list-box empty";
    streamsListElement.textContent =
      "Пока ничего не найдено. Нажми Rescan или запусти воспроизведение на странице.";
    return;
  }

  if (filteredStreams.length === 0) {
    streamsListElement.className = "list-box empty";
    streamsListElement.textContent = "В этом фильтре потоков нет.";
    return;
  }

  streamsListElement.className = "list-box";

  filteredStreams.forEach((stream) => {
    streamsListElement.appendChild(createStreamElement(stream));
  });
}

function getScanSummaryParts(scanSummary) {
  if (!scanSummary || !scanSummary.data) return [];

  const data = scanSummary.data;
  const parts = [];

  const directFound =
    Number(data.inlineLinkMediaFound || 0) +
    Number(data.inlineMediaFound || 0);

  parts.push(`прямые: ${directFound}`);
  parts.push(`видимые ссылки: ${data.visibleLinks || 0}`);
  parts.push(`audio/video: ${data.visibleMediaElements || 0}`);
  parts.push(`кнопок: ${data.buttonsOnPage || 0}`);

  if (data.adapter) {
    parts.push(`adapter: ${data.adapter}`);
  }

  if (scanSummary.updatedAt) {
    parts.push(formatTime(scanSummary.updatedAt));
  }

  return parts;
}

function getDiagnosticMetaParts(diagnostic) {
  if (!diagnostic) return [];

  const parts = [];
  const data = diagnostic.data || {};

  if (diagnostic.code) parts.push(diagnostic.code);
  if (data.adapter) parts.push(`adapter: ${data.adapter}`);
  if (Number.isFinite(Number(data.adapterCandidates)) && Number(data.adapterCandidates) > 0) {
    parts.push(`кандидатов: ${Number(data.adapterCandidates)}`);
  }
  if (data.contentType) parts.push(`type: ${data.contentType}`);
  if (data.statusCode) parts.push(`status: ${data.statusCode}`);
  if (data.trackTitle) parts.push(`track: ${data.trackTitle}`);

  const diagnosticUrl = data.url || data.lastObservedUrl || data.pageUrl;
  if (diagnosticUrl) {
    const host = getHostFromUrl(diagnosticUrl);
    if (host) parts.push(`host: ${host}`);
  }

  if (diagnostic.createdAt) parts.push(formatTime(diagnostic.createdAt));

  return parts;
}

function renderDiagnostics(diagnostics, scanSummary = null) {
  diagnosticsListElement.innerHTML = "";

  const hasScanSummary = Boolean(scanSummary);
  const hasDiagnostics = diagnostics && diagnostics.length > 0;

  if (!hasScanSummary && !hasDiagnostics) {
    diagnosticsListElement.className = "list-box empty";
    diagnosticsListElement.textContent = "Диагностики пока нет.";
    return;
  }

  diagnosticsListElement.className = "list-box";

  if (hasScanSummary) {
    const item = document.createElement("div");
    item.className = "diagnostic-item";

    const title = document.createElement("div");
    title.className = "diagnostic-title";
    title.textContent = scanSummary.message || "Текущий скан страницы";

    const meta = document.createElement("div");
    meta.className = "diagnostic-meta";
    meta.textContent = getScanSummaryParts(scanSummary).join(" · ");

    item.appendChild(title);
    item.appendChild(meta);

    diagnosticsListElement.appendChild(item);
  }

  diagnostics.slice(0, 8).forEach((diagnostic) => {
    const item = document.createElement("div");
    item.className = "diagnostic-item";

    const title = document.createElement("div");
    title.className = "diagnostic-title";
    title.textContent = diagnostic.message || diagnostic.code || "diagnostic";

    const meta = document.createElement("div");
    meta.className = "diagnostic-meta";
    meta.textContent = getDiagnosticMetaParts(diagnostic).join(" · ");

    item.appendChild(title);
    item.appendChild(meta);

    const diagnosticUrl = diagnostic?.data?.url || diagnostic?.data?.lastObservedUrl;

    if (diagnosticUrl) {
      const extra = document.createElement("div");
      extra.className = "diagnostic-meta";
      extra.textContent = diagnosticUrl;
      item.appendChild(extra);
    }

    diagnosticsListElement.appendChild(item);
  });
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

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }

      resolve(response || null);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }

      resolve(response || null);
    });
  });
}

async function getBackgroundMediaState(tabId) {
  const response = await sendRuntimeMessage({
    type: "GET_MEDIA_DOWNLOADER_STATE",
    tabId
  });

  if (!response || !response.ok) {
    return {
      streams: [],
      diagnostics: [],
      scanSummary: null
    };
  }

  return {
    streams: response.streams || [],
    diagnostics: response.diagnostics || [],
    scanSummary: response.scanSummary || null
  };
}

async function getPageMediaItems(tabId, forceRescan = false) {
  const response = await sendTabMessage(tabId, {
    type: forceRescan ? "RESCAN_MEDIA_DOWNLOADER_PAGE" : "SCAN_MEDIA"
  });

  if (!response || !response.ok) {
    return [];
  }

  return response.media || [];
}

async function refreshMediaState(options = {}) {
  if (!currentTab || typeof currentTab.id !== "number") return;

  const forceRescan = Boolean(options.forceRescan);

  if (forceRescan) {
    setStatus("Сканирую страницу и Network-потоки...");
  }

  const [backgroundState, pageMediaItems] = await Promise.all([
    getBackgroundMediaState(currentTab.id),
    getPageMediaItems(currentTab.id, forceRescan)
  ]);

  currentStreams = mergeStreams(backgroundState.streams, pageMediaItems);

  renderStreams(currentStreams);
  renderDiagnostics(backgroundState.diagnostics, backgroundState.scanSummary);

  setStatus(
    currentStreams.length > 0
      ? `Найдено: ${currentStreams.length}. Фильтр: ${currentFilter}.`
      : "Потоки пока не найдены. Запусти воспроизведение или нажми Rescan."
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

  refreshButtonElement.addEventListener("click", () => {
  refreshMediaState({ forceRescan: true });
});

  filterButtonElements.forEach((button) => {
    button.addEventListener("click", () => {
      currentFilter = button.dataset.streamFilter || "all";
      renderStreams(currentStreams);
      setStatus(`Фильтр: ${currentFilter}. Показано: ${getFilteredStreams(currentStreams).length}.`);
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