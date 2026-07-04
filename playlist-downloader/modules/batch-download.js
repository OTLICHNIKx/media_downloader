// Ядро батч-скачивания плейлиста SoundCloud.
// Для каждого трека: RESOLVE_TRACK_HLS (background fetch с cookies) → .m3u8 текст
// → парсинг сегментов → параллельная загрузка сегментов → склейка → MP3.
// Результаты пакуются в ZIP.
//
// Переиспользует модули из hls/ и shared/ (парсинг, http, transcode).
// SoundCloud API запросы идут через background (RESOLVE_TRACK_HLS), т.к.
// из extension page SoundCloud отбрасывает их с HTTP 401.

import { prepareMediaPlaylist } from "../../hls/modules/playlist-parse.js";
import { fetchArrayBuffer } from "../../shared/http.js";
import {
  ensureMp3TranscoderLoaded,
  canTranscodeToMp3,
  transcodeAudioBlobToMp3
} from "../../shared/transcode.js";
import { sanitizeFilename } from "../../shared/filename.js";
import { zipSync } from "../../vendor/fflate/index.js";

// Размер пула одновременных загрузок сегментов (как в hls/modules/downloader.js).
const SEGMENT_DOWNLOAD_CONCURRENCY = 6;

function sanitizeTrackName(name) {
  const cleaned = sanitizeFilename(name || "");

  return cleaned.slice(0, 160) || "track";
}

function buildTrackFilename(index, track) {
  const number = String(index + 1).padStart(2, "0");
  const authorPart = track.author ? `${track.author} - ` : "";

  return sanitizeTrackName(`${number} - ${authorPart}${track.title}`);
}

// Запрос к SoundCloud API через background service worker.
// Background добавляет client_id к API URL и имеет доступ к cookies.
// Возвращает { playlistUrl, playlistText } либо бросает.
function resolveTrackHlsViaBackground(trackId, clientId) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "RESOLVE_TRACK_HLS", trackId, clientId },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response || !response.ok) {
          reject(new Error(response?.error || "RESOLVE_TRACK_HLS failed"));
          return;
        }

        resolve({
          playlistUrl: response.playlistUrl,
          playlistText: response.playlistText
        });
      }
    );
  });
}

// Параллельная загрузка сегментов с сохранением порядка по индексу.
// Копия логики из hls/modules/downloader.js (не экспортируется оттуда).
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

// Скачивает один трек: RESOLVE_TRACK_HLS → сегменты → MP3 (или оригинал).
// Бросает при ошибке (caller решает — пропустить трек или остановиться).
async function downloadTrack(track, index, clientId, abortController, callbacks) {
  const baseName = buildTrackFilename(index, track);

  callbacks.onStage(index, "playlist", "Загрузка плейлиста");

  // 1. Запрос к SoundCloud API через background (cookies + client_id).
  const resource = await resolveTrackHlsViaBackground(track.trackId, clientId);

  // 2. Парсинг сегментов.
  const prepared = prepareMediaPlaylist(
    resource.playlistUrl,
    resource.playlistText
  );

  callbacks.onStage(
    index,
    "segments",
    `Сегменты: 0 из ${prepared.segmentUrls.length}`,
    { total: prepared.segmentUrls.length, done: 0 }
  );

  // 3. Загрузка сегментов (init + segments).
  const buffers = [];

  if (prepared.initMapUrl) {
    callbacks.onStage(index, "segments", "Загрузка init segment");

    const initBuffer = await fetchArrayBuffer(prepared.initMapUrl, {
      signal: abortController.signal,
      label: "init segment"
    });

    buffers.push(initBuffer);
  }

  const segmentBuffers = await downloadSegmentsInParallel(
    prepared.segmentUrls,
    abortController,
    (segmentIndex) => {
      callbacks.onStage(index, "segments", null, {
        total: prepared.segmentUrls.length,
        done: segmentIndex + 1
      });
    }
  );

  for (const buffer of segmentBuffers) {
    buffers.push(buffer);
  }

  // 4. Склейка в аудио blob.
  const audioBlob = new Blob(buffers, {
    type: prepared.outputInfo.mimeType
  });

  const arrayBuffer = await audioBlob.arrayBuffer();

  // 5. Транскод в MP3 — если возможно. Иначе сохраняем оригинал (m4a/ts).
  const canMp3 = canTranscodeToMp3(prepared.outputInfo);

  if (canMp3) {
    callbacks.onStage(index, "transcode", "Конвертация в MP3");

    try {
      const mp3 = await transcodeAudioBlobToMp3(audioBlob, `${baseName}.mp3`, {
        inputExtension: prepared.outputInfo.extension,
        onLog(message) {
          if (!message) return;

          if (message.startsWith("size=") || message.includes("time=")) {
            callbacks.onStage(index, "transcode", "Конвертация в MP3");
          }
        }
      });

      return {
        filename: mp3.filename,
        arrayBuffer: await mp3.blob.arrayBuffer()
      };
    } catch (transcodeError) {
      // Если MP3 упал — не теряем трек, сохраняем оригинал.
      callbacks.onStage(
        index,
        "segments",
        "MP3 не удался — сохраняю оригинал"
      );

      const originalExt = prepared.outputInfo.extension || ".m4a";

      return {
        filename: `${baseName}${originalExt}`,
        arrayBuffer
      };
    }
  }

  // MP3 недоступен для этого потока — оригинальный формат.
  const originalExt = prepared.outputInfo.extension || ".m4a";

  return {
    filename: `${baseName}${originalExt}`,
    arrayBuffer
  };
}

// Главный цикл батч-скачивания. Идёт строго последовательно (по одному треку),
// т.к. ffmpeg.wasm — синглтон и не параллелится, плюс параллельная нагрузка
// на SoundCloud API может привести к rate-limit.
export async function runBatchDownload(tracks, callbacks = {}) {
  const {
    onTrackStart,
    onStage,
    onTrackDone,
    onTrackError,
    signal,
    clientId
  } = callbacks;

  const abortController = new AbortController();

  // Пробрасываем внешний abort во внутренний controller.
  if (signal) {
    if (signal.aborted) {
      abortController.abort();
    } else {
      signal.addEventListener("abort", () => abortController.abort(), {
        once: true
      });
    }
  }

  // Предзагружаем ffmpeg один раз перед циклом — переиспользуем для всех треков.
  await ensureMp3TranscoderLoaded();

  const results = [];

  for (let i = 0; i < tracks.length; i++) {
    if (abortController.signal.aborted) break;

    const track = tracks[i];

    try {
      onTrackStart && onTrackStart(i);

      const result = await downloadTrack(track, i, clientId, abortController, {
        onStage
      });

      results.push(result);

      onTrackDone && onTrackDone(i);
    } catch (error) {
      if (error.name === "AbortError") break;

      onTrackError && onTrackError(i, error.message || String(error));
      // Продолжаем со следующим треком.
    }
  }

  if (results.length === 0) {
    throw new Error("Ни один трек не был скачан.");
  }

  return results;
}

// Собирает ZIP из массива { filename, arrayBuffer } через fflate.
export function buildZipBlob(results, zipFilename) {
  const files = {};

  for (const result of results) {
    files[result.filename] = new Uint8Array(result.arrayBuffer);
  }

  const zipped = zipSync(files);

  return new Blob([zipped], { type: "application/zip" });
}
