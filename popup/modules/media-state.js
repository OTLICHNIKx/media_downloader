import { formatTime, getHostFromUrl } from "../../shared/format.js";
import { normalizePageMediaItem } from "../../shared/stream-types.js";
import {
  diagnosticsListElement,
  currentTab,
  currentStreams,
  currentFilter,
  setCurrentStreams,
  setStatus
} from "./ui-state.js";
import { renderStreams } from "./streams-render.js";

// Локальный mergeStreams: popup-специфичный spread-порядок (отличается от panel).
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

export async function refreshMediaState(options = {}) {
  if (!currentTab || typeof currentTab.id !== "number") return;

  const forceRescan = Boolean(options.forceRescan);

  if (forceRescan) {
    setStatus("Сканирую страницу и Network-потоки...");
  }

  const [backgroundState, pageMediaItems] = await Promise.all([
    getBackgroundMediaState(currentTab.id),
    getPageMediaItems(currentTab.id, forceRescan)
  ]);

  const merged = mergeStreams(backgroundState.streams, pageMediaItems);
  setCurrentStreams(merged);

  renderStreams(merged);
  renderDiagnostics(backgroundState.diagnostics, backgroundState.scanSummary);

  setStatus(
    merged.length > 0
      ? `Найдено: ${merged.length}. Фильтр: ${currentFilter}.`
      : "Потоки пока не найдены. Запусти воспроизведение или нажми Rescan."
  );
}
