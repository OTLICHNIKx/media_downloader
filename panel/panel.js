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
  const extension = stream.extension || "media";
  return getFilenameFromUrl(stream.url, extension);
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

function renderDiagnostics() {
  diagnosticsListElement.innerHTML = "";

  if (!currentDiagnostics || currentDiagnostics.length === 0) {
    diagnosticsListElement.className = "diagnostics-list empty";
    diagnosticsListElement.textContent = "Диагностики пока нет.";
    return;
  }

  diagnosticsListElement.className = "diagnostics-list";

  currentDiagnostics.slice(0, 20).forEach((diagnostic) => {
    const card = document.createElement("div");
    card.className = "diagnostic-card";

    const title = document.createElement("div");
    title.className = "diagnostic-title";
    title.textContent = diagnostic.message || diagnostic.code || "diagnostic";

    const meta = document.createElement("div");
    meta.className = "diagnostic-meta";

    const parts = [];

    if (diagnostic.code) parts.push(diagnostic.code);
    if (diagnostic.createdAt) parts.push(formatTime(diagnostic.createdAt));

    meta.textContent = parts.join(" · ");

    card.appendChild(title);
    card.appendChild(meta);

    diagnosticsListElement.appendChild(card);
  });
}

function renderAll() {
  updateCounters();
  renderStreams();
  renderDiagnostics();
}

function refreshState() {
  if (!Number.isFinite(targetTabId)) {
    streamsListElement.className = "streams-list empty";
    streamsListElement.textContent = "Не удалось определить вкладку, для которой открыта панель.";
    return;
  }

  chrome.runtime.sendMessage(
    {
      type: "GET_MEDIA_DOWNLOADER_STATE",
      tabId: targetTabId
    },
    (response) => {
      if (!response || !response.ok) {
        currentStreams = [];
        currentDiagnostics = [];
        renderAll();
        return;
      }

      currentStreams = response.streams || [];
      currentDiagnostics = response.diagnostics || [];

      renderAll();
    }
  );
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

  refreshButtonElement.addEventListener("click", refreshState);
  clearDiagnosticsButtonElement.addEventListener("click", clearDiagnostics);

  filterButtonElements.forEach((button) => {
    button.addEventListener("click", () => {
      setFilter(button.dataset.filter || "all");
    });
  });

  refreshState();

  setInterval(() => {
    refreshState();
  }, 3000);
}

initPanel();