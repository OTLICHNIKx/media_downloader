const streamsByTabId = {};
const activeCapturesByTabId = {};
const capturedStreamsByTabId = {};

const MAX_STREAMS_PER_TAB = 30;

const AUDIO_STREAM_EXTENSIONS = [
  "mp3",
  "m4a",
  "aac",
  "ogg",
  "opus",
  "wav",
  "flac"
];

const STREAM_EXTENSIONS = [
  "m3u8",
  "mpd",
  ...AUDIO_STREAM_EXTENSIONS
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
    }

    return null;
  } catch {
    return null;
  }
}

function getStreamInfoFromUrl(url) {
  if (!url) return null;

  const lower = url.toLowerCase();

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

  const extension = getExtensionFromUrl(url);

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

  return null;
}

function getStreamTypeFromUrl(url) {
  if (!url) return null;

  const lower = url.toLowerCase();

  if (
    lower.includes(".m3u8") ||
    lower.includes("application/vnd.apple.mpegurl") ||
    lower.includes("application/x-mpegurl")
  ) {
    return "hls";
  }

  if (lower.includes(".mpd")) {
    return "dash";
  }

  return null;
}

function rememberStream(tabId, url, streamInfo) {
  if (tabId < 0 || !url || !streamInfo || !streamInfo.type) return;

  if (!streamsByTabId[tabId]) {
    streamsByTabId[tabId] = [];
  }

  const streams = streamsByTabId[tabId];

  const alreadyExists = streams.some((stream) => stream.url === url);
  if (alreadyExists) return;

  const stream = {
    url,
    type: streamInfo.type,
    extension: streamInfo.extension || null,
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

    rememberStream(details.tabId, details.url, streamInfo);
    rememberStreamForActiveCapture(details.tabId, details.url, streamInfo);
  },
  {
    urls: ["<all_urls>"]
  }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  delete streamsByTabId[tabId];
  delete activeCapturesByTabId[tabId];
  delete capturedStreamsByTabId[tabId];
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