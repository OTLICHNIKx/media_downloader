import { soundCloudResolvedByTabId, soundCloudResolveInFlightByTabId, capturedStreamsByTabId } from "./state.js";
import { mergePlusSeparatedValues } from "./url-classify.js";
import { extractHlsPlaylistUrlFromJsonText } from "../shared/hls-json.js";
import { rememberDiagnostic } from "./diagnostics.js";

// Распаковывает реальный playlist URL из SoundCloud playback-API endpoint
// в момент capture (токен самый свежий), кэширует и перевязывает карточку.
// webRequest не читает тела ответа в MV3, поэтому background пере-запрашивает
// endpoint сам — это тот же запрос, что делает downloader в iframe.
export async function resolveSoundCloudPlaylistUrl(tabId, apiUrl, activeCapture) {
  if (!apiUrl || !activeCapture) return;

  const cached = soundCloudResolvedByTabId[tabId]?.[apiUrl];
  if (cached && cached.playlistUrl) {
    resendCapturedStreamWithResolvedPlaylist(tabId, activeCapture, cached.playlistUrl);
    return;
  }

  if (!soundCloudResolveInFlightByTabId[tabId]) {
    soundCloudResolveInFlightByTabId[tabId] = {};
  }

  if (soundCloudResolveInFlightByTabId[tabId][apiUrl]) {
    return;
  }

  soundCloudResolveInFlightByTabId[tabId][apiUrl] = true;

  let playlistUrl = null;

  try {
    const response = await fetch(apiUrl, { credentials: "include" });

    if (response.ok) {
      const text = await response.text();
      playlistUrl = extractHlsPlaylistUrlFromJsonText(text, apiUrl);
    } else {
      rememberDiagnostic(
        tabId,
        "soundcloud-resolve-api-failed",
        `Не удалось распаковать SoundCloud playback-API: HTTP ${response.status}. Поток остаётся на API endpoint, downloader попробует unwrap сам.`,
        {
          captureId: activeCapture.captureId,
          trackTitle: activeCapture.trackTitle || "media",
          url: apiUrl,
          statusCode: response.status || null
        }
      );
    }
  } catch (error) {
    rememberDiagnostic(
      tabId,
      "soundcloud-resolve-api-error",
      `Ошибка запроса SoundCloud playback-API: ${error.message || error}. Поток остаётся на API endpoint.`,
      {
        captureId: activeCapture.captureId,
        trackTitle: activeCapture.trackTitle || "media",
        url: apiUrl
      }
    );
  } finally {
    if (soundCloudResolveInFlightByTabId[tabId]) {
      delete soundCloudResolveInFlightByTabId[tabId][apiUrl];
    }
  }

  if (!playlistUrl) {
    return;
  }

  if (!soundCloudResolvedByTabId[tabId]) {
    soundCloudResolvedByTabId[tabId] = {};
  }

  soundCloudResolvedByTabId[tabId][apiUrl] = {
    playlistUrl,
    resolvedAt: Date.now(),
    captureId: activeCapture.captureId,
    trackTitle: activeCapture.trackTitle || "media"
  };

  resendCapturedStreamWithResolvedPlaylist(tabId, activeCapture, playlistUrl);
}

function resendCapturedStreamWithResolvedPlaylist(tabId, activeCapture, playlistUrl) {
  if (!playlistUrl || !activeCapture) return;

  const existingCapturedStream =
    capturedStreamsByTabId[tabId] &&
    capturedStreamsByTabId[tabId][activeCapture.captureId]
      ? capturedStreamsByTabId[tabId][activeCapture.captureId]
      : null;

  if (!existingCapturedStream) {
    return;
  }

  const enrichedStream = {
    ...existingCapturedStream,
    url: playlistUrl,
    resolvedFrom: existingCapturedStream.url,
    detector: mergePlusSeparatedValues(
      existingCapturedStream.detector,
      "soundcloud-resolved"
    )
  };

  capturedStreamsByTabId[tabId][activeCapture.captureId] = enrichedStream;

  chrome.tabs.sendMessage(
    tabId,
    {
      type: "MEDIA_DOWNLOADER_CAPTURED_STREAM",
      captureId: activeCapture.captureId,
      stream: enrichedStream
    },
    () => {
      if (chrome.runtime.lastError) {
        // Content script может быть недоступен на служебных страницах.
      }
    }
  );

  console.log("[Media Downloader] SoundCloud playlist resolved:", {
    from: existingCapturedStream.url,
    to: playlistUrl
  });
}
