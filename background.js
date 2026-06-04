const streamsByTabId = {};
const activeCapturesByTabId = {};
const capturedStreamsByTabId = {};

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

function rememberStream(tabId, url, type) {
  if (tabId < 0 || !url || !type) return;

  if (!streamsByTabId[tabId]) {
    streamsByTabId[tabId] = [];
  }

  const streams = streamsByTabId[tabId];

  const alreadyExists = streams.some((stream) => stream.url === url);
  if (alreadyExists) return;

  const stream = {
    url,
    type,
    foundAt: Date.now()
  };

  streams.unshift(stream);

  if (streams.length > 30) {
    streams.length = 30;
  }

  console.log("[Media Downloader] Stream found:", stream);
}

function rememberStreamForActiveCapture(tabId, url, type) {
  if (tabId < 0 || !url || !type) return;

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
    type,
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

    const streamType = getStreamTypeFromUrl(details.url);
    if (!streamType) return;

    rememberStream(details.tabId, details.url, streamType);
    rememberStreamForActiveCapture(details.tabId, details.url, streamType);
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