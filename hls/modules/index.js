import {
  sourceUrlElement,
  closeButtonElement,
  variantSelectElement,
  outputModeSelectElement,
  downloadButtonElement,
  cancelDownloadButtonElement,
  downloaderState,
  initialPlaylistUrl,
  initialFilename,
  initialOutputMode,
  isEmbedMode,
  initialSite,
  setStatus,
  setProgress,
  setDetails,
  setControlsVisible,
  setDownloadUiState,
  setOutputMode,
  setOutputModeAvailable
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
import { ensureMp3TranscoderLoaded } from "../../shared/transcode.js";

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

// SoundCloud-дефолты: авто-выбор MP3 + автостарт скачивания после подготовки.
// Флаг autoStartTriggered защищает от повторного запуска (инициализация может
// пройти через master-variant или single-playlist ветку, плюс re-prepare).
let autoStartTriggered = false;

function isSoundCloudAutoMode() {
  return initialSite === "soundcloud";
}

// Вызывается после того, как preparedDownload готов и доступность MP3 известна.
// Если включён SoundCloud-режим и MP3 доступен — выставляет MP3, начинает
// предзагрузку транскодера и сразу запускает скачивание.
function maybeAutoStartForSite() {
  if (!isSoundCloudAutoMode()) return;
  if (autoStartTriggered) return;
  if (!downloaderState.preparedDownload) return;

  if (!downloaderState.outputModeAvailable) {
    // MP3 недоступен (например, не audio-only) — автостарт не запускаем,
    // оставляем ручной режим, чтобы пользователь сам решил.
    return;
  }

  autoStartTriggered = true;

  setOutputMode("mp3");
  if (outputModeSelectElement) {
    outputModeSelectElement.value = "mp3";
  }

  // Предзагрузка транскодера параллельно со скачиванием сегментов.
  ensureMp3TranscoderLoaded().catch((error) => {
    console.warn("[HLS Downloader] MP3 transcoder preload failed:", error);
  });

  startPreparedDownload();
}

async function initializeHlsDownloader() {
  if (!initialPlaylistUrl) {
    setStatus("Ошибка: HLS URL не передан.");
    return;
  }

  sourceUrlElement.textContent = initialPlaylistUrl;
  setControlsVisible(false);
  setOutputMode(initialOutputMode);
  setOutputModeAvailable(false);

  try {
    setStatus("Загружаю HLS playlist...");
    setProgress(4);

    const playlistResource = await fetchHlsPlaylistResourceWithFallback(initialPlaylistUrl);
    downloaderState.expectedDurationMs = Number(playlistResource.durationMs || 0) || 0;

    if (playlistResource.kind === "direct" && playlistResource.directUrl) {
      const directExtension = playlistResource.directExtension || ".mp3";
      const directMimeType = playlistResource.directMimeType || "audio/mpeg";

      sourceUrlElement.textContent = playlistResource.resolvedFrom
        ? `${playlistResource.resolvedFrom}\n→ ${playlistResource.directUrl}`
        : playlistResource.directUrl;

      downloaderState.loadedMasterVariants = [];

      downloaderState.preparedDownload = {
        kind: "direct",
        directUrl: playlistResource.directUrl,
        directExtension,
        directMimeType,
        outputFilename: initialFilename.replace(/\.m3u8$/i, directExtension),
        outputInfo: {
          mimeType: directMimeType,
          extension: directExtension.replace(/^\./, "")
        },
        expectedDurationMs: downloaderState.expectedDurationMs || 0
      };

      renderSinglePlaylistOption();
      setControlsVisible(true);
      setOutputModeAvailable(false);

      setDetails(
        [
          "SoundCloud fresh resolve: direct/progressive audio",
          `Direct URL: ${playlistResource.directUrl}`,
          `Тип: ${directMimeType}`,
          `Имя файла: ${downloaderState.preparedDownload.outputFilename}`,
          ""
        ].join("\n")
      );

      setStatus("Готово к скачиванию direct audio.");
      setProgress(0);
      setDownloadUiState(false);

      maybeAutoStartForSite();
      return;
    }

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
      maybeAutoStartForSite();
      return;
    }

    downloaderState.loadedMasterVariants = [];
    renderSinglePlaylistOption();

    downloaderState.preparedDownload = prepareMediaPlaylist(
      playlistResource.playlistUrl,
      playlistResource.playlistText
    );

    downloaderState.preparedDownload.expectedDurationMs =
      downloaderState.expectedDurationMs || 0;

    setOutputModeAvailable(Boolean(downloaderState.preparedDownload?.outputInfo?.mimeType?.startsWith("audio/")));

    setDetails(
      buildPlaylistSourceDetails(playlistResource) +
      buildFallbackDetails(playlistResource) +
      buildPreparedDetails(downloaderState.preparedDownload)
    );

    setStatus("Готово к скачиванию. Нажми «Скачать выбранное».");
    setProgress(0);
    setDownloadUiState(false);

    maybeAutoStartForSite();
  } catch (error) {
    console.error("[HLS Downloader]", error);
    setControlsVisible(false);
    setStatus(`Ошибка: ${error.message}`);
    setProgress(0);
  }
}

if (variantSelectElement) {
  variantSelectElement.addEventListener("change", () => {
    prepareSelectedVariant();
  });
}

if (outputModeSelectElement) {
  outputModeSelectElement.addEventListener("change", () => {
    setOutputMode(outputModeSelectElement.value);

    // Предзагрузка транскодера: запускаем загрузку wasm сразу при выборе
    // MP3, параллельно с дальнейшими действиями пользователя (выбор
    // качества, ожидание старта скачивания). К моменту finalizeOutput
    // ffmpeg уже готов — экономия ~1-3с на загрузке/компиляции.
    if (downloaderState.outputMode === "mp3" && downloaderState.outputModeAvailable) {
      ensureMp3TranscoderLoaded().catch((error) => {
        // Ошибка предзагрузки не критична: finalizeOutput попробует снова.
        console.warn("[HLS Downloader] MP3 transcoder preload failed:", error);
      });
    }
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
