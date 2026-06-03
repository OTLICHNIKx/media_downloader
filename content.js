const SUPPORTED_EXTENSIONS = ["mp3", "mp4", "wav"];

const ICON_ADDED_ATTRIBUTE = "data-media-downloader-icon-added";

function normalizeUrl(url) {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return null;
  }
}

function getExtensionFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const href = parsedUrl.href.toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();

    for (const extension of SUPPORTED_EXTENSIONS) {
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

function guessQuality(url) {
  const lower = url.toLowerCase();

  const resolutionMatch = lower.match(/(4320p|2160p|1440p|1080p|720p|480p|360p|240p)/);
  if (resolutionMatch) return resolutionMatch[1];

  const bitrateMatch = lower.match(/(320kbps|256kbps|192kbps|160kbps|128kbps|96kbps|64kbps)/);
  if (bitrateMatch) return bitrateMatch[1];

  return "unknown";
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

function downloadMedia(mediaItem, buttonElement) {
  if (!mediaItem) return;

  chrome.runtime.sendMessage(
    {
      type: "DOWNLOAD_MEDIA",
      url: mediaItem.url,
      filename: mediaItem.filename
    },
    (response) => {
      if (!response || !response.ok) {
        console.warn("[Media Downloader] Download failed:", response?.error || "Unknown error");

        buttonElement.textContent = "Ошибка";
        setTimeout(() => {
          buttonElement.innerHTML = `<span class="md-icon-symbol">⬇</span><span class="md-icon-text">Скачать</span>`;
        }, 1200);

        return;
      }

      buttonElement.textContent = "Скачивается...";

      setTimeout(() => {
        buttonElement.innerHTML = `<span class="md-icon-symbol">⬇</span><span class="md-icon-text">Скачать</span>`;
      }, 1200);
    }
  );
}

function createDownloadIcon(mediaItem) {
  const button = document.createElement("button");

  button.type = "button";
  button.className = "media-downloader-icon";
  button.title = `Скачать ${mediaItem.filename}`;
  button.innerHTML = `<span class="md-icon-symbol">⬇</span><span class="md-icon-text">Скачать</span>`;

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    downloadMedia(mediaItem, button);
  });

  return button;
}

function injectStyles() {
  if (document.getElementById("media-downloader-styles")) return;

  const style = document.createElement("style");
  style.id = "media-downloader-styles";

  style.textContent = `
    .media-downloader-icon {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      width: 30px !important;
      height: 30px !important;
      min-width: 30px !important;
      max-width: 30px !important;
      margin-left: 8px !important;
      padding: 0 8px !important;
      border: none !important;
      border-radius: 999px !important;
      background: #1f9d55 !important;
      color: #ffffff !important;
      font-family: Arial, sans-serif !important;
      font-size: 13px !important;
      font-weight: 700 !important;
      line-height: 1 !important;
      cursor: pointer !important;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.25) !important;
      vertical-align: middle !important;
      overflow: hidden !important;
      white-space: nowrap !important;
      transition: max-width 0.18s ease, width 0.18s ease, background 0.18s ease !important;
      z-index: 2147483647 !important;
    }

    .media-downloader-icon:hover {
      width: 104px !important;
      max-width: 104px !important;
      background: #168246 !important;
    }

    .media-downloader-icon .md-icon-symbol {
      display: inline-block !important;
      font-size: 16px !important;
      line-height: 1 !important;
    }

    .media-downloader-icon .md-icon-text {
      display: inline-block !important;
      opacity: 0 !important;
      max-width: 0 !important;
      overflow: hidden !important;
      transition: opacity 0.15s ease, max-width 0.15s ease !important;
    }

    .media-downloader-icon:hover .md-icon-text {
      opacity: 1 !important;
      max-width: 70px !important;
    }

    .media-downloader-video-wrapper {
      position: relative !important;
      display: inline-block !important;
      line-height: 0 !important;
    }

    .media-downloader-video-button {
      position: absolute !important;
      top: 10px !important;
      right: 10px !important;
      margin-left: 0 !important;
      opacity: 0.88 !important;
    }

    .media-downloader-video-button:hover {
      opacity: 1 !important;
    }
  `;

  document.documentElement.appendChild(style);
}

function addIconNearLink(linkElement, mediaItem) {
  if (linkElement.hasAttribute(ICON_ADDED_ATTRIBUTE)) return;

  const icon = createDownloadIcon(mediaItem);

  linkElement.insertAdjacentElement("afterend", icon);
  linkElement.setAttribute(ICON_ADDED_ATTRIBUTE, "true");
}

function wrapMediaElementIfNeeded(mediaElement) {
  const parent = mediaElement.parentElement;

  if (
    parent &&
    parent.classList &&
    parent.classList.contains("media-downloader-video-wrapper")
  ) {
    return parent;
  }

  const wrapper = document.createElement("span");
  wrapper.className = "media-downloader-video-wrapper";

  mediaElement.parentNode.insertBefore(wrapper, mediaElement);
  wrapper.appendChild(mediaElement);

  return wrapper;
}

function addIconOnMediaElement(mediaElement, mediaItem) {
  if (mediaElement.hasAttribute(ICON_ADDED_ATTRIBUTE)) return;

  const wrapper = wrapMediaElementIfNeeded(mediaElement);
  const icon = createDownloadIcon(mediaItem);

  icon.classList.add("media-downloader-video-button");

  wrapper.appendChild(icon);
  mediaElement.setAttribute(ICON_ADDED_ATTRIBUTE, "true");
}

function scanAndAddIcons() {
  injectStyles();

  document.querySelectorAll("a[href]").forEach((linkElement) => {
    const mediaItem = buildMediaItem(linkElement.getAttribute("href"), "inline-link");

    if (!mediaItem) return;

    addIconNearLink(linkElement, mediaItem);
  });

  document.querySelectorAll("audio, video").forEach((mediaElement) => {
    let mediaItem =
      buildMediaItem(mediaElement.currentSrc, "inline-media-current-src") ||
      buildMediaItem(mediaElement.getAttribute("src"), "inline-media-src");

    if (!mediaItem) {
      const sourceElement = mediaElement.querySelector("source[src]");
      if (sourceElement) {
        mediaItem = buildMediaItem(sourceElement.getAttribute("src"), "inline-source");
      }
    }

    if (!mediaItem) return;

    addIconOnMediaElement(mediaElement, mediaItem);
  });
}

function collectMediaLinks() {
  const found = new Map();

  function addItem(item) {
    if (!item) return;

    if (!found.has(item.url)) {
      found.set(item.url, item);
    }
  }

  document.querySelectorAll("a[href]").forEach((element) => {
    addItem(buildMediaItem(element.getAttribute("href"), "link"));
  });

  document.querySelectorAll("audio, video").forEach((element) => {
    addItem(buildMediaItem(element.getAttribute("src"), "media-src"));
    addItem(buildMediaItem(element.currentSrc, "media-current-src"));

    element.querySelectorAll("source[src]").forEach((source) => {
      addItem(buildMediaItem(source.getAttribute("src"), "source"));
    });
  });

  try {
    performance.getEntriesByType("resource").forEach((entry) => {
      addItem(buildMediaItem(entry.name, "network-resource"));
    });
  } catch {
    // ignore
  }

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

scanAndAddIcons();

const observer = new MutationObserver(() => {
  scanAndAddIcons();
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});