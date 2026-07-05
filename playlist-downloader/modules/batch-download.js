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

const HLS_GROWING_PLAYLIST_EXTRA_WAIT_MS = 120_000;
const HLS_GROWING_PLAYLIST_MIN_RELOAD_DELAY_MS = 2_000;
const HLS_GROWING_PLAYLIST_MAX_RELOAD_DELAY_MS = 12_000;
const HLS_GROWING_PLAYLIST_STABLE_ROUNDS_AFTER_EXPECTED = 3;
const TRACK_DOWNLOAD_MAX_ATTEMPTS = 3;
const TRACK_DOWNLOAD_RETRY_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableTrackDownloadError(error) {
  const message = error?.message || String(error);

  return (
    message.includes("HTTP 404") ||
    message.includes("HTTP 405") ||
    message.includes("HLS playlist неполный") ||
    message.includes("HLS playlist выглядит неполным") ||
    message.includes("stale") ||
    message.includes("протух")
  );
}

function resolvePlaylistUrl(baseUrl, maybeRelativeUrl) {
  return new URL(maybeRelativeUrl, baseUrl).href;
}

function getHlsTargetDurationMs(playlistText) {
  const match = String(playlistText || "").match(/#EXT-X-TARGETDURATION:(\d+(?:\.\d+)?)/);

  if (!match) {
    return 6_000;
  }

  return Math.max(
    HLS_GROWING_PLAYLIST_MIN_RELOAD_DELAY_MS,
    Math.min(
      HLS_GROWING_PLAYLIST_MAX_RELOAD_DELAY_MS,
      Number.parseFloat(match[1]) * 1000
    )
  );
}

function getCollectedSegmentDurationMs(segmentUrls, segmentDurations) {
  return segmentUrls.reduce((sum, url) => {
    return sum + (segmentDurations.get(url) || 0);
  }, 0);
}

function parseHlsSegmentEntries(playlistText, playlistUrl) {
  const entries = [];
  const lines = String(playlistText || "").split(/\r?\n/);
  let pendingDuration = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const durationText = line
        .slice("#EXTINF:".length)
        .split(",")[0]
        .trim();

      pendingDuration = Number.parseFloat(durationText) || 0;
      continue;
    }

    if (line.startsWith("#")) {
      continue;
    }

    entries.push({
      url: resolvePlaylistUrl(playlistUrl, line),
      durationMs: Math.max(0, pendingDuration * 1000)
    });

    pendingDuration = 0;
  }

  return entries;
}

function getHlsPlaylistDurationMs(playlistText, playlistUrl = "") {
  const entries = parseHlsSegmentEntries(playlistText, playlistUrl);

  return entries.reduce((sum, entry) => {
    return sum + (Number(entry.durationMs) || 0);
  }, 0);
}

function getAllowedDurationGapMs(expectedDurationMs) {
  if (!expectedDurationMs) return 0;

  // Разрешаем небольшую погрешность, но не десятки секунд.
  // Для коротких треков: до 3 сек.
  // Для длинных: до 1%, но максимум 10 сек.
  return Math.min(
    10_000,
    Math.max(3_000, expectedDurationMs * 0.01)
  );
}

function assertDownloadedDurationLooksComplete(track, actualDurationMs) {
  const expectedDurationMs = Number(track?.durationMs || track?.duration || 0) || 0;

  if (!expectedDurationMs || !actualDurationMs) {
    return;
  }

  const allowedGapMs = getAllowedDurationGapMs(expectedDurationMs);

  if (actualDurationMs + allowedGapMs < expectedDurationMs) {
    throw new Error(
      `HLS playlist неполный: скачано ${Math.round(actualDurationMs / 1000)}с из ${Math.round(expectedDurationMs / 1000)}с. Повторите попытку или перезагрузите страницу SoundCloud.`
    );
  }
}

function getPreparedPlaylistDurationMs(prepared) {
  const entries = parseHlsSegmentEntries(
    prepared.playlistText,
    prepared.playlistUrl
  );

  return entries.reduce((sum, entry) => sum + entry.durationMs, 0);
}

async function fetchPlaylistText(url, abortController) {
  const response = await fetch(url, {
    signal: abortController.signal,
    credentials: "include",
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache"
    }
  });

  if (!response.ok) {
    throw new Error(`HLS playlist HTTP ${response.status}`);
  }

  return response.text();
}

function getTrackExpectedDurationMs(track) {
  return Number(track?.durationMs || track?.duration || 0) || 0;
}

function shouldTryGrowPlaylist(prepared, track) {
  const expectedDurationMs = getTrackExpectedDurationMs(track);

  if (prepared.playlistText.includes("#EXT-X-ENDLIST")) {
    return false;
  }

  if (!expectedDurationMs) {
    return true;
  }

  const currentDurationMs = getPreparedPlaylistDurationMs(prepared);

  return currentDurationMs > 0 && currentDurationMs < expectedDurationMs * 0.9;
}

async function prepareCompleteMediaPlaylist(resource, track, index, abortController, callbacks) {
  let prepared = prepareMediaPlaylist(
    resource.playlistUrl,
    resource.playlistText
  );

  const expectedDurationMs = getTrackExpectedDurationMs(track);

  const segmentUrls = [];
  const segmentDurations = new Map();
  const seenSegments = new Set();

  let latestPrepared = prepared;
  let latestPlaylistText = resource.playlistText;
  let reloadDelayMs = getHlsTargetDurationMs(resource.playlistText);
  let stableRoundsAfterExpected = 0;

  function mergePrepared(nextPrepared) {
    latestPrepared = nextPrepared;
    latestPlaylistText = nextPrepared.playlistText || latestPlaylistText;

    const entries = parseHlsSegmentEntries(
      nextPrepared.playlistText,
      nextPrepared.playlistUrl
    );

    let added = 0;

    for (const entry of entries) {
      if (seenSegments.has(entry.url)) continue;

      seenSegments.add(entry.url);
      segmentUrls.push(entry.url);
      segmentDurations.set(entry.url, entry.durationMs);
      added += 1;
    }

    reloadDelayMs = getHlsTargetDurationMs(nextPrepared.playlistText);

    return added;
  }

  mergePrepared(prepared);

  let collectedDurationMs = getCollectedSegmentDurationMs(
    segmentUrls,
    segmentDurations
  );

  const hasEndListInitially = latestPlaylistText.includes("#EXT-X-ENDLIST");

  // Если это обычный VOD playlist с ENDLIST — ждать не нужно.
  if (hasEndListInitially) {
    return {
      ...latestPrepared,
      segmentUrls,
      hlsDurationMs: collectedDurationMs,
      isLiveLikePlaylist: false
    };
  }

  // Если длительность неизвестна, лучше не ждать бесконечно.
  // Но если durationMs есть — ждём почти полную длительность трека.
  const maxWaitMs = expectedDurationMs
    ? expectedDurationMs + HLS_GROWING_PLAYLIST_EXTRA_WAIT_MS
    : 5 * 60_000;

  const startedAt = Date.now();

  while (!abortController.signal.aborted) {
    collectedDurationMs = getCollectedSegmentDurationMs(
      segmentUrls,
      segmentDurations
    );

    const expectedReached =
      expectedDurationMs &&
      collectedDurationMs >= expectedDurationMs * 0.98;

    const hasEndList = latestPlaylistText.includes("#EXT-X-ENDLIST");

    if (hasEndList) {
      break;
    }

    if (expectedReached) {
      stableRoundsAfterExpected += 1;

      if (stableRoundsAfterExpected >= HLS_GROWING_PLAYLIST_STABLE_ROUNDS_AFTER_EXPECTED) {
        break;
      }
    } else {
      stableRoundsAfterExpected = 0;
    }

    const waitedMs = Date.now() - startedAt;

    if (waitedMs >= maxWaitMs) {
      break;
    }

    callbacks.onStage(
      index,
      "playlist",
      expectedDurationMs
        ? `Ожидание полного HLS: ${Math.round(collectedDurationMs / 1000)}с / ${Math.round(expectedDurationMs / 1000)}с`
        : `Ожидание полного HLS: ${segmentUrls.length} сегм.`
    );

    await sleep(reloadDelayMs);

    const nextPlaylistText = await fetchPlaylistText(
      resource.playlistUrl,
      abortController
    );

    const nextPrepared = prepareMediaPlaylist(
      resource.playlistUrl,
      nextPlaylistText
    );

    mergePrepared(nextPrepared);
  }

  collectedDurationMs = getCollectedSegmentDurationMs(
    segmentUrls,
    segmentDurations
  );

  const allowedGapMs = getAllowedDurationGapMs(expectedDurationMs);

  if (
    expectedDurationMs &&
    collectedDurationMs > 0 &&
    collectedDurationMs + allowedGapMs < expectedDurationMs
  ) {
    throw new Error(
      `HLS playlist неполный: собрано ${Math.round(collectedDurationMs / 1000)}с из ${Math.round(expectedDurationMs / 1000)}с`
    );
  }

  return {
    ...latestPrepared,
    segmentUrls,
    hlsDurationMs: collectedDurationMs,
    isLiveLikePlaylist: !latestPlaylistText.includes("#EXT-X-ENDLIST")
  };
}

function sanitizeTrackName(name) {
  const cleaned = sanitizeFilename(name || "");

  return cleaned.slice(0, 160) || "track";
}

function buildTrackFilename(index, track) {
  const authorPart = track.author ? `${track.author} - ` : "";

  return sanitizeTrackName(`${authorPart}${track.title}`);
}

// Запрос к SoundCloud API через background service worker.
// Background добавляет client_id к API URL и имеет доступ к cookies.
// Возвращает { playlistUrl, playlistText } либо бросает.
function resolveTrackHlsViaBackground(track, clientId) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
    {
      type: "RESOLVE_TRACK_HLS",
      trackId: track.trackId,
      trackUrn: track.trackUrn,
      permalinkUrl: track.permalinkUrl,
      clientId
    },
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
          kind: response.kind || "hls",
          playlistUrl: response.playlistUrl || "",
          playlistText: response.playlistText || "",
          directUrl: response.directUrl || "",
          directExtension: response.directExtension || "",
          directMimeType: response.directMimeType || "",
          durationMs: response.durationMs || 0
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
async function downloadTrackOnce(track, index, clientId, abortController, callbacks) {
  const baseName = buildTrackFilename(index, track);
  if (track.availabilityReason) {
    throw new Error(track.availabilityReason);
  }
  callbacks.onStage(index, "playlist", "Загрузка плейлиста");

  // 1. Запрос к SoundCloud API через background (cookies + client_id).
  const resource = await resolveTrackHlsViaBackground(track, clientId);
  const effectiveTrack = {
    ...track,
    durationMs: track.durationMs || resource.durationMs || 0
  };
  if (resource.kind === "direct" && resource.directUrl) {
  callbacks.onStage(index, "segments", "Загрузка progressive audio");

  const directBuffer = await fetchArrayBuffer(resource.directUrl, {
    signal: abortController.signal,
    label: "progressive audio"
  });

  const directExt = resource.directExtension || ".mp3";

  return {
    filename: `${baseName}${directExt}`,
    arrayBuffer: directBuffer
  };
}

  if (!resource.playlistUrl || !resource.playlistText) {
    throw new Error(
      `SoundCloud не вернул HLS playlist: kind=${resource.kind || "unknown"}`
    );
  }

  // 2. Парсинг сегментов.
  const prepared = await prepareCompleteMediaPlaylist(
    resource,
    effectiveTrack,
    index,
    abortController,
    callbacks
  );

  assertDownloadedDurationLooksComplete(
  effectiveTracktrack,
  prepared.hlsDurationMs || getHlsPlaylistDurationMs(
    resource.playlistText,
    resource.playlistUrl
  )
);

  const expectedDurationMs = Number(track.durationMs || 0) || 0;
  const actualDurationMs = getPreparedPlaylistDurationMs(prepared);

  const allowedGapMs = getAllowedDurationGapMs(expectedDurationMs);

  if (
    expectedDurationMs &&
    collectedDurationMs > 0 &&
    collectedDurationMs + allowedGapMs < expectedDurationMs
  ) {
    throw new Error(
      `HLS playlist выглядит неполным: собрано ${Math.round(collectedDurationMs / 1000)}с из ${Math.round(expectedDurationMs / 1000)}с`
    );
  }

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

async function downloadTrack(track, index, clientId, abortController, callbacks) {
  let lastError = null;

  for (let attempt = 1; attempt <= TRACK_DOWNLOAD_MAX_ATTEMPTS; attempt++) {
    if (abortController.signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    try {
      if (attempt > 1) {
        callbacks.onStage(
          index,
          "playlist",
          `Повторная попытка ${attempt}/${TRACK_DOWNLOAD_MAX_ATTEMPTS}`
        );

        await sleep(TRACK_DOWNLOAD_RETRY_DELAY_MS);
      }

      return await downloadTrackOnce(
        track,
        index,
        clientId,
        abortController,
        callbacks
      );
    } catch (error) {
      lastError = error;

      if (!isRetryableTrackDownloadError(error)) {
        throw error;
      }

      console.warn(
        "[Media Downloader] Track download retryable error:",
        track?.title,
        error?.message || error
      );
    }
  }

  throw lastError || new Error("Не удалось скачать трек после повторных попыток");
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

function normalizeDownloadErrorMessage(error) {
  const message = error?.message || String(error);

  if (message.includes("SAMPLE-AES")) {
    return "Защищённый поток SAMPLE-AES: скачивание недоступно";
  }

  if (message.includes("preview") || message.includes("30-секунд")) {
    return "Доступен только preview, полный трек SoundCloud не отдаёт";
  }

  if (message.includes("HTTP 405")) {
    return "SoundCloud вернул 405: stream URL устарел или недоступен, попробуйте перезагрузить страницу и запустить заново";
  }

  return message;
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

      onTrackError && onTrackError(i, normalizeDownloadErrorMessage(error));
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
