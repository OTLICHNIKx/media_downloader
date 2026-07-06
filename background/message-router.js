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

function appendSoundCloudApiQueryParams(url, params) {
  const parsedUrl = new URL(url);
  const hostname = parsedUrl.hostname.toLowerCase();

  // ВАЖНО:
  // query-параметры добавляем только к SoundCloud API.
  // К playback.media-streaming.soundcloud.cloud / cf-media.sndcdn.com
  // ничего не добавляем, иначе signed URL может сломаться и дать HTTP 403.
  if (
    hostname !== "api-v2.soundcloud.com" &&
    hostname !== "api.soundcloud.com"
  ) {
    return parsedUrl.href;
  }

  return appendQueryParams(parsedUrl.href, params);
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

function encodeSoundCloudTrackRefForPath(trackRef) {
  return encodeURIComponent(String(trackRef)).replace(/%3A/gi, ":");
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

function isSnippedSoundCloudTranscoding(transcoding) {
  const markerText = [
    transcoding?.preset,
    transcoding?.quality,
    transcoding?.url,
    transcoding?.format?.mime_type,
    transcoding?.format?.protocol
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    transcoding?.snipped === true ||
    markerText.includes("preview") ||
    markerText.includes("snippet") ||
    markerText.includes("snipped")
  );
}

function scoreSoundCloudTranscoding(transcoding) {
  const mime = String(transcoding?.format?.mime_type || "").toLowerCase();
  const preset = String(transcoding?.preset || "").toLowerCase();

  let score = 0;

  if (!isSnippedSoundCloudTranscoding(transcoding)) score += 1000;
  if (mime.includes("audio/aac")) score += 300;
  if (preset.includes("aac_160k")) score += 200;
  if (mime.includes("audio/mpeg")) score += 120;
  if (preset.includes("mp3")) score += 80;

  return score;
}

function collectSoundCloudHlsTranscodings(value, result = [], depth = 0, seen = new Set()) {
  if (!value || typeof value !== "object" || depth > 8 || seen.has(value)) {
    return result;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) =>
      collectSoundCloudHlsTranscodings(item, result, depth + 1, seen)
    );

    return result;
  }

  const protocol = String(value?.format?.protocol || "").toLowerCase();

  if (value.url && protocol === "hls" && !isSnippedSoundCloudTranscoding(value)) {
    result.push(value);
  }

  Object.values(value).forEach((item) =>
    collectSoundCloudHlsTranscodings(item, result, depth + 1, seen)
  );

  return result;
}

function getSoundCloudHlsCandidateUrlsFromJson(data, baseUrl) {
  const transcodings = collectSoundCloudHlsTranscodings(data);

  return transcodings
    .sort((a, b) => scoreSoundCloudTranscoding(b) - scoreSoundCloudTranscoding(a))
    .map((transcoding) => {
      try {
        return new URL(transcoding.url, baseUrl).href;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

function getSoundCloudPolicyFromJson(data) {
  return String(data?.policy || "").toUpperCase();
}

function getSoundCloudAvailabilityErrorFromJson(data) {
  const policy = getSoundCloudPolicyFromJson(data);

  if (policy === "BLOCK") {
    return "Трек недоступен в текущем регионе";
  }

  if (policy === "SNIP") {
    return "Трек доступен только как 30-секундный preview";
  }

  if (data?.streamable === false) {
    return "Трек недоступен для стриминга";
  }

  return "";
}

function getDirectAudioExtensionFromTranscoding(transcoding) {
  const mime = String(transcoding?.format?.mime_type || "").toLowerCase();
  const preset = String(transcoding?.preset || "").toLowerCase();

  if (mime.includes("mpeg") || preset.includes("mp3")) {
    return ".mp3";
  }

  if (mime.includes("aac") || preset.includes("aac")) {
    return ".m4a";
  }

  return ".audio";
}

function getSoundCloudTranscodingKind(transcoding) {
  const protocol = String(transcoding?.format?.protocol || "").toLowerCase();

  if (protocol === "hls") return "hls";
  if (protocol === "progressive") return "progressive";

  return "";
}

function collectSoundCloudStreamCandidates(value, result = [], depth = 0, seen = new Set()) {
  if (!value || typeof value !== "object" || depth > 8 || seen.has(value)) {
    return result;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item) =>
      collectSoundCloudStreamCandidates(item, result, depth + 1, seen)
    );

    return result;
  }

  const kind = getSoundCloudTranscodingKind(value);

  if (value.url && kind && !isSnippedSoundCloudTranscoding(value)) {
    result.push({
      url: String(value.url),
      kind,
      mimeType: String(value?.format?.mime_type || ""),
      extension: getDirectAudioExtensionFromTranscoding(value),
      preset: String(value?.preset || "")
    });
  }

  Object.values(value).forEach((item) =>
    collectSoundCloudStreamCandidates(item, result, depth + 1, seen)
  );

  return result;
}

function scoreSoundCloudStreamCandidate(candidate) {
  const mime = String(candidate?.mimeType || "").toLowerCase();
  const preset = String(candidate?.preset || "").toLowerCase();

  let score = 0;

  if (candidate.kind === "hls") score += 1000;
  if (candidate.kind === "progressive") score += 500;
  if (mime.includes("audio/aac")) score += 200;
  if (preset.includes("aac_160k")) score += 150;
  if (mime.includes("audio/mpeg")) score += 120;
  if (preset.includes("mp3")) score += 80;

  return score;
}

function getSoundCloudStreamCandidatesFromJson(data, baseUrl) {
  return collectSoundCloudStreamCandidates(data)
    .sort((a, b) => scoreSoundCloudStreamCandidate(b) - scoreSoundCloudStreamCandidate(a))
    .map((candidate) => {
      try {
        return {
          ...candidate,
          url: new URL(candidate.url, baseUrl).href
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function looksLikeHlsPlaylistUrl(url) {
  return /\.m3u8(?:$|\?)/i.test(String(url)) ||
    String(url).includes("playlist.m3u8");
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

function buildSoundCloudResolveUrls({ trackId, trackUrn, permalinkUrl, clientId }) {
  const urls = [];
  const seenUrls = new Set();
  const params = {
    client_id: clientId
  };

  const numericTrackId = getNumericSoundCloudTrackId(trackId, trackUrn);

  // 1. Самый свежий вариант: resolve по permalink.
  if (permalinkUrl) {
    pushUniqueUrl(
      urls,
      seenUrls,
      appendSoundCloudApiQueryParams(
        `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(permalinkUrl)}`,
        params
      )
    );
  }

  // 2. Потом свежий track object по id.
  if (numericTrackId) {
    pushUniqueUrl(
      urls,
      seenUrls,
      appendSoundCloudApiQueryParams(
        `https://api-v2.soundcloud.com/tracks/${numericTrackId}`,
        params
      )
    );
  }

  // 3. URN-вариант.
  if (trackUrn) {
    pushUniqueUrl(
      urls,
      seenUrls,
      appendSoundCloudApiQueryParams(
        `https://api-v2.soundcloud.com/tracks/${encodeSoundCloudTrackRefForPath(trackUrn)}`,
        params
      )
    );
  }

  return urls;
}


async function resolveSoundCloudHlsPlaylist(initialUrl) {
  const queue = [
    {
      url: initialUrl,
      kind: "api",
      extension: "",
      mimeType: ""
    }
  ];

  const seenUrls = new Set();
  const errors = [];
  let resolvedDurationMs = 0;

  let inheritedParams = {
    client_id: getSoundCloudQueryParamsFromUrl(initialUrl).client_id,
    track_authorization: ""
  };

  while (queue.length > 0 && seenUrls.size < 40) {
    const current = queue.shift();
    let currentUrl = current?.url || "";

    if (!currentUrl || seenUrls.has(currentUrl)) {
      continue;
    }

    seenUrls.add(currentUrl);

    const response = await fetch(currentUrl, {
    credentials: "include",
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
      Pragma: "no-cache"
    }
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
      const message = `SoundCloud API HTTP ${response.status} @ ${safeUrl}${details}`;

      errors.push(message);
      console.warn("[Media Downloader] SoundCloud stream candidate failed:", message);

      continue;
    }

    const text = await response.text();
    const trimmed = text.trimStart();

    if (trimmed.startsWith("#EXTM3U")) {
      return {
        kind: "hls",
        playlistUrl: currentUrl,
        playlistText: text,
        durationMs: resolvedDurationMs
      };
    }

    let parsedJson = null;

    try {
      parsedJson = JSON.parse(text);
    } catch {
      parsedJson = null;
    }

    if (!parsedJson) {
      continue;
    }

    const availabilityError = getSoundCloudAvailabilityErrorFromJson(parsedJson);

    if (availabilityError) {
      errors.push(availabilityError);
      console.warn("[Media Downloader] SoundCloud availability:", availabilityError);
      continue;
    }

    const trackAuthorizationFromJson =
      getSoundCloudTrackAuthorizationFromJson(parsedJson);

    if (trackAuthorizationFromJson) {
      inheritedParams = {
        ...inheritedParams,
        track_authorization: trackAuthorizationFromJson
      };
    }

    if (parsedJson) {
    console.log("[Media Downloader] SoundCloud track/access debug", {
      url: currentUrl,
      kind: parsedJson.kind,
      title: parsedJson.title,
      access: parsedJson.access,
      policy: parsedJson.policy,
      streamable: parsedJson.streamable,
      monetization_model: parsedJson.monetization_model,
      hasMedia: Boolean(parsedJson.media),
      transcodings: Array.isArray(parsedJson.media?.transcodings)
        ? parsedJson.media.transcodings.map((item) => ({
            preset: item.preset,
            protocol: item.format?.protocol,
            mime: item.format?.mime_type,
            snipped: item.snipped,
            url: item.url
          }))
        : []
    });
    const durationFromJson = getSoundCloudDurationMsFromJson(parsedJson);
    if (durationFromJson && !resolvedDurationMs) {
      resolvedDurationMs = durationFromJson;
    }
  }

    // Ответ stream endpoint'а обычно выглядит как { url: "https://..." }.
    // Для HLS это будет playlist.m3u8, для progressive — прямой audio URL.
    if (typeof parsedJson.url === "string" && parsedJson.url) {
      const resolvedUrl = new URL(parsedJson.url, currentUrl).href;

      if (looksLikeHlsPlaylistUrl(resolvedUrl)) {
        const preparedUrl = appendSoundCloudApiQueryParams(
          resolvedUrl,
          inheritedParams
        );

        if (!seenUrls.has(preparedUrl)) {
          queue.push({
            url: preparedUrl,
            kind: "hls",
            extension: current.extension,
            mimeType: current.mimeType
          });
        }
      } else {
        return {
          kind: "direct",
          directUrl: resolvedUrl,
          directExtension: current.extension || ".mp3",
          directMimeType: current.mimeType || "audio/mpeg",
          durationMs: resolvedDurationMs
        };
      }
    }

    // Если это track JSON, вытаскиваем все transcodings:
    // сначала HLS, потом progressive.
    const streamCandidates = getSoundCloudStreamCandidatesFromJson(
      parsedJson,
      currentUrl
    );

    for (const candidate of streamCandidates) {
      const preparedUrl = appendSoundCloudApiQueryParams(
        candidate.url,
        inheritedParams
      );

      if (!seenUrls.has(preparedUrl)) {
        queue.push({
          url: preparedUrl,
          kind: candidate.kind,
          extension: candidate.extension,
          mimeType: candidate.mimeType
        });
      }
    }

    const nextUrl = extractHlsPlaylistUrlFromJsonText(text, currentUrl);

    if (nextUrl && nextUrl !== currentUrl) {
      const preparedNextUrl = appendSoundCloudApiQueryParams(
        nextUrl,
        inheritedParams
      );

      if (!seenUrls.has(preparedNextUrl)) {
        queue.push({
          url: preparedNextUrl,
          kind: "hls",
          extension: current.extension,
          mimeType: current.mimeType
        });
      }
    }
  }

  const uniqueErrors = [...new Set(errors)].slice(-6);

  throw new Error(
    uniqueErrors.join(" | ") ||
      "SoundCloud API не вернул рабочий HLS/progressive stream"
  );
}

function getSoundCloudDurationMsFromJson(data) {
  return Number(
    data?.duration ||
      data?.full_duration ||
      data?.fullDuration ||
      data?.track?.duration ||
      data?.track?.full_duration ||
      0
  ) || 0;
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
      const permalinkUrl = message.permalinkUrl;
      const trackId = message.trackId;
      const trackUrn = message.trackUrn;
      const clientId = message.clientId;

      if (!trackId && !trackUrn && !permalinkUrl) {
        sendResponse({
          ok: false,
          error: "trackId/trackUrn/permalinkUrl not provided"
        });
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
          trackId,
          trackUrn,
          permalinkUrl,
          clientId
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
              kind: resource.kind || "hls",
              playlistUrl: resource.playlistUrl || "",
              playlistText: resource.playlistText || "",
              directUrl: resource.directUrl || "",
              directExtension: resource.directExtension || "",
              directMimeType: resource.directMimeType || "",
              durationMs: resource.durationMs || 0
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
