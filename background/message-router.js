import {
  activeCapturesByTabId,
  capturedStreamsByTabId,
  streamsByTabId,
  diagnosticsByTabId,
  scanSummariesByTabId,
  soundCloudFragmentGroupsByTabId,
  soundCloudResolvedByTabId,
  soundCloudResolveInFlightByTabId,
  soundCloudTrackIdByPlaylistUrlByTabId,
  soundCloudFallbackPlaylistsById,
  pendingPlaylistBatches
} from "./state.js";
import { rememberDiagnostic } from "./diagnostics.js";
import {
  buildSoundCloudObservedPlaylist,
  getSoundCloudGroupSegmentCount
} from "./soundcloud-fragment.js";
import { extractHlsPlaylistUrlFromJsonText } from "../shared/hls-json.js";

function appendQueryParams(url, params) {
  const parsedUrl = new URL(url);

  Object.entries(params).forEach(([key, value]) => {
    if (!value || parsedUrl.searchParams.has(key)) return;
    parsedUrl.searchParams.set(key, value);
  });

  return parsedUrl.href;
}

function getNumericSoundCloudTrackId(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;

    const text = String(value);

    if (/^\d+$/.test(text)) {
      return text;
    }

    const urnMatch = text.match(/soundcloud:tracks:(\d+)/i);
    if (urnMatch && urnMatch[1]) {
      return urnMatch[1];
    }
  }

  return null;
}

function findStringValueByKeyDeep(value, keyMatchers, depth = 0, seen = new Set()) {
  if (!value || typeof value !== "object" || depth > 6 || seen.has(value)) {
    return "";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringValueByKeyDeep(item, keyMatchers, depth + 1, seen);
      if (found) return found;
    }

    return "";
  }

  for (const [key, item] of Object.entries(value)) {
    if (
      keyMatchers.some((matcher) => matcher.test(key)) &&
      (typeof item === "string" || typeof item === "number") &&
      String(item)
    ) {
      return String(item);
    }

    const nested = findStringValueByKeyDeep(item, keyMatchers, depth + 1, seen);
    if (nested) return nested;
  }

  return "";
}

function getSoundCloudTrackAuthorizationFromJson(data) {
  return findStringValueByKeyDeep(data, [/^track_authorization$/i, /^trackAuthorization$/i]);
}

function getSoundCloudQueryParamsFromUrl(url) {
  const parsedUrl = new URL(url);

  return {
    client_id: parsedUrl.searchParams.get("client_id") || "",
    track_authorization: parsedUrl.searchParams.get("track_authorization") || ""
  };
}

function pushUniqueUrl(urls, seenUrls, url) {
  if (!url || seenUrls.has(url)) return;
  seenUrls.add(url);
  urls.push(url);
}

function buildSoundCloudResolveUrls({ apiUrl, trackId, trackUrn, clientId, trackAuthorization }) {
  const urls = [];
  const seenUrls = new Set();
  const params = {
    client_id: clientId,
    track_authorization: trackAuthorization
  };

  if (apiUrl) {
    pushUniqueUrl(urls, seenUrls, appendQueryParams(apiUrl, params));
  }

  const numericTrackId = getNumericSoundCloudTrackId(trackId, trackUrn);

  if (numericTrackId) {
    pushUniqueUrl(
      urls,
      seenUrls,
      appendQueryParams(
        `https://api-v2.soundcloud.com/tracks/${numericTrackId}`,
        params
      )
    );

    pushUniqueUrl(
      urls,
      seenUrls,
      appendQueryParams(
        `https://api-v2.soundcloud.com/tracks/${numericTrackId}/streams`,
        params
      )
    );
  }

  return urls;
}

async function resolveSoundCloudHlsPlaylist(initialUrl) {
  let currentUrl = initialUrl;
  let inheritedParams = getSoundCloudQueryParamsFromUrl(initialUrl);

  for (let step = 0; step < 5; step++) {
    const response = await fetch(currentUrl, {
      credentials: "include"
    });

    if (!response.ok) {
      let errorBody = "";

      try {
        errorBody = (await response.text()).slice(0, 180);
      } catch {
        // ignore
      }

      const parsedUrl = new URL(currentUrl);
      const safeUrl = parsedUrl.origin + parsedUrl.pathname;
      const details = errorBody ? `: ${errorBody}` : "";

      throw new Error(`SoundCloud API HTTP ${response.status} @ ${safeUrl}${details}`);
    }

    const text = await response.text();
    const trimmed = text.trimStart();

    if (trimmed.startsWith("#EXTM3U")) {
      return {
        playlistUrl: currentUrl,
        playlistText: text
      };
    }

    let parsedJson = null;

    try {
      parsedJson = JSON.parse(text);
    } catch {
      parsedJson = null;
    }

    const trackAuthorizationFromJson = parsedJson
      ? getSoundCloudTrackAuthorizationFromJson(parsedJson)
      : "";

    if (trackAuthorizationFromJson && !inheritedParams.track_authorization) {
      inheritedParams = {
        ...inheritedParams,
        track_authorization: trackAuthorizationFromJson
      };
    }

    const nextUrl = extractHlsPlaylistUrlFromJsonText(text, currentUrl);

    if (!nextUrl || nextUrl === currentUrl) {
      throw new Error("HLS playlist URL не найден в ответе API");
    }

    currentUrl = appendQueryParams(nextUrl, inheritedParams);
    inheritedParams = getSoundCloudQueryParamsFromUrl(currentUrl);
  }

  throw new Error("SoundCloud API не вернул HLS playlist после нескольких unwrap-запросов");
}

async function resolveSoundCloudHlsPlaylist(initialUrl) {
  let currentUrl = initialUrl;

  for (let step = 0; step < 5; step++) {
    const response = await fetch(currentUrl, {
      credentials: "include"
    });

    if (!response.ok) {
      let errorBody = "";

      try {
        errorBody = (await response.text()).slice(0, 180);
      } catch {
        // ignore
      }

      const parsedUrl = new URL(currentUrl);
      const safeUrl = parsedUrl.origin + parsedUrl.pathname;
      const details = errorBody ? `: ${errorBody}` : "";

      throw new Error(`SoundCloud API HTTP ${response.status} @ ${safeUrl}${details}`);
    }

    const text = await response.text();
    const trimmed = text.trimStart();

    if (trimmed.startsWith("#EXTM3U")) {
      return {
        playlistUrl: currentUrl,
        playlistText: text
      };
    }

    const nextUrl = extractHlsPlaylistUrlFromJsonText(text, currentUrl);

    if (!nextUrl || nextUrl === currentUrl) {
      throw new Error("HLS playlist URL не найден в ответе API");
    }

    currentUrl = nextUrl;
  }

  throw new Error("SoundCloud API не вернул HLS playlist после нескольких unwrap-запросов");
}

export function registerMessageRouter() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    if (message.type === "GET_SOUNDCLOUD_FALLBACK_PLAYLIST") {
      const fallbackId = message.fallbackPlaylistId;
      const group = soundCloudFallbackPlaylistsById[fallbackId];

      if (!group) {
        sendResponse({
          ok: false,
          error: "SoundCloud fallback playlist not found"
        });

        return;
      }

      const playlistText = buildSoundCloudObservedPlaylist(group);

      if (!playlistText) {
        sendResponse({
          ok: false,
          error: "SoundCloud fallback playlist is not ready yet"
        });

        return;
      }

      sendResponse({
        ok: true,
        playlistUrl: `https://soundcloud.local/fallback/${encodeURIComponent(group.id)}.m3u8`,
        playlistText,
        source: "soundcloud-observed-fragments",
        trackTitle: group.trackTitle || "media",
        qualityLabel: group.qualityLabel || null,
        segmentCount: getSoundCloudGroupSegmentCount(group),
        hasInit: Boolean(group.initUrl),
        warning: "Fallback собран только из уже замеченных SoundCloud fragments. Для полного трека нужно, чтобы были пойманы все сегменты или чтобы API playlist открылся напрямую."
      });

      return;
    }

    if (message.type === "DOWNLOAD_MEDIA") {
      chrome.downloads.download(
        {
          url: message.url,
          filename: message.filename || undefined,
          saveAs: true
        },
        (downloadId) => {
          if (chrome.runtime.lastError) {
            sendResponse({
              ok: false,
              error: chrome.runtime.lastError.message
            });
            return;
          }

          sendResponse({
            ok: true,
            downloadId
          });
        }
      );

      return true;
    }

    if (message.type === "START_STREAM_CAPTURE") {
      const tabId = sender.tab?.id ?? message.tabId;

      if (typeof tabId !== "number") {
        sendResponse({
          ok: false,
          error: "Cannot determine tabId"
        });
        return;
      }

      const timeoutMs = Number(message.timeoutMs || 7000);

      activeCapturesByTabId[tabId] = {
        captureId: message.captureId,
        trackTitle: message.trackTitle || "media",
        // SoundCloud: ожидаемый track id, чтобы отбрасывать prefetch соседних треков.
        expectedTrackId: message.expectedTrackId || null,
        startedAt: Date.now(),
        expiresAt: Date.now() + timeoutMs
      };

      setTimeout(() => {
        const activeCapture = activeCapturesByTabId[tabId];

        if (!activeCapture || activeCapture.captureId !== message.captureId) {
          return;
        }

        rememberDiagnostic(
          tabId,
          "capture-timeout-no-stream",
          "Capture завершился без найденного поддерживаемого потока.",
          {
            captureId: activeCapture.captureId,
            trackTitle: activeCapture.trackTitle || "media",
            startedAt: activeCapture.startedAt,
            expiresAt: activeCapture.expiresAt,
            timeoutMs
          }
        );

        delete activeCapturesByTabId[tabId];
      }, timeoutMs + 250);

      sendResponse({
        ok: true,
        capture: activeCapturesByTabId[tabId]
      });

      return;
    }

    if (message.type === "GET_CAPTURED_STREAM") {
      const tabId = sender.tab?.id ?? message.tabId;
      const captureId = message.captureId;

      const stream =
        capturedStreamsByTabId[tabId] &&
        capturedStreamsByTabId[tabId][captureId]
          ? capturedStreamsByTabId[tabId][captureId]
          : null;

      sendResponse({
        ok: true,
        stream
      });

      return;
    }

    if (message.type === "GET_MEDIA_DOWNLOADER_STATE") {
      const tabId = message.tabId;

      sendResponse({
        ok: true,
        streams: streamsByTabId[tabId] || [],
        diagnostics: diagnosticsByTabId[tabId] || [],
        scanSummary: scanSummariesByTabId[tabId] || null
      });

      return;
    }

    if (message.type === "CLEAR_MEDIA_DOWNLOADER_STATE") {
      const tabId = message.tabId;

      streamsByTabId[tabId] = [];
      diagnosticsByTabId[tabId] = [];

      sendResponse({
        ok: true
      });

      return;
    }

    // Content-script перезагружен (F5, навигация, re-inject).
    // Полная очистка per-tab state: старые capture, потоки, resolved URL
    // больше не актуальны — новые DOM-узлы и captureId.
    if (message.type === "CONTENT_SCRIPT_READY") {
      const tabId = sender.tab?.id ?? message.tabId;

      if (typeof tabId === "number" && tabId >= 0) {
        delete activeCapturesByTabId[tabId];
        delete capturedStreamsByTabId[tabId];
        delete soundCloudFragmentGroupsByTabId[tabId];
        delete soundCloudResolvedByTabId[tabId];
        delete soundCloudResolveInFlightByTabId[tabId];
        delete soundCloudTrackIdByPlaylistUrlByTabId[tabId];
        streamsByTabId[tabId] = [];
        diagnosticsByTabId[tabId] = [];
        delete scanSummariesByTabId[tabId];
      }

      sendResponse({
        ok: true
      });

      return;
    }

    if (message.type === "CLEAR_MEDIA_DOWNLOADER_DIAGNOSTICS") {
      const tabId = message.tabId;

      diagnosticsByTabId[tabId] = [];

      sendResponse({
        ok: true
      });

      return;
    }

    if (message.type === "REPORT_MEDIA_DOWNLOADER_SCAN_SUMMARY") {
      const tabId = sender.tab?.id ?? message.tabId;

      if (typeof tabId === "number" && tabId >= 0) {
        scanSummariesByTabId[tabId] = {
          message: message.message || "Текущий скан страницы",
          data: message.data || {},
          updatedAt: Date.now()
        };
      }

      sendResponse({
        ok: true
      });

      return;
    }

    if (message.type === "REPORT_MEDIA_DOWNLOADER_DIAGNOSTIC") {
      const tabId = sender.tab?.id ?? message.tabId;

      rememberDiagnostic(
        tabId,
        message.code || "content-diagnostic",
        message.message || "Content script diagnostic",
        message.data || {}
      );

      sendResponse({
        ok: true
      });

      return;
    }

    if (message.type === "GET_HLS_STREAMS") {
      const tabId = message.tabId;
      const streams = streamsByTabId[tabId] || [];

      sendResponse({
        ok: true,
        streams: streams.filter((stream) => stream.type === "hls")
      });

      return;
    }

    if (message.type === "GET_LATEST_HLS_STREAM") {
      const tabId = sender.tab?.id ?? message.tabId;
      const streams = streamsByTabId[tabId] || [];
      const latestStream = streams.find((stream) => stream.type === "hls") || null;

      sendResponse({
        ok: true,
        stream: latestStream
      });

      return;
    }

    if (message.type === "GET_LATEST_STREAM") {
      const tabId = sender.tab?.id ?? message.tabId;
      const streams = streamsByTabId[tabId] || [];
      const latestStream = streams[0] || null;

      sendResponse({
        ok: true,
        stream: latestStream
      });

      return;
    }

    if (message.type === "OPEN_PLAYLIST_DOWNLOADER") {
    const url = String(message.url || "");
    const allowedUrlPrefix = chrome.runtime.getURL(
      "playlist-downloader/playlist-downloader.html"
    );

    if (!url.startsWith(allowedUrlPrefix)) {
      sendResponse({
        ok: false,
        error: "Invalid playlist downloader URL"
      });

      return;
    }

    chrome.tabs.create({ url }, (tab) => {
      if (chrome.runtime.lastError) {
        sendResponse({
          ok: false,
          error: chrome.runtime.lastError.message
        });
        return;
      }

      sendResponse({
        ok: true,
        tabId: tab?.id || null
      });
    });

    return true;
  }

    // Content-script на /sets/ странице просит начать батч-скачивание плейлиста.
    // Сохраняем список треков и открываем playlist-downloader.html с batchId.
    if (message.type === "START_PLAYLIST_BATCH_DOWNLOAD") {
      const tracks = Array.isArray(message.tracks) ? message.tracks : [];
      const playlistTitle = message.playlistTitle || "playlist";
      const clientId = message.clientId || null;

      if (tracks.length === 0) {
        sendResponse({
          ok: false,
          error: "No tracks provided"
        });

        return;
      }

      const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      pendingPlaylistBatches[batchId] = {
        tracks,
        playlistTitle,
        clientId,
        createdAt: Date.now()
      };

      // TTL-очистка: если playlist-downloader.html не забрал батч за 5 минут
      // (вкладка не открылась/закрылась), удаляем чтобы не копить мусор.
      setTimeout(() => {
        delete pendingPlaylistBatches[batchId];
      }, 5 * 60 * 1000);

      const downloaderUrl = chrome.runtime.getURL(
        `playlist-downloader/playlist-downloader.html?batchId=${encodeURIComponent(batchId)}`
      );

      chrome.tabs.create({ url: downloaderUrl });

      sendResponse({
        ok: true,
        batchId
      });

      return;
    }

    // playlist-downloader.html забирает сохранённый батч по batchId.
    if (message.type === "GET_PLAYLIST_BATCH") {
      const batch = pendingPlaylistBatches[message.batchId];

      if (!batch) {
        sendResponse({
          ok: false,
          error: "Batch not found or expired"
        });

        return;
      }

      sendResponse({
        ok: true,
        tracks: batch.tracks,
        playlistTitle: batch.playlistTitle,
        clientId: batch.clientId
      });

      return;
    }

    // playlist-downloader.html просит разрешить HLS для одного трека.
    // Background делает fetch к SoundCloud API с cookies + client_id —
    // из extension page SoundCloud отбрасывает запросы (HTTP 401).
    // Возвращает текст .m3u8.
    if (message.type === "RESOLVE_TRACK_HLS") {
    const trackId = message.trackId;
    const trackUrn = message.trackUrn;
    const apiUrl = message.apiUrl;
    const trackAuthorization = message.trackAuthorization;
    const clientId = message.clientId;

    if (!trackId && !trackUrn && !apiUrl) {
      sendResponse({ ok: false, error: "trackId/trackUrn/apiUrl not provided" });
      return;
    }

    if (!clientId) {
      sendResponse({
        ok: false,
        error: "client_id не передан (SoundCloud API вернёт 401)"
      });
      return;
    }

    let resolveUrls;

    try {
      resolveUrls = buildSoundCloudResolveUrls({
        apiUrl,
        trackId,
        trackUrn,
        clientId,
        trackAuthorization
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: `Некорректный SoundCloud URL: ${error.message || error}`
      });
      return;
    }

    if (!resolveUrls || resolveUrls.length === 0) {
      sendResponse({ ok: false, error: "SoundCloud resolve URL not built" });
      return;
    }

    (async () => {
      const errors = [];

      for (const resolveUrl of resolveUrls) {
        try {
          const resource = await resolveSoundCloudHlsPlaylist(resolveUrl);

          sendResponse({
            ok: true,
            playlistUrl: resource.playlistUrl,
            playlistText: resource.playlistText
          });
          return;
        } catch (error) {
          const message = error?.message || String(error);
          errors.push(message);

          try {
            const parsedUrl = new URL(resolveUrl);
            console.warn(
              "[Media Downloader] SoundCloud resolve candidate failed:",
              parsedUrl.origin + parsedUrl.pathname,
              message
            );
          } catch {
            console.warn(
              "[Media Downloader] SoundCloud resolve candidate failed:",
              message
            );
          }
        }
      }

      const uniqueErrors = [...new Set(errors)].slice(-3);

      sendResponse({
        ok: false,
        error: uniqueErrors.join(" | ") || "RESOLVE_TRACK_HLS failed"
      });
    })();

    return true; // async sendResponse
  }
  });
}
