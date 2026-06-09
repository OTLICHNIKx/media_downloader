const streamsByTabId = {};
const activeCapturesByTabId = {};
const capturedStreamsByTabId = {};
const diagnosticsByTabId = {};
const diagnosticSignaturesByTabId = {};
const MAX_STREAMS_PER_TAB = 50;
const MAX_DIAGNOSTICS_PER_TAB = 30;

const AUDIO_STREAM_EXTENSIONS = [
  "mp3",
  "m4a",
  "aac",
  "ogg",
  "opus",
  "wav",
  "flac"
];

const VIDEO_STREAM_EXTENSIONS = [
  "mp4",
  "webm",
  "m4v",
  "mov"
];

const MANIFEST_STREAM_EXTENSIONS = [
  "m3u8",
  "mpd"
];

const STREAM_EXTENSIONS = [
  ...MANIFEST_STREAM_EXTENSIONS,
  ...AUDIO_STREAM_EXTENSIONS,
  ...VIDEO_STREAM_EXTENSIONS
];

const MEDIA_MIME_RULES = [
  {
    includes: ["application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl", "audio/x-mpegurl"],
    type: "hls",
    extension: "m3u8"
  },
  {
    includes: ["application/dash+xml"],
    type: "dash",
    extension: "mpd"
  },
  {
    includes: ["audio/mpeg", "audio/mp3"],
    type: "audio",
    extension: "mp3"
  },
  {
    includes: ["audio/mp4", "audio/x-m4a"],
    type: "audio",
    extension: "m4a"
  },
  {
    includes: ["audio/aac"],
    type: "audio",
    extension: "aac"
  },
  {
    includes: ["audio/ogg", "application/ogg"],
    type: "audio",
    extension: "ogg"
  },
  {
    includes: ["audio/opus"],
    type: "audio",
    extension: "opus"
  },
  {
    includes: ["audio/wav", "audio/x-wav", "audio/wave"],
    type: "audio",
    extension: "wav"
  },
  {
    includes: ["audio/flac"],
    type: "audio",
    extension: "flac"
  },
  {
    includes: ["video/mp4"],
    type: "video",
    extension: "mp4"
  },
  {
    includes: ["video/webm"],
    type: "video",
    extension: "webm"
  }
];

function getExtensionFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const href = parsedUrl.href.toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();

    for (const extension of STREAM_EXTENSIONS) {
      if (pathname.endsWith(`.${extension}`)) return extension;
      if (href.includes(`.${extension}?`)) return extension;
      if (href.includes(`.${extension}&`)) return extension;
      if (href.includes(`.${extension}#`)) return extension;
      if (href.includes(`%2e${extension}`)) return extension;
    }

    return null;
  } catch {
    return null;
  }
}

function getStreamInfoFromExtension(extension) {
  if (!extension) return null;

  if (extension === "m3u8") {
    return {
      type: "hls",
      extension: "m3u8"
    };
  }

  if (extension === "mpd") {
    return {
      type: "dash",
      extension: "mpd"
    };
  }

  if (AUDIO_STREAM_EXTENSIONS.includes(extension)) {
    return {
      type: "audio",
      extension
    };
  }

  if (VIDEO_STREAM_EXTENSIONS.includes(extension)) {
    return {
      type: "video",
      extension
    };
  }

  return null;
}

function getStreamInfoFromContentType(contentType) {
  if (!contentType) return null;

  const cleanContentType = contentType.toLowerCase().split(";")[0].trim();

  for (const rule of MEDIA_MIME_RULES) {
    if (rule.includes.some((mime) => cleanContentType.includes(mime))) {
      return {
        type: rule.type,
        extension: rule.extension,
        contentType: cleanContentType
      };
    }
  }

  return null;
}

function getHeaderValue(responseHeaders, headerName) {
  if (!Array.isArray(responseHeaders)) return "";

  const header = responseHeaders.find((item) => {
    return item.name && item.name.toLowerCase() === headerName.toLowerCase();
  });

  return header ? header.value || "" : "";
}

function getFilenameFromContentDisposition(contentDisposition) {
  if (!contentDisposition) return "";

  const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch {
      return utfMatch[1];
    }
  }

  const normalMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return normalMatch ? normalMatch[1] : "";
}

function getStreamInfoFromHeaders(responseHeaders) {
  const contentType = getHeaderValue(responseHeaders, "content-type");
  const fromContentType = getStreamInfoFromContentType(contentType);

  if (fromContentType) {
    return fromContentType;
  }

  const contentDisposition = getHeaderValue(responseHeaders, "content-disposition");
  const filename = getFilenameFromContentDisposition(contentDisposition);
  const extension = getExtensionFromUrl(`https://local.test/${filename}`);

  return getStreamInfoFromExtension(extension);
}

function getStreamInfoFromQueryParams(parsedUrl) {
  const values = [];

  parsedUrl.searchParams.forEach((value, key) => {
    values.push(`${key}=${value}`);
  });

  const queryText = values.join("&").toLowerCase();

  if (!queryText) return null;

  if (
    queryText.includes("m3u8") ||
    queryText.includes("mpegurl") ||
    queryText.includes("hls")
  ) {
    return {
      type: "hls",
      extension: "m3u8"
    };
  }

  if (
    queryText.includes("mpd") ||
    queryText.includes("dash")
  ) {
    return {
      type: "dash",
      extension: "mpd"
    };
  }

  for (const extension of AUDIO_STREAM_EXTENSIONS) {
    if (
      queryText.includes(`format=${extension}`) ||
      queryText.includes(`ext=${extension}`) ||
      queryText.includes(`type=${extension}`) ||
      queryText.includes(`audio/${extension}`)
    ) {
      return {
        type: "audio",
        extension
      };
    }
  }

  for (const extension of VIDEO_STREAM_EXTENSIONS) {
    if (
      queryText.includes(`format=${extension}`) ||
      queryText.includes(`ext=${extension}`) ||
      queryText.includes(`type=${extension}`) ||
      queryText.includes(`video/${extension}`)
    ) {
      return {
        type: "video",
        extension
      };
    }
  }

  return null;
}

function getStreamInfoFromUrl(url) {
  if (!url) return null;

  try {
    const parsedUrl = new URL(url);
    const lower = parsedUrl.href.toLowerCase();

    if (
      lower.includes(".m3u8") ||
      lower.includes("application/vnd.apple.mpegurl") ||
      lower.includes("application/x-mpegurl")
    ) {
      return {
        type: "hls",
        extension: "m3u8"
      };
    }

    if (lower.includes(".mpd") || lower.includes("application/dash+xml")) {
      return {
        type: "dash",
        extension: "mpd"
      };
    }

    const extension = getExtensionFromUrl(url);
    const fromExtension = getStreamInfoFromExtension(extension);

    if (fromExtension) {
      return fromExtension;
    }

    return getStreamInfoFromQueryParams(parsedUrl);
  } catch {
    return null;
  }
}

function getDiagnosticSignature(code, message, data = {}) {
  const stableData = {
    host: data.host || null,
    adapter: data.adapter || null,
    visibleLinks: data.visibleLinks ?? null,
    inlineLinkMediaFound: data.inlineLinkMediaFound ?? null,
    visibleMediaElements: data.visibleMediaElements ?? null,
    inlineMediaFound: data.inlineMediaFound ?? null,
    latestHlsChecks: data.latestHlsChecks ?? null,
    adapterCandidates: data.adapterCandidates ?? null,
    buttonsOnPage: data.buttonsOnPage ?? null,
    url: data.url || null,
    contentType: data.contentType || null,
    requestType: data.requestType || null,
    statusCode: data.statusCode || null
  };

  return JSON.stringify({
    code,
    message,
    data: stableData
  });
}

function rememberDiagnostic(tabId, code, message, data = {}) {
  if (typeof tabId !== "number" || tabId < 0) return;

  if (!diagnosticsByTabId[tabId]) {
    diagnosticsByTabId[tabId] = [];
  }

  if (!diagnosticSignaturesByTabId[tabId]) {
    diagnosticSignaturesByTabId[tabId] = new Set();
  }

  const signature = getDiagnosticSignature(code, message, data);

  if (diagnosticSignaturesByTabId[tabId].has(signature)) {
    return;
  }

  diagnosticSignaturesByTabId[tabId].add(signature);

  const diagnostics = diagnosticsByTabId[tabId];

  const diagnostic = {
    code,
    message,
    data,
    createdAt: Date.now()
  };

  diagnostics.unshift(diagnostic);

  if (diagnostics.length > MAX_DIAGNOSTICS_PER_TAB) {
    diagnostics.length = MAX_DIAGNOSTICS_PER_TAB;
  }

  console.log("[Media Downloader] Diagnostic:", diagnostic);
}

function rememberStream(tabId, url, streamInfo, meta = {}) {
  if (tabId < 0 || !url || !streamInfo || !streamInfo.type) return;

  if (!streamsByTabId[tabId]) {
    streamsByTabId[tabId] = [];
  }

  const streams = streamsByTabId[tabId];

  const existingStream = streams.find((stream) => stream.url === url);

  if (existingStream) {
    Object.assign(existingStream, {
      type: streamInfo.type || existingStream.type,
      extension: streamInfo.extension || existingStream.extension || null,
      contentType: streamInfo.contentType || meta.contentType || existingStream.contentType || null,
      source: existingStream.source === meta.source ? existingStream.source : `${existingStream.source || "unknown"}+${meta.source || "unknown"}`,
      detector: meta.detector || existingStream.detector || null,
      requestType: meta.requestType || existingStream.requestType || null,
      method: meta.method || existingStream.method || null,
      statusCode: meta.statusCode || existingStream.statusCode || null,
      initiator: meta.initiator || existingStream.initiator || null,
      updatedAt: Date.now()
    });

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
    foundAt: Date.now()
  };

  streams.unshift(stream);

  if (streams.length > MAX_STREAMS_PER_TAB) {
    streams.length = MAX_STREAMS_PER_TAB;
  }

  console.log("[Media Downloader] Stream found:", stream);
}

function rememberStreamForActiveCapture(tabId, url, streamInfo) {
  if (tabId < 0 || !url || !streamInfo || !streamInfo.type) return;

  const activeCapture = activeCapturesByTabId[tabId];
  if (!activeCapture) return;

  const now = Date.now();

  if (now > activeCapture.expiresAt) {
    delete activeCapturesByTabId[tabId];
    return;
  }

  if (!capturedStreamsByTabId[tabId]) {
    capturedStreamsByTabId[tabId] = {};
  }

  const capturedStream = {
    url,
    type: streamInfo.type,
    extension: streamInfo.extension || null,
    captureId: activeCapture.captureId,
    trackTitle: activeCapture.trackTitle || "media",
    foundAt: now
  };

  capturedStreamsByTabId[tabId][activeCapture.captureId] = capturedStream;

  chrome.tabs.sendMessage(
    tabId,
    {
      type: "MEDIA_DOWNLOADER_CAPTURED_STREAM",
      captureId: activeCapture.captureId,
      stream: capturedStream
    },
    () => {
      if (chrome.runtime.lastError) {
        // Content script может быть недоступен на некоторых служебных страницах.
      }
    }
  );

  console.log("[Media Downloader] Stream bound to capture:", capturedStream);
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!details || !details.url) return;

    const streamInfo = getStreamInfoFromUrl(details.url);
    if (!streamInfo) return;

    rememberStream(details.tabId, details.url, streamInfo, {
      source: "url",
      detector: "onBeforeRequest",
      requestType: details.type || null,
      method: details.method || null,
      initiator: details.initiator || null
    });

    rememberStreamForActiveCapture(details.tabId, details.url, streamInfo);
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

      return;
    }

    rememberStream(details.tabId, details.url, streamInfo, {
      source: "headers",
      detector: "onHeadersReceived",
      requestType: details.type || null,
      method: details.method || null,
      statusCode: details.statusCode || null,
      initiator: details.initiator || null,
      contentType: getHeaderValue(details.responseHeaders, "content-type")
    });

    rememberStreamForActiveCapture(details.tabId, details.url, streamInfo);
  },
  {
    urls: ["<all_urls>"]
  },
  ["responseHeaders"]
);

chrome.tabs.onRemoved.addListener((tabId) => {
  delete streamsByTabId[tabId];
  delete activeCapturesByTabId[tabId];
  delete capturedStreamsByTabId[tabId];
  delete diagnosticsByTabId[tabId];
  delete diagnosticSignaturesByTabId[tabId];
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;

  delete streamsByTabId[tabId];
  delete activeCapturesByTabId[tabId];
  delete capturedStreamsByTabId[tabId];
  delete diagnosticsByTabId[tabId];
  delete diagnosticSignaturesByTabId[tabId];
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      diagnostics: diagnosticsByTabId[tabId] || []
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