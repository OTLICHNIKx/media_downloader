import { activeCapturesByTabId } from "./state.js";
import {
  getStreamInfoFromUrl,
  getStreamInfoFromHeaders,
  getHeaderValue,
  getNumberHeaderValue
} from "./url-classify.js";
import { getSoundCloudCaptureHint } from "./soundcloud-helpers.js";
import { rememberDiagnostic, shouldIgnoreCaptureResponseDiagnostic } from "./diagnostics.js";
import { rememberStream } from "./stream-store.js";
import { rememberStreamForActiveCapture } from "./capture-store.js";

export function registerWebRequestListeners() {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!details || !details.url) return;

      const streamInfo = getStreamInfoFromUrl(details.url);
      if (!streamInfo) return;

      rememberStream(details.tabId, details.url, streamInfo, {
        source: "url",
        qualityLabel: streamInfo.qualityLabel || null,
        detector: "onBeforeRequest",
        requestType: details.type || null,
        method: details.method || null,
        initiator: details.initiator || null
      });

      rememberStreamForActiveCapture(details.tabId, details.url, streamInfo, {
        source: streamInfo.source || "url",
        qualityLabel: streamInfo.qualityLabel || null,
        requestType: details.type || null,
        method: details.method || null,
        initiator: details.initiator || null
      });
    },
    {
      urls: ["<all_urls>"]
    }
  );

  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      if (!details || !details.url) return;

      const fromHeaders = getStreamInfoFromHeaders(details.responseHeaders);
      const fromUrl = getStreamInfoFromUrl(details.url);
      const streamInfo = fromHeaders || fromUrl;

      if (!streamInfo) {
        const activeCapture = activeCapturesByTabId[details.tabId];

        if (activeCapture) {
          const contentType = getHeaderValue(details.responseHeaders, "content-type");
          const soundCloudHint = getSoundCloudCaptureHint(details.url);

          if (soundCloudHint === "manifest" || soundCloudHint === "api") {
            rememberDiagnostic(
              details.tabId,
              soundCloudHint === "manifest"
                ? "soundcloud-manifest-candidate-detected"
                : "soundcloud-api-playback-url-detected",
              soundCloudHint === "manifest"
                ? "Во время capture замечен SoundCloud manifest-кандидат. Нужна доработка site adapter для его извлечения."
                : "Во время capture замечен SoundCloud playback/API запрос. Он может содержать путь к manifest.",
              {
                url: details.url,
                contentType,
                requestType: details.type || null,
                statusCode: details.statusCode || null,
                trackTitle: activeCapture.trackTitle || "media"
              }
            );
          } else if (!shouldIgnoreCaptureResponseDiagnostic(details, contentType)) {
            rememberDiagnostic(
              details.tabId,
              "capture-response-not-media",
              "Во время capture был сетевой ответ, но Content-Type/URL не похожи на поддерживаемое медиа.",
              {
                url: details.url,
                contentType,
                requestType: details.type || null,
                statusCode: details.statusCode || null
              }
            );
          }
        }

        return;
      }

      rememberStream(details.tabId, details.url, streamInfo, {
        source: "headers",
        qualityLabel: streamInfo.qualityLabel || null,
        detector: "onHeadersReceived",
        requestType: details.type || null,
        method: details.method || null,
        statusCode: details.statusCode || null,
        initiator: details.initiator || null,
        contentType: getHeaderValue(details.responseHeaders, "content-type"),
        contentLength: getNumberHeaderValue(details.responseHeaders, "content-length"),
        acceptRanges: getHeaderValue(details.responseHeaders, "accept-ranges"),
        contentRange: getHeaderValue(details.responseHeaders, "content-range")
      });

      rememberStreamForActiveCapture(details.tabId, details.url, streamInfo, {
        source: streamInfo.source || "headers",
        qualityLabel: streamInfo.qualityLabel || null,
        requestType: details.type || null,
        method: details.method || null,
        statusCode: details.statusCode || null,
        initiator: details.initiator || null,
        contentType: getHeaderValue(details.responseHeaders, "content-type"),
        contentLength: getNumberHeaderValue(details.responseHeaders, "content-length"),
        acceptRanges: getHeaderValue(details.responseHeaders, "accept-ranges"),
        contentRange: getHeaderValue(details.responseHeaders, "content-range")
      });
    },
    {
      urls: ["<all_urls>"]
    },
    ["responseHeaders"]
  );
}
