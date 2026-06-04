const hlsStreamsByTabId = {};

function isHlsUrl(url) {
  if (!url) return false;

  const lower = url.toLowerCase();

  return (
    lower.includes(".m3u8") ||
    lower.includes("application/vnd.apple.mpegurl") ||
    lower.includes("application/x-mpegurl")
  );
}

function rememberHlsStream(tabId, url) {
  if (tabId < 0 || !url) return;

  if (!hlsStreamsByTabId[tabId]) {
    hlsStreamsByTabId[tabId] = [];
  }

  const streams = hlsStreamsByTabId[tabId];

  const alreadyExists = streams.some((stream) => stream.url === url);
  if (alreadyExists) return;

  streams.unshift({
    url,
    foundAt: Date.now()
  });

  if (streams.length > 20) {
    streams.length = 20;
  }

  console.log("[Media Downloader] HLS found:", url);
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!details || !details.url) return;

    if (isHlsUrl(details.url)) {
      rememberHlsStream(details.tabId, details.url);
    }
  },
  {
    urls: ["<all_urls>"]
  }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  delete hlsStreamsByTabId[tabId];
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

  if (message.type === "GET_HLS_STREAMS") {
    const tabId = message.tabId;
    const streams = hlsStreamsByTabId[tabId] || [];

    sendResponse({
      ok: true,
      streams
    });

    return;
  }

  if (message.type === "GET_LATEST_HLS_STREAM") {
    const tabId = sender.tab?.id ?? message.tabId;
    const streams = hlsStreamsByTabId[tabId] || [];
    const latestStream = streams[0] || null;

    sendResponse({
      ok: true,
      stream: latestStream
    });
    return;
  }

});