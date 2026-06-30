import { fetchText } from "../../shared/http.js";
import {
  sourceUrlElement,
  closeButtonElement,
  representationSelectElement,
  downloadButtonElement,
  cancelDownloadButtonElement,
  representationControlsElement,
  detailsElement,
  dashState,
  initialMpdUrl,
  isEmbedMode,
  setStatus,
  setProgress,
  setDetails,
  setControlsVisible,
  setDownloadUiState
} from "./ui-state.js";
import { parseAudioRepresentations } from "./mpd-parse.js";
import {
  renderRepresentationOptions,
  selectCurrentRepresentation,
  startSelectedDownload
} from "./downloader.js";

if (isEmbedMode) {
  document.body.classList.add("embed-mode");
}

if (closeButtonElement) {
  closeButtonElement.addEventListener("click", () => {
    window.parent.postMessage(
      {
        source: "MEDIA_DOWNLOADER_DASH",
        type: "CLOSE"
      },
      "*"
    );
  });
}

async function initializeDashDownloader() {
  if (!initialMpdUrl) {
    setStatus("Ошибка: DASH MPD URL не передан.");
    return;
  }

  sourceUrlElement.textContent = initialMpdUrl;
  setControlsVisible(false);
  setDownloadUiState(false);

  try {
    setStatus("Загружаю DASH MPD...");
    setProgress(5);

    const mpdText = await fetchText(initialMpdUrl, { label: "MPD" });

    setStatus("Разбираю MPD...");
    setProgress(15);

    dashState.audioRepresentations = parseAudioRepresentations(mpdText, initialMpdUrl);

    if (dashState.audioRepresentations.length === 0) {
      setStatus("В MPD не найдено audio-only representations, которые можно скачать.");
      setDetails(
        "Сейчас поддерживается только audio AdaptationSet/Representation с SegmentTemplate или SegmentList. " +
        "SegmentBase, DRM и сборка video+audio пока не реализованы."
      );
      setProgress(0);
      return;
    }

    renderRepresentationOptions(dashState.audioRepresentations);
    setControlsVisible(true);
    selectCurrentRepresentation();
  } catch (error) {
    console.error("[DASH Downloader]", error);
    setStatus(`Ошибка: ${error.message}`);
    setDetails("");
    setProgress(0);
  }
}

if (representationSelectElement) {
  representationSelectElement.addEventListener("change", () => {
    selectCurrentRepresentation();
  });
}

if (downloadButtonElement) {
  downloadButtonElement.addEventListener("click", () => {
    startSelectedDownload();
  });
}

if (cancelDownloadButtonElement) {
  cancelDownloadButtonElement.addEventListener("click", () => {
    if (dashState.currentDownloadAbortController) {
      dashState.currentDownloadAbortController.abort();
    }
  });
}

initializeDashDownloader();
