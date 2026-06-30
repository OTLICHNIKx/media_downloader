// Локальные UI-элементы DASH-страницы.

export const sourceUrlElement = document.getElementById("sourceUrl");
export const statusElement = document.getElementById("status");
export const detailsElement = document.getElementById("details");
export const progressBarElement = document.getElementById("progressBar");
export const closeButtonElement = document.getElementById("closeButton");
export const representationControlsElement = document.getElementById("representationControls");
export const representationSelectElement = document.getElementById("representationSelect");
export const downloadButtonElement = document.getElementById("downloadButton");
export const cancelDownloadButtonElement = document.getElementById("cancelDownloadButton");

export const params = new URLSearchParams(window.location.search);
export const initialMpdUrl = params.get("url");
export const initialFilename = params.get("filename") || "media.mpd";
export const isEmbedMode = params.get("embed") === "1";

// Разделяемое состояние. Изменяется downloader.js, читается index.js.
export const dashState = {
  audioRepresentations: [],
  selectedRepresentation: null,
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
  representationControlsElement.hidden = !visible;
}

export function setDownloadUiState(isDownloading) {
  downloadButtonElement.disabled = isDownloading || !dashState.selectedRepresentation;
  representationSelectElement.disabled = isDownloading;

  cancelDownloadButtonElement.hidden = !isDownloading;
}
