import { activeCapturesByTabId, capturedStreamsByTabId } from "./state.js";
import { isSoundCloudPlaybackHlsEndpoint, getSoundCloudCaptureHint } from "./soundcloud-helpers.js";
import { isManifestLikeStream, isFragmentLikeUrl, getCaptureCandidateScore, shouldReplaceCapturedStream } from "./url-classify.js";
import { rememberDiagnostic } from "./diagnostics.js";
import {
  rememberSoundCloudFragmentFallback,
  attachSoundCloudFallbackToCapturedStream,
  resendCapturedStreamWithFallbackIfNeeded
} from "./soundcloud-fragment.js";
import { resolveSoundCloudPlaylistUrl } from "./soundcloud-resolve.js";

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
