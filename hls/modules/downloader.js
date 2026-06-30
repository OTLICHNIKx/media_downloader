import { fetchArrayBuffer } from "../../shared/http.js";
import { formatBandwidth } from "../../shared/format.js";
import {
  downloaderState,
  variantSelectElement,
  setStatus,
  setDetails,
  setProgress,
  setDownloadUiState
} from "./ui-state.js";
import { fetchHlsPlaylistResource } from "./hls-fallback.js";
import { buildPlaylistSourceDetails, buildFallbackDetails } from "./hls-fallback.js";
import { prepareMediaPlaylist } from "./playlist-parse.js";

// Локальный formatBytes: возвращает "0 B" для нуля (отличается от popup/panel, которые возвращают null).
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function buildVariantLabel(variant, index) {
  const parts = [];

  if (variant.resolution && variant.resolution !== "unknown") {
    parts.push(variant.resolution);
  }

  parts.push(formatBandwidth(variant.bandwidth));

  if (variant.codecs && variant.codecs !== "unknown") {
    parts.push(variant.codecs);
  }

  return `${index + 1}. ${parts.join(" · ")}`;
}

export function buildPreparedDetails(prepared, progressInfo = null) {
  const lines = [];

  if (prepared.variant) {
    lines.push("Найден master playlist.");
    lines.push(`Выбран вариант: ${buildVariantLabel(prepared.variant, prepared.variantIndex)}`);
    lines.push(`Media playlist: ${prepared.playlistUrl}`);
    lines.push("");
  }

  lines.push(`Сегментов: ${prepared.segmentUrls.length}`);
  lines.push(`Init segment: ${prepared.initMapUrl ? "есть" : "нет"}`);
  lines.push(`Тип результата: ${prepared.outputInfo.extension}`);
  lines.push(`Имя файла: ${prepared.outputFilename}`);
  lines.push("Размер: будет известен во время загрузки");

  if (prepared.isLiveLikePlaylist) {
    lines.push("");
    lines.push(
      "Внимание: playlist похож на live/динамический поток, потому что в нём нет #EXT-X-ENDLIST. " +
      "Будет сохранён только текущий набор сегментов."
    );
  }

  if (progressInfo) {
    lines.push("");
    lines.push(`Загружено сегментов: ${progressInfo.downloadedSegments} из ${prepared.segmentUrls.length}`);
    lines.push(`Загружено данных: ${formatBytes(progressInfo.downloadedBytes)}`);
  }

  return lines.join("\n");
}

export function renderVariantOptions(variants) {
  if (!variantSelectElement) return;

  variantSelectElement.disabled = false;
  variantSelectElement.innerHTML = variants
    .map((variant, index) => {
      return `<option value="${index}">${buildVariantLabel(variant, index)}</option>`;
    })
    .join("");
}

export function renderSinglePlaylistOption() {
  if (!variantSelectElement) return;

  variantSelectElement.innerHTML = `<option value="single">Исходный media playlist</option>`;
  variantSelectElement.disabled = true;
}

function getSelectedVariantIndex() {
  if (!variantSelectElement) return 0;

  const selectedIndex = Number(variantSelectElement.value);

  if (Number.isNaN(selectedIndex)) {
    return 0;
  }

  return selectedIndex;
}

export async function prepareSelectedVariant() {
  if (downloaderState.loadedMasterVariants.length === 0) return;

  const selectedIndex = getSelectedVariantIndex();
  const selectedVariant = downloaderState.loadedMasterVariants[selectedIndex];

  if (!selectedVariant) {
    setStatus("Ошибка: выбранный вариант HLS не найден.");
    return;
  }

  downloaderState.preparedDownload = null;
  setDownloadUiState(false);
  setStatus("Загружаю выбранный media playlist...");
  setProgress(8);

  try {
    const playlistResource = await fetchHlsPlaylistResource(selectedVariant.url);

    downloaderState.preparedDownload = prepareMediaPlaylist(
      playlistResource.playlistUrl,
      playlistResource.playlistText,
      selectedVariant,
      selectedIndex
    );

    setDetails(
      buildPlaylistSourceDetails(playlistResource) +
      buildFallbackDetails(playlistResource) +
      buildPreparedDetails(downloaderState.preparedDownload)
    );

    setStatus("Готово к скачиванию. Выбери качество и нажми «Скачать выбранное».");
    setProgress(0);
    setDownloadUiState(false);
  } catch (error) {
    console.error("[HLS Downloader] prepare variant failed", error);
    setStatus(`Ошибка: ${error.message}`);
    setDetails("");
    setProgress(0);
  }
}

function renderDownloadProgress(prepared, downloadedSegments, downloadedBytes) {
  setDetails(
    buildPreparedDetails(prepared, {
      downloadedSegments,
      downloadedBytes
    })
  );
}

async function downloadBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);

  chrome.downloads.download(
    {
      url: objectUrl,
      filename,
      saveAs: true
    },
    (downloadId) => {
      if (chrome.runtime.lastError) {
        setStatus(`Ошибка сохранения: ${chrome.runtime.lastError.message}`);
        URL.revokeObjectURL(objectUrl);
        return;
      }

      setStatus("Файл собран. Скачивание запущено.");
      setProgress(100);

      setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 60_000);
    }
  );
}

export async function startPreparedDownload() {
  if (!downloaderState.preparedDownload || downloaderState.currentDownloadAbortController) return;

  const abortController = new AbortController();
  downloaderState.currentDownloadAbortController = abortController;

  const prepared = downloaderState.preparedDownload;
  const buffers = [];
  let downloadedBytes = 0;
  let downloadedSegments = 0;

  setDownloadUiState(true);
  setProgress(3);

  try {
    if (prepared.initMapUrl) {
      setStatus("Загружаю init segment...");

      const initBuffer = await fetchArrayBuffer(prepared.initMapUrl, {
        signal: abortController.signal,
        label: "init segment"
      });

      buffers.push(initBuffer);
      downloadedBytes += initBuffer.byteLength;
      renderDownloadProgress(prepared, downloadedSegments, downloadedBytes);
    }

    for (let index = 0; index < prepared.segmentUrls.length; index += 1) {
      const segmentUrl = prepared.segmentUrls[index];

      setStatus(`Загружаю сегмент ${index + 1} из ${prepared.segmentUrls.length}...`);
      setProgress(10 + ((index + 1) / prepared.segmentUrls.length) * 80);

      const buffer = await fetchArrayBuffer(segmentUrl, {
        signal: abortController.signal,
        label: `сегмент ${index + 1}`
      });

      buffers.push(buffer);
      downloadedSegments += 1;
      downloadedBytes += buffer.byteLength;
      renderDownloadProgress(prepared, downloadedSegments, downloadedBytes);
    }

    setStatus("Собираю файл...");
    setProgress(95);

    const blob = new Blob(buffers, {
      type: prepared.outputInfo.mimeType
    });

    setDetails(
      `${buildPreparedDetails(prepared, {
        downloadedSegments,
        downloadedBytes: blob.size
      })}\n\nИтоговый размер: ${formatBytes(blob.size)}`
    );

    await downloadBlob(blob, prepared.outputFilename);
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("Скачивание отменено.");
      setProgress(0);
      return;
    }

    console.error("[HLS Downloader]", error);
    setStatus(`Ошибка: ${error.message}`);
  } finally {
    downloaderState.currentDownloadAbortController = null;
    setDownloadUiState(false);
  }
}
