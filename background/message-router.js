import {
  activeCapturesByTabId,
  capturedStreamsByTabId,
  streamsByTabId,
  diagnosticsByTabId,
  scanSummariesByTabId,
  soundCloudFallbackPlaylistsById
} from "./state.js";
import { rememberDiagnostic } from "./diagnostics.js";
import {
  buildSoundCloudObservedPlaylist,
  getSoundCloudGroupSegmentCount
} from "./soundcloud-fragment.js";

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
  });
}
