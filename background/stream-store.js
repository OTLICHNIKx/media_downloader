import { MAX_STREAMS_PER_TAB } from "./constants.js";
import { streamsByTabId } from "./state.js";
import { mergePlusSeparatedValues, getQualityLabelFromUrl } from "./url-classify.js";

export function rememberStream(tabId, url, streamInfo, meta = {}) {
  if (tabId < 0 || !url || !streamInfo || !streamInfo.type) return;

  if (!streamsByTabId[tabId]) {
    streamsByTabId[tabId] = [];
  }

  const streams = streamsByTabId[tabId];

  const qualityLabel =
    meta.qualityLabel ||
    streamInfo.qualityLabel ||
    getQualityLabelFromUrl(url);

  const existingStream = streams.find((stream) => stream.url === url);

  if (existingStream) {
    existingStream.type = streamInfo.type || existingStream.type;
    existingStream.extension = streamInfo.extension || existingStream.extension || null;
    existingStream.contentType = streamInfo.contentType || meta.contentType || existingStream.contentType || null;

    existingStream.source = mergePlusSeparatedValues(
      existingStream.source,
      meta.source || "unknown"
    );

    existingStream.detector = mergePlusSeparatedValues(
      existingStream.detector,
      meta.detector || ""
    );

    existingStream.requestType = meta.requestType || existingStream.requestType || null;
    existingStream.method = meta.method || existingStream.method || null;
    existingStream.statusCode = meta.statusCode || existingStream.statusCode || null;
    existingStream.initiator = meta.initiator || existingStream.initiator || null;

    existingStream.contentLength = meta.contentLength || existingStream.contentLength || null;
    existingStream.acceptRanges = meta.acceptRanges || existingStream.acceptRanges || null;
    existingStream.contentRange = meta.contentRange || existingStream.contentRange || null;
    existingStream.qualityLabel = qualityLabel || existingStream.qualityLabel || null;

    existingStream.updatedAt = Date.now();

    return;
  }

  const stream = {
    url,
    type: streamInfo.type,
    extension: streamInfo.extension || null,
    contentType: streamInfo.contentType || meta.contentType || null,
    source: meta.source || "unknown",
    detector: meta.detector || null,
    requestType: meta.requestType || null,
    method: meta.method || null,
    statusCode: meta.statusCode || null,
    initiator: meta.initiator || null,
    contentLength: meta.contentLength || null,
    acceptRanges: meta.acceptRanges || null,
    contentRange: meta.contentRange || null,
    qualityLabel: qualityLabel || null,
    foundAt: Date.now()
  };

  streams.unshift(stream);

  if (streams.length > MAX_STREAMS_PER_TAB) {
    streams.length = MAX_STREAMS_PER_TAB;
  }

  console.log("[Media Downloader] Stream found:", stream);
}
