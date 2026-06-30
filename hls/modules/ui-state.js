// Локальные UI-элементы HLS-страницы. Каждая страница имеет свой DOM.

export const sourceUrlElement = document.getElementById("sourceUrl");
export const statusElement = document.getElementById("status");
export const detailsElement = document.getElementById("details");
export const progressBarElement = document.getElementById("progressBar");
export const closeButtonElement = document.getElementById("closeButton");
export const qualityControlsElement = document.getElementById("qualityControls");
export const variantSelectElement = document.getElementById("variantSelect");
export const downloadButtonElement = document.getElementById("downloadButton");
export const cancelDownloadButtonElement = document.getElementById("cancelDownloadButton");

export const params = new URLSearchParams(window.location.search);
export const initialFallbackPlaylistId = params.get("fallbackPlaylistId") || "";
export const initialPlaylistUrl = params.get("url");
export const initialFilename = params.get("filename") || "media.m3u8";
export const isEmbedMode = params.get("embed") === "1";

// Разделяемое состояние downloader'а. Изменяется downloader.js, читается index.js.
export const downloaderState = {
  loadedMasterVariants: [],
  preparedDownload: null,
  currentDownloadAbortController: null
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

export function setDownloadUiState(isDownloading) {
  if (downloadButtonElement) {
    downloadButtonElement.disabled = isDownloading || !downloaderState.preparedDownload;
  }

  if (variantSelectElement) {
    variantSelectElement.disabled = isDownloading || downloaderState.loadedMasterVariants.length === 0;
  }

  if (cancelDownloadButtonElement) {
    cancelDownloadButtonElement.hidden = !isDownloading;
  }
}
