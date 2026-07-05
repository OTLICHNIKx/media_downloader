// Локальные UI-элементы HLS-страницы. Каждая страница имеет свой DOM.

export const sourceUrlElement = document.getElementById("sourceUrl");
export const statusElement = document.getElementById("status");
export const detailsElement = document.getElementById("details");
export const progressBarElement = document.getElementById("progressBar");
export const closeButtonElement = document.getElementById("closeButton");
export const qualityControlsElement = document.getElementById("qualityControls");
export const variantSelectElement = document.getElementById("variantSelect");
export const outputModeSelectElement = document.getElementById("outputModeSelect");
export const downloadButtonElement = document.getElementById("downloadButton");
export const cancelDownloadButtonElement = document.getElementById("cancelDownloadButton");

export const params = new URLSearchParams(window.location.search);
export const initialFallbackPlaylistId = params.get("fallbackPlaylistId") || "";
export const initialPlaylistUrl = params.get("url");
export const initialFilename = params.get("filename") || "media.m3u8";
export const initialOutputMode = params.get("outputMode") === "mp3" ? "mp3" : "original";
export const isEmbedMode = params.get("embed") === "1";
// Сайт-источник (soundcloud / null). Управляет дефолтами панели:
// на SoundCloud — авто-выбор MP3 и автостарт скачивания.
export const initialSite = params.get("site") || null;

export const initialSoundCloudTrackId = params.get("soundCloudTrackId") || "";
export const initialSoundCloudPermalinkUrl = params.get("soundCloudPermalinkUrl") || "";
export const initialSoundCloudClientId = params.get("soundCloudClientId") || "";
export const initialSoundCloudApiUrl = params.get("soundCloudApiUrl") || "";

// Разделяемое состояние downloader'а. Изменяется downloader.js, читается index.js.
export const downloaderState = {
  loadedMasterVariants: [],
  preparedDownload: null,
  currentDownloadAbortController: null,
  outputMode: initialOutputMode,
  outputModeAvailable: false,
  expectedDurationMs: 0
};

export function setStatus(text) {
  statusElement.textContent = text;
}

export function setDetails(text) {
  detailsElement.textContent = text;
}

export function setProgress(percent) {
  const safePercent = Math.max(0, Math.min(100, percent));
  progressBarElement.style.width = `${safePercent}%`;
}

export function setControlsVisible(visible) {
  if (qualityControlsElement) {
    qualityControlsElement.hidden = !visible;
  }
}

export function setOutputMode(mode) {
  downloaderState.outputMode = mode === "mp3" ? "mp3" : "original";
}

export function setOutputModeAvailable(available) {
  downloaderState.outputModeAvailable = Boolean(available);

  if (!downloaderState.outputModeAvailable && downloaderState.outputMode === "mp3") {
    downloaderState.outputMode = "original";
  }

  if (outputModeSelectElement) {
    outputModeSelectElement.disabled = !downloaderState.outputModeAvailable;
    outputModeSelectElement.value = downloaderState.outputMode;
    outputModeSelectElement.title = downloaderState.outputModeAvailable
      ? ""
      : "MP3 доступен только для audio-only HLS результатов.";
  }
}

export function setDownloadUiState(isDownloading) {
  if (downloadButtonElement) {
    downloadButtonElement.disabled = isDownloading || !downloaderState.preparedDownload;
  }

  if (variantSelectElement) {
    variantSelectElement.disabled = isDownloading || downloaderState.loadedMasterVariants.length === 0;
  }

  if (outputModeSelectElement) {
    outputModeSelectElement.disabled = isDownloading || !downloaderState.outputModeAvailable;
  }

  if (cancelDownloadButtonElement) {
    cancelDownloadButtonElement.hidden = !isDownloading;
  }
}
