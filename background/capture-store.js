import { activeCapturesByTabId, capturedStreamsByTabId } from "./state.js";
import { isSoundCloudPlaybackHlsEndpoint, getSoundCloudCaptureHint, getSoundCloudTrackIdFromUrl } from "./soundcloud-helpers.js";
import { isManifestLikeStream, isFragmentLikeUrl, getCaptureCandidateScore, shouldReplaceCapturedStream } from "./url-classify.js";
import { rememberDiagnostic } from "./diagnostics.js";
import {
  rememberSoundCloudFragmentFallback,
  attachSoundCloudFallbackToCapturedStream,
  resendCapturedStreamWithFallbackIfNeeded
} from "./soundcloud-fragment.js";
import { resolveSoundCloudPlaylistUrl, getSoundCloudTrackIdByPlaylistUrl } from "./soundcloud-resolve.js";

// Определяет track id потока для текущей вкладки.
// — API/media URL содержит id напрямую (soundcloud:tracks:NNN).
// — playback playlist URL резолвится через обратный индекс (см. soundcloud-resolve.js).
// Возвращает null, если id неизвестен (например, резолв ещё не прошёл).
function getStreamTrackIdForTab(tabId, url) {
  const directId = getSoundCloudTrackIdFromUrl(url);
  if (directId) return directId;

  return getSoundCloudTrackIdByPlaylistUrl(tabId, url);
}

// True, если поток принадлежит другому треку, чем ожидает capture.
// Если expectedTrackId не задан (не SoundCloud или id не извлечён) — пропускаем.
// Если id потока ещё неизвестен (резолв не дошёл) — НЕ отсекаем, чтобы не
// потерять валидный playback-URL; его перепривяжут позже при резолве.
function isStreamForDifferentTrack(tabId, url, expectedTrackId) {
  if (!expectedTrackId) return false;

  const streamTrackId = getStreamTrackIdForTab(tabId, url);
  if (!streamTrackId) return false;

  return streamTrackId !== expectedTrackId;
}

export function rememberStreamForActiveCapture(tabId, url, streamInfo, meta = {}) {
  if (tabId < 0 || !url || !streamInfo || !streamInfo.type) return;

  const activeCapture = activeCapturesByTabId[tabId];
  if (!activeCapture) return;

  const now = Date.now();

  if (now > activeCapture.expiresAt) {
    rememberDiagnostic(
      tabId,
      "capture-timeout-no-stream",
      "Время ожидания capture истекло: подходящий поток не был найден.",
      {
        captureId: activeCapture.captureId,
        trackTitle: activeCapture.trackTitle || "media",
        startedAt: activeCapture.startedAt,
        expiresAt: activeCapture.expiresAt,
        lastObservedUrl: url,
        lastObservedType: streamInfo.type
      }
    );

    delete activeCapturesByTabId[tabId];
    return;
  }

  // SoundCloud: отбрасываем prefetch соседних треков. Если у capture есть
  // ожидаемый track id, а у потока — другой, игнорируем его целиком.
  // Дедупликация диагностики идёт по сигнатуре (URL включён в неё),
  // поэтому на поток одного URL сработает один раз.
  if (isStreamForDifferentTrack(tabId, url, activeCapture.expectedTrackId)) {
    rememberDiagnostic(
      tabId,
      "capture-rejected-different-track",
      "Во время capture замечен поток другого трека (prefetch). Он проигнорирован.",
      {
        captureId: activeCapture.captureId,
        trackTitle: activeCapture.trackTitle || "media",
        expectedTrackId: activeCapture.expectedTrackId || null,
        url,
        contentType: streamInfo.contentType || meta.contentType || null,
        requestType: meta.requestType || null,
        statusCode: meta.statusCode || null
      }
    );

    return;
  }

  if (!capturedStreamsByTabId[tabId]) {
    capturedStreamsByTabId[tabId] = {};
  }

  rememberSoundCloudFragmentFallback(tabId, activeCapture, url);

  // SoundCloud playback-API endpoint: распаковать playlist URL в момент capture,
  // пока токен свежий. Кэш + in-flight дедуп гарантируют один resolve на URL на таб.
  if (isSoundCloudPlaybackHlsEndpoint(url)) {
    resolveSoundCloudPlaylistUrl(tabId, url, activeCapture);
  }

  const isManifestLike = isManifestLikeStream(streamInfo, url);
  const isFragmentLike = isFragmentLikeUrl(url);
  const captureScore = getCaptureCandidateScore(url, streamInfo, meta);

  const capturedStream = {
    url,
    type: streamInfo.type,
    extension: streamInfo.extension || null,
    contentType: streamInfo.contentType || meta.contentType || null,
    captureId: activeCapture.captureId,
    trackTitle: activeCapture.trackTitle || "media",
    foundAt: now,
    isManifestLike,
    isFragmentLike,
    captureScore,
    siteHint: getSoundCloudCaptureHint(url)
  };

  const existingCapturedStream = capturedStreamsByTabId[tabId][activeCapture.captureId] || null;

  if (!shouldReplaceCapturedStream(existingCapturedStream, capturedStream)) {
    resendCapturedStreamWithFallbackIfNeeded(tabId, activeCapture, existingCapturedStream);
    if (isFragmentLike && !existingCapturedStream?.isFragmentLike) {
      rememberDiagnostic(
        tabId,
        "captured-audio-fragment-not-full-file",
        "Во время capture найден audio/video fragment, но он проигнорирован в пользу более подходящего потока.",
        {
          captureId: activeCapture.captureId,
          trackTitle: activeCapture.trackTitle || "media",
          url,
          contentType: capturedStream.contentType,
          requestType: meta.requestType || null,
          statusCode: meta.statusCode || null
        }
      );
    }

    return;
  }

  if (existingCapturedStream?.isFragmentLike && isManifestLike) {
    rememberDiagnostic(
      tabId,
      "capture-preferred-hls-manifest",
      "Во время capture manifest был выбран вместо audio/video fragment.",
      {
        captureId: activeCapture.captureId,
        trackTitle: activeCapture.trackTitle || "media",
        url,
        contentType: capturedStream.contentType,
        requestType: meta.requestType || null,
        statusCode: meta.statusCode || null
      }
    );
  } else if (isFragmentLike && !existingCapturedStream) {
    rememberDiagnostic(
      tabId,
      "capture-found-fragment-without-manifest",
      "Во время capture найден только fragment-поток. Он может не быть полноценным скачиваемым файлом.",
      {
        captureId: activeCapture.captureId,
        trackTitle: activeCapture.trackTitle || "media",
        url,
        contentType: capturedStream.contentType,
        requestType: meta.requestType || null,
        statusCode: meta.statusCode || null
      }
    );

    if (capturedStream.siteHint === "fragment") {
      rememberDiagnostic(
        tabId,
        "soundcloud-fragment-detected-awaiting-manifest",
        "SoundCloud отдает fragment-сегменты. Для скачивания нужен связанный manifest или playback API URL.",
        {
          captureId: activeCapture.captureId,
          trackTitle: activeCapture.trackTitle || "media",
          url,
          contentType: capturedStream.contentType,
          requestType: meta.requestType || null,
          statusCode: meta.statusCode || null,
          host: "soundcloud"
        }
      );
    }
  }

  const streamForContent = attachSoundCloudFallbackToCapturedStream(tabId, capturedStream);

  capturedStreamsByTabId[tabId][activeCapture.captureId] = streamForContent;

  chrome.tabs.sendMessage(
    tabId,
    {
      type: "MEDIA_DOWNLOADER_CAPTURED_STREAM",
      captureId: activeCapture.captureId,
      stream: streamForContent
    },
    () => {
      if (chrome.runtime.lastError) {
        // Content script может быть недоступен на некоторых служебных страницах.
      }
    }
  );

  console.log("[Media Downloader] Stream bound to capture:", streamForContent);
}
