import { normalizePageMediaItem } from "../../shared/stream-types.js";
import {
  targetTabId,
  streamsListElement,
  totalCountElement,
  audioCountElement,
  videoCountElement,
  hlsCountElement,
  dashCountElement,
  currentStreams,
  setCurrentStreams,
  setCurrentDiagnostics,
  setCurrentScanSummary
} from "./ui-state.js";
import { renderStreams } from "./streams-render.js";
import { renderDiagnostics } from "./diagnostics.js";

// Локальный mergeStreams: panel-специфичный spread-порядок (отличается от popup).
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

function updateCounters() {
  totalCountElement.textContent = String(currentStreams.length);
  audioCountElement.textContent = String(currentStreams.filter((stream) => stream.type === "audio").length);
  videoCountElement.textContent = String(currentStreams.filter((stream) => stream.type === "video").length);
  hlsCountElement.textContent = String(currentStreams.filter((stream) => stream.type === "hls").length);
  dashCountElement.textContent = String(currentStreams.filter((stream) => stream.type === "dash").length);
}

function renderAll() {
  updateCounters();
  renderStreams();
  renderDiagnostics();
}

export async function refreshState(options = {}) {
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

  setCurrentStreams(mergeStreams(backgroundState.streams, pageMediaItems));
  setCurrentDiagnostics(backgroundState.diagnostics || []);
  setCurrentScanSummary(backgroundState.scanSummary || null);

  renderAll();
}

export function clearDiagnostics() {
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
