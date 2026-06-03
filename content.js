// поиск прямых ссылок на .mp3, .mp4, .wav

function normalizeUrl(url) {
    try {
        return new URL(url, window.location.href).href;
    } catch {
        return null;
    }
}

function getExtensionFromUrl(url) {
    try {
        const parseUrl = new URL(url);
        const pathname = parseUrl.pathname.toLowerCase();

        if (pathname.endsWith('.mp3')) return "mp3";
        if (pathname.endsWith('.mp4')) return "mp4";
        if (pathname.endsWith('.wav')) return "wav";

        return null
    } catch {
        return null;
    }
}

function guessQuality(url) {
  const lower = url.toLowerCase();

  const resolutionMatch = lower.match(/(2160p|1440p|1080p|720p|480p|360p)/);
  if (resolutionMatch) {
    return resolutionMatch[1];
  }

  const bitrateMatch = lower.match(/(320kbps|256kbps|192kbps|128kbps|96kbps)/);
  if (bitrateMatch) {
    return bitrateMatch[1];
  }

  return "unknown";
}

function getFileName(url) {
    try {
        const parseUrl = new URL(url);
        const parts = parseUrl.pathname.split("/");
        const lastPart = parts[parts.length - 1];

        return decodeURIComponent(lastPart || "media-file");
    } catch {
        return "media-file";
    }
}

function collectMediaLinks() {
  const found = new Map();

  const addUrl = (rawUrl) => {
    if (!rawUrl) return;

    const url = normalizeUrl(rawUrl);
    if (!url) return;

    const extension = getExtensionFromUrl(url);
    if (!extension) return;

    if (!found.has(url)) {
      found.set(url, {
        url,
        extension,
        quality: guessQuality(url),
        filename: getFileName(url)
      });
    }
  };

  document.querySelectorAll("a[href]").forEach((element) => {
    addUrl(element.getAttribute("href"));
  });

  document.querySelectorAll("audio[src], video[src], source[src]").forEach((element) => {
    addUrl(element.getAttribute("src"));
  });

  return Array.from(found.values());
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SCAN_MEDIA") {
    const media = collectMediaLinks();
    sendResponse({
      ok: true,
      media
    });
  }
});