import { fetchArrayBuffer } from "../../shared/http.js";
import { formatBandwidth } from "../../shared/format.js";
import {
  canTranscodeToMp3,
  ensureMp3TranscoderLoaded,
  transcodeAudioBlobToMp3
} from "../../shared/transcode.js";
import {
  downloaderState,
  variantSelectElement,
  setStatus,
  setDetails,
  setProgress,
  setDownloadUiState,
  setOutputModeAvailable
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

function updateOutputModeAvailability(prepared = downloaderState.preparedDownload) {
  setOutputModeAvailable(canTranscodeToMp3(prepared?.outputInfo));
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
  updateOutputModeAvailability(null);
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

    downloaderState.preparedDownload.expectedDurationMs =
      downloaderState.expectedDurationMs || 0;

    updateOutputModeAvailability(downloaderState.preparedDownload);

    setDetails(
      buildPlaylistSourceDetails(playlistResource) +
      buildFallbackDetails(playlistResource) +
      buildPreparedDetails(downloaderState.preparedDownload)
    );

    setStatus("Готово к скачиванию. Выбери качество и нажми «Скачать выбранное»."
    );
    setProgress(0);
    setDownloadUiState(false);
  } catch (error) {
    console.error("[HLS Downloader] prepare variant failed", error);
    setStatus(`Ошибка: ${error.message}`);
    setDetails("");
    setProgress(0);
    updateOutputModeAvailability(null);
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
    () => {
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

async function downloadDirectAudio(prepared, abortController) {
  setStatus("Загружаю direct audio...");
  setProgress(10);

  const directBuffer = await fetchArrayBuffer(prepared.directUrl, {
    signal: abortController.signal,
    label: "direct audio"
  });

  setProgress(85);

  const extension = prepared.directExtension || ".mp3";
  const mimeType = prepared.directMimeType || "audio/mpeg";

  const blob = new Blob([directBuffer], {
    type: mimeType
  });

  const filename =
    prepared.outputFilename ||
    `soundcloud-track${extension}`;

  await downloadBlob(blob, filename);
}

async function finalizeOutput(blob, prepared) {
  const originalFilename = prepared.outputFilename;

  if (downloaderState.outputMode !== "mp3") {
    await downloadBlob(blob, originalFilename);
    return;
  }

  if (!canTranscodeToMp3(prepared.outputInfo)) {
    throw new Error("MP3-конвертация доступна только для audio-only HLS результата.");
  }

  setStatus("Загружаю MP3 transcoder...");
  setProgress(96);

  await ensureMp3TranscoderLoaded({
    onLog(message) {
      if (!message) return;
      if (message.startsWith("size=") || message.includes("time=")) {
        setStatus("Конвертирую в MP3...");
      }
    }
  });

  setStatus("Конвертирую в MP3...");
  setProgress(98);

  const transcoded = await transcodeAudioBlobToMp3(blob, originalFilename, {
    inputExtension: prepared.outputInfo.extension,
    onLog(message) {
      if (!message) return;
      if (message.startsWith("size=") || message.includes("time=")) {
        setStatus("Конвертирую в MP3...");
      }
    }
  });

  setDetails(
    `${buildPreparedDetails(prepared, {
      downloadedSegments: prepared.segmentUrls.length,
      downloadedBytes: blob.size
    })}\n\nКонвертировано в MP3: ${transcoded.filename}`
  );

  await downloadBlob(transcoded.blob, transcoded.filename);
}

// Размер пула одновременных загрузок сегментов.
// 6 — баланс: браузер держит ~6 соединений на хост, бóльшая степень
// параллелизма упрётся в лимит и не даст выигрышка.
const SEGMENT_DOWNLOAD_CONCURRENCY = 6;

const HLS_COMPLETE_EXTRA_WAIT_MS = 120_000;
const HLS_COMPLETE_MIN_RELOAD_DELAY_MS = 2_000;
const HLS_COMPLETE_MAX_RELOAD_DELAY_MS = 12_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getHlsTargetDurationMs(playlistText) {
  const match = String(playlistText || "").match(
    /#EXT-X-TARGETDURATION:(\d+(?:\.\d+)?)/i
  );

  if (!match) return 6_000;

  return Math.max(
    HLS_COMPLETE_MIN_RELOAD_DELAY_MS,
    Math.min(
      HLS_COMPLETE_MAX_RELOAD_DELAY_MS,
      Number.parseFloat(match[1]) * 1000
    )
  );
}

function getHlsPlaylistDurationMs(playlistText) {
  const lines = String(playlistText || "").split(/\r?\n/);
  let totalMs = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed.startsWith("#EXTINF:")) {
      continue;
    }

    const seconds = Number.parseFloat(
      trimmed.slice("#EXTINF:".length).split(",")[0]
    );

    if (Number.isFinite(seconds)) {
      totalMs += seconds * 1000;
    }
  }

  return totalMs;
}

function getAllowedDurationGapMs(expectedDurationMs) {
  if (!expectedDurationMs) return 0;

  return Math.min(
    10_000,
    Math.max(3_000, expectedDurationMs * 0.01)
  );
}

function isPreparedDurationComplete(prepared) {
  const expectedDurationMs = Number(prepared?.expectedDurationMs || 0) || 0;

  if (!expectedDurationMs) {
    return true;
  }

  const actualDurationMs = getHlsPlaylistDurationMs(prepared.playlistText);
  const allowedGapMs = getAllowedDurationGapMs(expectedDurationMs);

  return actualDurationMs + allowedGapMs >= expectedDurationMs;
}

function getPreparedDurationStatus(prepared) {
  const expectedDurationMs = Number(prepared?.expectedDurationMs || 0) || 0;
  const actualDurationMs = getHlsPlaylistDurationMs(prepared.playlistText);

  return {
    expectedDurationMs,
    actualDurationMs
  };
}

async function reloadPreparedPlaylist(prepared, abortController) {
  const playlistResource = await fetchHlsPlaylistResource(prepared.playlistUrl, {
    signal: abortController.signal,
    label: "playlist"
  });

  const nextPrepared = prepareMediaPlaylist(
    playlistResource.playlistUrl,
    playlistResource.playlistText,
    prepared.variant,
    prepared.variantIndex
  );

  nextPrepared.expectedDurationMs = prepared.expectedDurationMs || 0;

  return nextPrepared;
}

async function waitForCompletePreparedPlaylist(prepared, abortController) {
  const expectedDurationMs = Number(prepared?.expectedDurationMs || 0) || 0;

  if (!expectedDurationMs) {
    return prepared;
  }

  let currentPrepared = prepared;
  const startedAt = Date.now();
  const maxWaitMs = expectedDurationMs + HLS_COMPLETE_EXTRA_WAIT_MS;

  while (!isPreparedDurationComplete(currentPrepared)) {
    const { actualDurationMs } = getPreparedDurationStatus(currentPrepared);

    if (Date.now() - startedAt >= maxWaitMs) {
      throw new Error(
        `HLS playlist неполный: получено ${Math.round(actualDurationMs / 1000)}с из ${Math.round(expectedDurationMs / 1000)}с`
      );
    }

    setStatus(
      `Ожидаю полный HLS: ${Math.round(actualDurationMs / 1000)}с из ${Math.round(expectedDurationMs / 1000)}с`
    );

    await sleep(getHlsTargetDurationMs(currentPrepared.playlistText));

    currentPrepared = await reloadPreparedPlaylist(
      currentPrepared,
      abortController
    );
  }

  const { actualDurationMs } = getPreparedDurationStatus(currentPrepared);

  console.log("[HLS Downloader] HLS duration complete", {
    actualDurationMs,
    expectedDurationMs,
    segments: currentPrepared.segmentUrls.length
  });

  return currentPrepared;
}

// Параллельная загрузка сегментов с сохранением порядка по индексу.
// Запускает до concurrency одновременных fetch; результат складывается
// в results[index], чтобы склейка шла строго в исходном порядке, а не
// в порядке завершения. Любая ошибка — отмена остальных через abortController.
async function downloadSegmentsInParallel(segmentUrls, abortController, onSegmentDone) {
  const results = new Array(segmentUrls.length).fill(null);
  let nextQueueIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextQueueIndex;
      nextQueueIndex += 1;

      if (index >= segmentUrls.length) return;

      const buffer = await fetchArrayBuffer(segmentUrls[index], {
        signal: abortController.signal,
        label: `сегмент ${index + 1}`
      });

      results[index] = buffer;
      onSegmentDone(index, buffer);
    }
  }

  const workerCount = Math.min(
    SEGMENT_DOWNLOAD_CONCURRENCY,
    segmentUrls.length
  );

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return results;
}

export async function startPreparedDownload() {
  if (
    !downloaderState.preparedDownload ||
    downloaderState.currentDownloadAbortController
  ) {
    return;
  }

  let prepared = downloaderState.preparedDownload;

  if (!prepared) {
    setStatus("Ошибка: media playlist не подготовлен.");
    return;
  }

  const abortController = new AbortController();
  downloaderState.currentDownloadAbortController = abortController;

  const buffers = [];
  let downloadedBytes = 0;
  let downloadedSegments = 0;

  setDownloadUiState(true);
  setProgress(3);

  try {
    if (prepared.kind === "direct" && prepared.directUrl) {
      setStatus("Загружаю direct audio...");
      setProgress(10);

      const directBuffer = await fetchArrayBuffer(prepared.directUrl, {
        signal: abortController.signal,
        label: "direct audio"
      });

      downloadedBytes = directBuffer.byteLength;
      setProgress(90);

      const directExtension = prepared.directExtension || ".mp3";
      const directMimeType = prepared.directMimeType || "audio/mpeg";

      const blob = new Blob([directBuffer], {
        type: directMimeType
      });

      const filename =
        prepared.outputFilename ||
        `soundcloud-track${directExtension}`;

      setDetails(
        [
          "SoundCloud direct/progressive audio",
          `Имя файла: ${filename}`,
          `Размер: ${formatBytes(blob.size)}`,
          `Тип: ${directMimeType}`
        ].join("\n")
      );

      const directPrepared = {
        ...prepared,
        outputInfo: {
          ...(prepared.outputInfo || {}),
          mimeType: directMimeType,
          extension: directExtension.replace(/^\./, "")
        }
      };

      setStatus("Собираю файл...");
      setProgress(95);

      await downloadBlob(blob, filename);
      return;
    }

    if (prepared.expectedDurationMs) {
      setStatus("Проверяю полноту HLS playlist...");

      prepared = await waitForCompletePreparedPlaylist(
        prepared,
        abortController
      );

      downloaderState.preparedDownload = prepared;
    }

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

    setStatus(
      `Загружаю сегменты (до ${Math.min(
        SEGMENT_DOWNLOAD_CONCURRENCY,
        prepared.segmentUrls.length
      )} параллельно)...`
    );

    const segmentBuffers = await downloadSegmentsInParallel(
      prepared.segmentUrls,
      abortController,
      (index, buffer) => {
        downloadedSegments += 1;
        downloadedBytes += buffer.byteLength;

        setStatus(
          `Загружено сегментов: ${downloadedSegments} из ${prepared.segmentUrls.length}`
        );

        setProgress(
          10 + (downloadedSegments / prepared.segmentUrls.length) * 80
        );

        renderDownloadProgress(prepared, downloadedSegments, downloadedBytes);
      }
    );

    for (const buffer of segmentBuffers) {
      buffers.push(buffer);
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

    await finalizeOutput(blob, prepared);
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("Скачивание отменено.");
      setProgress(0);
      return;
    }

    console.error("[HLS Downloader]", error);

    const errorMessage =
      error?.message || String(error) || "Неизвестная ошибка";

    setStatus(`Ошибка: ${errorMessage}`);
  } finally {
    downloaderState.currentDownloadAbortController = null;
    setDownloadUiState(false);
  }
}
