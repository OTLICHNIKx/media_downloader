const pageInfoElement = document.getElementById("pageInfo");

const refreshButtonElement = document.getElementById("refreshButton");
const clearDiagnosticsButtonElement = document.getElementById("clearDiagnosticsButton");

const streamsListElement = document.getElementById("streamsList");
const diagnosticsListElement = document.getElementById("diagnosticsList");

const totalCountElement = document.getElementById("totalCount");
const audioCountElement = document.getElementById("audioCount");
const videoCountElement = document.getElementById("videoCount");
const hlsCountElement = document.getElementById("hlsCount");
const dashCountElement = document.getElementById("dashCount");

const filterButtonElements = Array.from(document.querySelectorAll(".filter-button"));

const params = new URLSearchParams(window.location.search);

const targetTabId = Number(params.get("tabId"));
const targetTabUrl = params.get("tabUrl") || "";
const targetTitle = params.get("title") || "";

let currentFilter = "all";
let currentStreams = [];
let currentDiagnostics = [];
let currentScanSummary = null;
function formatStreamType(stream) {
  if (!stream) return "Media";

  if (stream.type === "hls") return "HLS";
  if (stream.type === "dash") return "DASH";
  if (stream.type === "audio") return "Audio";
  if (stream.type === "video") return "Video";

  return stream.type || "Media";
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

function formatTime(timestamp) {
  if (!timestamp) return "";

  const date = new Date(timestamp);

  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function getHostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
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
        ...pageStream,
        ...existingStream,
        source:
          existingStream.source && !existingStream.source.includes(pageStream.source)
            ? `${existingStream.source}+${pageStream.source}`
            : existingStream.source || pageStream.source,
        qualityLabel: existingStream.qualityLabel || pageStream.qualityLabel,
        filename: existingStream.filename || pageStream.filename
      });

      return;
    }

    resultByUrl.set(pageStream.url, pageStream);
  });

  return Array.from(resultByUrl.values()).sort((a, b) => {
    return Number(b.foundAt || b.updatedAt || 0) - Number(a.foundAt || a.updatedAt || 0);
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

function getStreamMetaParts(stream) {
  const parts = [];

  const host = getHostFromUrl(stream.url);
  const size = formatBytes(stream.contentLength);

  if (stream.contentType) parts.push(stream.contentType);
  if (host) parts.push(host);
  if (stream.qualityLabel) parts.push(stream.qualityLabel);
  if (size) parts.push(size);
  if (stream.statusCode) parts.push(`HTTP ${stream.statusCode}`);
  if (stream.acceptRanges) parts.push(`ranges: ${stream.acceptRanges}`);
  if (stream.source) parts.push(`source: ${stream.source}`);
  if (stream.requestType) parts.push(stream.requestType);
  if (stream.foundAt) parts.push(`found: ${formatTime(stream.foundAt)}`);
  if (stream.updatedAt) parts.push(`updated: ${formatTime(stream.updatedAt)}`);

  return parts;
}

function getFilteredStreams() {
  if (currentFilter === "all") {
    return currentStreams;
  }

  return currentStreams.filter((stream) => stream.type === currentFilter);
}

function updateCounters() {
  totalCountElement.textContent = String(currentStreams.length);
  audioCountElement.textContent = String(currentStreams.filter((stream) => stream.type === "audio").length);
  videoCountElement.textContent = String(currentStreams.filter((stream) => stream.type === "video").length);
  hlsCountElement.textContent = String(currentStreams.filter((stream) => stream.type === "hls").length);
  dashCountElement.textContent = String(currentStreams.filter((stream) => stream.type === "dash").length);
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
        return;
      }

      buttonElement.textContent = "Скачать";
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

function copyStreamUrl(stream, buttonElement) {
  navigator.clipboard.writeText(stream.url).then(() => {
    const oldText = buttonElement.textContent;
    buttonElement.textContent = "Скопировано";

    setTimeout(() => {
      buttonElement.textContent = oldText;
    }, 1000);
  });
}

function createStreamCard(stream) {
  const card = document.createElement("article");
  card.className = "stream-card";

  const content = document.createElement("div");

  const titleRow = document.createElement("div");
  titleRow.className = "stream-title-row";

  const title = document.createElement("div");
  title.className = "stream-type";
  title.textContent = `${formatStreamType(stream)} · .${stream.extension || "?"}`;

  titleRow.appendChild(title);

  if (stream.qualityLabel) {
    const qualityBadge = document.createElement("span");
    qualityBadge.className = "stream-badge";
    qualityBadge.textContent = stream.qualityLabel;
    titleRow.appendChild(qualityBadge);
  }

  const meta = document.createElement("div");
  meta.className = "stream-meta";
  meta.textContent = getStreamMetaParts(stream).join(" · ");

  const url = document.createElement("div");
  url.className = "stream-url";
  url.textContent = stream.url;

  content.appendChild(titleRow);
  content.appendChild(meta);
  content.appendChild(url);

  const actions = document.createElement("div");
  actions.className = "stream-actions";

  const mainActionButton = document.createElement("button");
  mainActionButton.className = "action-button";
  mainActionButton.type = "button";

  if (stream.type === "hls" || stream.type === "dash") {
    mainActionButton.textContent = "Открыть";
    mainActionButton.addEventListener("click", () => {
      openStreamTool(stream);
    });
  } else {
    mainActionButton.textContent = "Скачать";
    mainActionButton.addEventListener("click", () => {
      downloadDirectStream(stream, mainActionButton);
    });
  }

  const copyButton = document.createElement("button");
  copyButton.className = "action-button secondary";
  copyButton.type = "button";
  copyButton.textContent = "URL";
  copyButton.addEventListener("click", () => {
    copyStreamUrl(stream, copyButton);
  });

  actions.appendChild(mainActionButton);
  actions.appendChild(copyButton);

  card.appendChild(content);
  card.appendChild(actions);

  return card;
}

function renderStreams() {
  const streams = getFilteredStreams();

  streamsListElement.innerHTML = "";

  if (streams.length === 0) {
    streamsListElement.className = "streams-list empty";

    if (currentStreams.length === 0) {
      streamsListElement.textContent =
        "Потоки пока не найдены. Запусти воспроизведение на странице и нажми «Обновить».";
    } else {
      streamsListElement.textContent =
        "В этом фильтре потоков нет.";
    }

    return;
  }

  streamsListElement.className = "streams-list";

  streams.forEach((stream) => {
    streamsListElement.appendChild(createStreamCard(stream));
  });
}

function getScanSummaryParts(scanSummary) {
  if (!scanSummary || !scanSummary.data) return [];

  const data = scanSummary.data;
  const parts = [];

  const directFound =
    Number(data.inlineLinkMediaFound || 0) +
    Number(data.inlineMediaFound || 0);

  parts.push(`прямые media: ${directFound}`);
  parts.push(`видимые ссылки: ${data.visibleLinks || 0}`);
  parts.push(`audio/video элементов: ${data.visibleMediaElements || 0}`);
  parts.push(`кнопок на странице: ${data.buttonsOnPage || 0}`);

  if (data.adapter) {
    parts.push(`adapter: ${data.adapter}`);
  }

  if (scanSummary.updatedAt) {
    parts.push(`обновлено: ${formatTime(scanSummary.updatedAt)}`);
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

function renderDiagnostics() {
  diagnosticsListElement.innerHTML = "";

  const hasScanSummary = Boolean(currentScanSummary);
  const hasDiagnostics = currentDiagnostics && currentDiagnostics.length > 0;

  if (!hasScanSummary && !hasDiagnostics) {
    diagnosticsListElement.className = "diagnostics-list empty";
    diagnosticsListElement.textContent = "Диагностики пока нет.";
    return;
  }

  diagnosticsListElement.className = "diagnostics-list";

  if (hasScanSummary) {
    const card = document.createElement("div");
    card.className = "diagnostic-card";

    const title = document.createElement("div");
    title.className = "diagnostic-title";
    title.textContent = currentScanSummary.message || "Текущий скан страницы";

    const meta = document.createElement("div");
    meta.className = "diagnostic-meta";
    meta.textContent = getScanSummaryParts(currentScanSummary).join(" · ");

    card.appendChild(title);
    card.appendChild(meta);

    diagnosticsListElement.appendChild(card);
  }

  currentDiagnostics.slice(0, 20).forEach((diagnostic) => {
    const card = document.createElement("div");
    card.className = "diagnostic-card";

    const title = document.createElement("div");
    title.className = "diagnostic-title";
    title.textContent = diagnostic.message || diagnostic.code || "diagnostic";

    const meta = document.createElement("div");
    meta.className = "diagnostic-meta";
    meta.textContent = getDiagnosticMetaParts(diagnostic).join(" · ");

    card.appendChild(title);
    card.appendChild(meta);

    const diagnosticUrl = diagnostic?.data?.url || diagnostic?.data?.lastObservedUrl;

    if (diagnosticUrl) {
      const extra = document.createElement("div");
      extra.className = "diagnostic-meta";
      extra.textContent = diagnosticUrl;
      card.appendChild(extra);
    }

    diagnosticsListElement.appendChild(card);
  });
}

function renderAll() {
  updateCounters();
  renderStreams();
  renderDiagnostics();
}

async function refreshState(options = {}) {
  if (!Number.isFinite(targetTabId)) {
    streamsListElement.className = "streams-list empty";
    streamsListElement.textContent = "Не удалось определить вкладку, для которой открыта панель.";
    return;
  }

  const forceRescan = Boolean(options.forceRescan);

  const [backgroundState, pageMediaItems] = await Promise.all([
    getBackgroundMediaState(targetTabId),
    getPageMediaItems(targetTabId, forceRescan)
  ]);

  currentStreams = mergeStreams(backgroundState.streams, pageMediaItems);
  currentDiagnostics = backgroundState.diagnostics || [];
  currentScanSummary = backgroundState.scanSummary || null;

  renderAll();
}

function clearDiagnostics() {
  if (!Number.isFinite(targetTabId)) return;

  chrome.runtime.sendMessage(
    {
      type: "CLEAR_MEDIA_DOWNLOADER_DIAGNOSTICS",
      tabId: targetTabId
    },
    () => {
      refreshState();
    }
  );
}

function setFilter(nextFilter) {
  currentFilter = nextFilter;

  filterButtonElements.forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === nextFilter);
  });

  renderStreams();
}

function initPanel() {
  const host = getHostFromUrl(targetTabUrl);
  const titleText = targetTitle || "Текущая вкладка";

  pageInfoElement.textContent = host
    ? `${titleText} · ${host}`
    : titleText;

  refreshButtonElement.addEventListener("click", () => {
    refreshState({ forceRescan: true });
  });
  clearDiagnosticsButtonElement.addEventListener("click", clearDiagnostics);

  filterButtonElements.forEach((button) => {
    button.addEventListener("click", () => {
      setFilter(button.dataset.filter || "all");
    });
  });

  refreshState({ forceRescan: true });

  setInterval(() => {
    refreshState();
  }, 3000);
}

initPanel();