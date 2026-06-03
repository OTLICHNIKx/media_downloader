const SUPPORTED_EXTENSIONS = ["mp3", "mp4", "wav"];

let hoverDownloadButton = null;
let currentHoverMedia = null;
let hideButtonTimer = null;

function normalizeUrl(url) {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return null;
  }
}

function getMediaTypeFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const href = parsedUrl.href.toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();

    if (pathname.endsWith(".mp3") || href.includes(".mp3?")) return "mp3";
    if (pathname.endsWith(".mp4") || href.includes(".mp4?")) return "mp4";
    if (pathname.endsWith(".wav") || href.includes(".wav?")) return "wav";
    if (pathname.endsWith(".m3u8") || href.includes(".m3u8?")) return "hls";

    return null;
  } catch {
    return null;
  }
}

function guessQuality(url) {
  const lower = url.toLowerCase();

  const resolutionMatch = lower.match(/(4320p|2160p|1440p|1080p|720p|480p|360p|240p)/);
  if (resolutionMatch) {
    return resolutionMatch[1];
  }

  const bitrateMatch = lower.match(/(320kbps|256kbps|192kbps|160kbps|128kbps|96kbps|64kbps)/);
  if (bitrateMatch) {
    return bitrateMatch[1];
  }

  return "unknown";
}

function sanitizeFilename(filename) {
  return filename
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function getFileName(url) {
  try {
    const parsedUrl = new URL(url);
    const parts = parsedUrl.pathname.split("/");
    const lastPart = parts[parts.length - 1];

    if (lastPart && lastPart.includes(".")) {
      return sanitizeFilename(decodeURIComponent(lastPart));
    }

    const extension = getExtensionFromUrl(url) || "media";
    return `media-file.${extension}`;
  } catch {
    return "media-file";
  }
}

function buildMediaItem(url, source = "page") {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return null;

  if (normalizedUrl.startsWith("blob:")) return null;
  if (normalizedUrl.startsWith("data:")) return null;

  const extension = getExtensionFromUrl(normalizedUrl);
  if (!extension) return null;

  return {
    url: normalizedUrl,
    extension,
    quality: guessQuality(normalizedUrl),
    filename: getFileName(normalizedUrl),
    source
  };
}

function getMediaFromElement(element) {
  if (!element) return null;

  const link = element.closest("a[href]");
  if (link) {
    const item = buildMediaItem(link.getAttribute("href"), "hover-link");
    if (item) {
      return {
        item,
        anchorElement: link
      };
    }
  }

  const mediaElement = element.closest("audio, video");
  if (mediaElement) {
    const item =
      buildMediaItem(mediaElement.currentSrc, "hover-media-current-src") ||
      buildMediaItem(mediaElement.getAttribute("src"), "hover-media-src");

    if (item) {
      return {
        item,
        anchorElement: mediaElement
      };
    }

    const sourceElement = mediaElement.querySelector("source[src]");
    if (sourceElement) {
      const sourceItem = buildMediaItem(sourceElement.getAttribute("src"), "hover-source");
      if (sourceItem) {
        return {
          item: sourceItem,
          anchorElement: mediaElement
        };
      }
    }
  }

  return null;
}

function createHoverDownloadButton() {
  const button = document.createElement("button");

  button.textContent = "Скачать";
  button.type = "button";

  button.style.position = "fixed";
  button.style.zIndex = "2147483647";
  button.style.display = "none";
  button.style.padding = "8px 12px";
  button.style.border = "none";
  button.style.borderRadius = "8px";
  button.style.background = "#1f9d55";
  button.style.color = "#ffffff";
  button.style.fontSize = "14px";
  button.style.fontFamily = "Arial, sans-serif";
  button.style.fontWeight = "600";
  button.style.cursor = "pointer";
  button.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.25)";

  button.addEventListener("mouseenter", () => {
    clearTimeout(hideButtonTimer);
  });

  button.addEventListener("mouseleave", () => {
    scheduleHideHoverButton();
  });

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!currentHoverMedia) return;

    chrome.runtime.sendMessage(
      {
        type: "DOWNLOAD_MEDIA",
        url: currentHoverMedia.url,
        filename: currentHoverMedia.filename
      },
      (response) => {
        if (!response || !response.ok) {
          console.warn("Download failed:", response?.error || "Unknown error");
          return;
        }

        button.textContent = "Скачивается...";
        setTimeout(() => {
          button.textContent = "Скачать";
        }, 1200);
      }
    );
  });

  document.documentElement.appendChild(button);

  return button;
}

function getHoverDownloadButton() {
  if (!hoverDownloadButton) {
    hoverDownloadButton = createHoverDownloadButton();
  }

  return hoverDownloadButton;
}

function showHoverButton(anchorElement, mediaItem) {
  clearTimeout(hideButtonTimer);

  currentHoverMedia = mediaItem;

  const button = getHoverDownloadButton();
  const rect = anchorElement.getBoundingClientRect();

  const top = Math.max(8, rect.top + 8);
  const left = Math.min(
    window.innerWidth - 120,
    Math.max(8, rect.right - 96)
  );

  button.style.top = `${top}px`;
  button.style.left = `${left}px`;
  button.style.display = "block";
  button.title = mediaItem.url;
}

function hideHoverButton() {
  const button = getHoverDownloadButton();
  button.style.display = "none";
  currentHoverMedia = null;
}

function scheduleHideHoverButton() {
  clearTimeout(hideButtonTimer);

  hideButtonTimer = setTimeout(() => {
    hideHoverButton();
  }, 250);
}

function collectMediaLinks() {
  const found = new Map();

  const addItem = (item) => {
    if (!item) return;

    if (!found.has(item.url)) {
      found.set(item.url, item);
    }
  };

  document.querySelectorAll("a[href]").forEach((element) => {
    addItem(buildMediaItem(element.getAttribute("href"), "link"));
  });

  document.querySelectorAll("audio, video").forEach((element) => {
    addItem(buildMediaItem(element.getAttribute("src"), "media-src"));
    addItem(buildMediaItem(element.currentSrc, "media-current-src"));

    const sourceElement = element.querySelector("source[src]");
    if (sourceElement) {
      addItem(buildMediaItem(sourceElement.getAttribute("src"), "source"));
    }
  });

  try {
    performance.getEntriesByType("resource").forEach((entry) => {
      addItem(buildMediaItem(entry.name, "network-resource"));
    });
  } catch {
    // performance API может быть недоступен на некоторых страницах
  }

  return Array.from(found.values());
}

document.addEventListener(
  "mouseover",
  (event) => {
    const mediaData = getMediaFromElement(event.target);

    if (!mediaData) {
      return;
    }

    showHoverButton(mediaData.anchorElement, mediaData.item);
  },
  true
);

document.addEventListener(
  "mouseout",
  (event) => {
    const relatedTarget = event.relatedTarget;

    if (hoverDownloadButton && relatedTarget === hoverDownloadButton) {
      return;
    }

    scheduleHideHoverButton();
  },
  true
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SCAN_MEDIA") {
    const media = collectMediaLinks();

    sendResponse({
      ok: true,
      media
    });
  }
});