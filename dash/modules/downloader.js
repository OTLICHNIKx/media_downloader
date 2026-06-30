import { fetchArrayBuffer } from "../../shared/http.js";
import { sanitizeFilename } from "../../shared/filename.js";
import {
  dashState,
  representationSelectElement,
  initialFilename,
  setStatus,
  setProgress,
  setDetails,
  setDownloadUiState
} from "./ui-state.js";
import { buildRepresentationLabel } from "./mpd-parse.js";

// Локальный formatBytes (возвращает "0 B" для нуля).
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

function replaceFileExtension(filename, extension) {
  const cleanName = sanitizeFilename(filename || "media.mpd");
  const withoutQuery = cleanName.split("?")[0].split("#")[0];

  if (withoutQuery.toLowerCase().endsWith(".mpd")) {
    return withoutQuery.replace(/\.mpd$/i, extension);
  }

  if (/\.[a-z0-9]{2,5}$/i.test(withoutQuery)) {
    return withoutQuery.replace(/\.[a-z0-9]{2,5}$/i, extension);
  }

  return `${withoutQuery}${extension}`;
}

export function renderRepresentationOptions(representations) {
  representationSelectElement.innerHTML = representations
    .map((representation, index) => {
      return `<option value="${index}">${buildRepresentationLabel(representation, index)}</option>`;
    })
    .join("");
}

export function getSelectedRepresentationIndex() {
  const selectedIndex = Number(representationSelectElement.value);

  if (Number.isNaN(selectedIndex)) {
    return 0;
  }

  return selectedIndex;
}

export function renderRepresentationDetails(representation, progressInfo = null) {
  const outputFilename = replaceFileExtension(
    initialFilename,
    representation.outputInfo.extension
  );

  const lines = [
    `Representation: ${representation.id}`,
    `Bandwidth: ${representation.bandwidth}`,
    `Codecs: ${representation.codecs || "unknown"}`,
    `MIME: ${representation.mimeType || "unknown"}`,
    `Схема сегментов: ${representation.segmentSource || "unknown"}`,
    `Init segment: ${representation.initUrl ? "есть" : "нет"}`,
    `Сегментов: ${representation.segmentCount}`,
    `Тип результата: ${representation.outputInfo.extension}`,
    `Имя файла: ${outputFilename}`
  ];

  if (progressInfo) {
    lines.push("");
    lines.push(`Загружено сегментов: ${progressInfo.downloadedSegments} из ${representation.segmentCount}`);
    lines.push(`Загружено данных: ${formatBytes(progressInfo.downloadedBytes)}`);
  }

  lines.push("");
  lines.push(
    "Ограничение: сейчас поддерживается только audio-only DASH через SegmentTemplate или SegmentList. " +
    "Видео+аудио без muxing пока не собираются."
  );

  setDetails(lines.join("\n"));
}

export function selectCurrentRepresentation() {
  const selectedIndex = getSelectedRepresentationIndex();

  dashState.selectedRepresentation = dashState.audioRepresentations[selectedIndex] || null;

  if (!dashState.selectedRepresentation) {
    setStatus("Ошибка: выбранное audio representation не найдено.");
    setDownloadUiState(false);
    return;
  }

  renderRepresentationDetails(dashState.selectedRepresentation);
  setStatus("Готово к скачиванию. Нажми «Скачать выбранное».");
  setProgress(0);
  setDownloadUiState(false);
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

export async function startSelectedDownload() {
  if (!dashState.selectedRepresentation || dashState.currentDownloadAbortController) return;

  const abortController = new AbortController();
  dashState.currentDownloadAbortController = abortController;

  const buffers = [];
  let downloadedBytes = 0;
  let downloadedSegments = 0;

  const outputFilename = replaceFileExtension(
    initialFilename,
    dashState.selectedRepresentation.outputInfo.extension
  );

  setDownloadUiState(true);
  setProgress(3);

  try {
    if (dashState.selectedRepresentation.initUrl) {
      setStatus("Загружаю init segment...");

      const initBuffer = await fetchArrayBuffer(dashState.selectedRepresentation.initUrl, {
        signal: abortController.signal,
        label: "init segment"
      });

      buffers.push(initBuffer);
      downloadedBytes += initBuffer.byteLength;

      renderRepresentationDetails(dashState.selectedRepresentation, {
        downloadedSegments,
        downloadedBytes
      });
    }

    for (let index = 0; index < dashState.selectedRepresentation.segmentUrls.length; index += 1) {
      const segmentUrl = dashState.selectedRepresentation.segmentUrls[index];

      setStatus(`Загружаю сегмент ${index + 1} из ${dashState.selectedRepresentation.segmentUrls.length}...`);
      setProgress(8 + ((index + 1) / dashState.selectedRepresentation.segmentUrls.length) * 84);

      const buffer = await fetchArrayBuffer(segmentUrl, {
        signal: abortController.signal,
        label: `сегмент ${index + 1}`
      });

      buffers.push(buffer);
      downloadedSegments += 1;
      downloadedBytes += buffer.byteLength;

      renderRepresentationDetails(dashState.selectedRepresentation, {
        downloadedSegments,
        downloadedBytes
      });
    }

    setStatus("Собираю audio файл...");
    setProgress(95);

    const blob = new Blob(buffers, {
      type: dashState.selectedRepresentation.outputInfo.mimeType
    });

    setDetails(
      `${document.getElementById("details").textContent}\n\nИтоговый размер: ${formatBytes(blob.size)}`
    );

    await downloadBlob(blob, outputFilename);
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("Скачивание отменено.");
      setProgress(0);
      return;
    }

    console.error("[DASH Downloader]", error);
    setStatus(`Ошибка: ${error.message}`);
  } finally {
    dashState.currentDownloadAbortController = null;
    setDownloadUiState(false);
  }
}
