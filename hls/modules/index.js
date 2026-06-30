import {
  sourceUrlElement,
  closeButtonElement,
  variantSelectElement,
  downloadButtonElement,
  cancelDownloadButtonElement,
  qualityControlsElement,
  downloaderState,
  initialPlaylistUrl,
  initialFallbackPlaylistId,
  isEmbedMode,
  setStatus,
  setProgress,
  setDetails,
  setControlsVisible,
  setDownloadUiState
} from "./ui-state.js";
import { fetchHlsPlaylistResourceWithFallback } from "./hls-fallback.js";
import { buildPlaylistSourceDetails, buildFallbackDetails } from "./hls-fallback.js";
import {
  parseMasterPlaylist,
  prepareMediaPlaylist
} from "./playlist-parse.js";
import {
  renderVariantOptions,
  renderSinglePlaylistOption,
  prepareSelectedVariant,
  startPreparedDownload,
  buildPreparedDetails
} from "./downloader.js";

if (isEmbedMode) {
  document.body.classList.add("embed-mode");
}

if (closeButtonElement) {
  closeButtonElement.addEventListener("click", () => {
    window.parent.postMessage(
      {
        source: "MEDIA_DOWNLOADER_HLS",
        type: "CLOSE"
      },
      "*"
    );
  });
}

async function initializeHlsDownloader() {
  if (!initialPlaylistUrl) {
    setStatus("Ошибка: HLS URL не передан.");
    return;
  }

  sourceUrlElement.textContent = initialPlaylistUrl;
  setControlsVisible(false);

  try {
    setStatus("Загружаю HLS playlist...");
    setProgress(4);

    const playlistResource = await fetchHlsPlaylistResourceWithFallback(initialPlaylistUrl);

    sourceUrlElement.textContent = playlistResource.resolvedFrom
      ? `${playlistResource.resolvedFrom}\n→ ${playlistResource.playlistUrl}`
      : playlistResource.playlistUrl;

    const variants = parseMasterPlaylist(
      playlistResource.playlistText,
      playlistResource.playlistUrl
    );

    setControlsVisible(true);

    if (variants.length > 0) {
      downloaderState.loadedMasterVariants = variants;
      renderVariantOptions(downloaderState.loadedMasterVariants);
      await prepareSelectedVariant();
      return;
    }

    downloaderState.loadedMasterVariants = [];
    renderSinglePlaylistOption();

    downloaderState.preparedDownload = prepareMediaPlaylist(
      playlistResource.playlistUrl,
      playlistResource.playlistText
    );

    setDetails(
      buildPlaylistSourceDetails(playlistResource) +
      buildFallbackDetails(playlistResource) +
      buildPreparedDetails(downloaderState.preparedDownload)
    );

    setStatus("Готово к скачиванию. Нажми «Скачать выбранное».");
    setProgress(0);
    setDownloadUiState(false);
  } catch (error) {
    console.error("[HLS Downloader]", error);
    setControlsVisible(false);
    setStatus(`Ошибка: ${error.message}`);
    setProgress(0);
  }
}

// NOTE: buildPreparedDetails импортирован вверху из downloader.js и используется
// здесь для single-playlist ветки.

if (variantSelectElement) {
  variantSelectElement.addEventListener("change", () => {
    prepareSelectedVariant();
  });
}

if (downloadButtonElement) {
  downloadButtonElement.addEventListener("click", () => {
    startPreparedDownload();
  });
}

if (cancelDownloadButtonElement) {
  cancelDownloadButtonElement.addEventListener("click", () => {
    if (downloaderState.currentDownloadAbortController) {
      downloaderState.currentDownloadAbortController.abort();
    }
  });
}

initializeHlsDownloader();
