
let mediaDownloaderUiEnabled = true;

const SUPPORTED_EXTENSIONS = ["mp3", "mp4", "wav", "m3u8"];

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
          buttonElement.innerHTML = getDownloadIconMarkup();
        }, 1200);

        return;
      }

      buttonElement.textContent = "Скачивается...";

      setTimeout(() => {
        buttonElement.innerHTML = getDownloadIconMarkup();
      }, 1200);
    }
  );
}

function getDownloadIconMarkup() {
  return `
    <span class="md-icon-symbol" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M12 3v11m0 0 4.5-4.5M12 14 7.5 9.5M5 19h14"
          stroke="currentColor"
          stroke-width="2.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
    <span class="md-icon-text">Скачать</span>
  `;
}

function createDownloadIcon(mediaItem) {
  const button = document.createElement("button");

  button.type = "button";
  button.className = "media-downloader-icon";
  button.title = `Скачать ${mediaItem.filename}`;
  button.innerHTML = getDownloadIconMarkup();

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

      margin-left: 8px !important;
      padding: 2px 4px !important;

      border: none !important;
      background: transparent !important;
      color: #0f8f52 !important;

      font-family: Arial, sans-serif !important;
      font-size: 14px !important;
      font-weight: 700 !important;
      line-height: 1 !important;

      cursor: pointer !important;
      vertical-align: middle !important;
      white-space: nowrap !important;

      transition:
        background 0.18s ease,
        color 0.18s ease,
        padding 0.18s ease,
        border-radius 0.18s ease,
        opacity 0.18s ease !important;

      z-index: 20 !important;
    }

    .media-downloader-icon .md-icon-symbol {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;

      width: 24px !important;
      height: 24px !important;
      min-width: 24px !important;

      background: rgba(31, 157, 85, 0.12) !important;
      border-radius: 8px !important;
    }

    .media-downloader-icon .md-icon-symbol svg {
      width: 20px !important;
      height: 20px !important;
      display: block !important;
    }

    .media-downloader-icon .md-icon-text {
      display: inline-block !important;
      opacity: 0 !important;
      max-width: 0 !important;
      overflow: hidden !important;
      transition: opacity 0.15s ease, max-width 0.15s ease !important;
    }

    .media-downloader-icon:hover {
      background: #1f9d55 !important;
      color: #ffffff !important;
      padding: 5px 7px !important;
      border-radius: 999px !important;
    }

    .media-downloader-icon:hover .md-icon-symbol {
      background: transparent !important;
    }

    .media-downloader-icon:hover .md-icon-text {
      opacity: 1 !important;
      max-width: 80px !important;
    }

    .media-downloader-video-wrapper {
      position: relative !important;
      display: inline-block !important;
      line-height: 0 !important;
      max-width: max-content !important;
    }

    .media-downloader-video-button {
      position: absolute !important;
      top: 10px !important;
      right: 10px !important;
      margin-left: 0 !important;

      opacity: 0 !important;
      pointer-events: none !important;
    }

    .media-downloader-video-wrapper:hover .media-downloader-video-button {
      opacity: 1 !important;
      pointer-events: auto !important;
    }
    
    .media-downloader-video-button .md-icon-symbol {
      background: rgba(255, 255, 255, 0.85) !important;
    }
    
    .media-downloader-ui-disabled .media-downloader-icon {
      display: none !important;
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

function isElementReallyVisible(element) {
  if (!element) return false;

  const style = window.getComputedStyle(element);

  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  if (style.opacity === "0") return false;

  const rect = element.getBoundingClientRect();

  if (element.tagName.toLowerCase() === "a") {
    return rect.width > 0 && rect.height > 0;
  }

  return rect.width > 60 && rect.height > 30;
}

function getCurrentSiteHost() {
  return window.location.hostname;
}

function applyMediaDownloaderUiState(enabled) {
  document.documentElement.classList.toggle(
    "media-downloader-ui-disabled",
    !enabled
  );
}

function loadMediaDownloaderUiState() {
  const host = getCurrentSiteHost();

  chrome.storage.local.get(
    {
      disabledSites: {}
    },
    (result) => {
      const disabledSites = result.disabledSites || {};
      const isDisabled = Boolean(disabledSites[host]);

      applyMediaDownloaderUiState(!isDisabled);
    }
  );
}

function scanAndAddIcons() {
  injectStyles();

  document.querySelectorAll("a[href]").forEach((linkElement) => {
    if (!isElementReallyVisible(linkElement)) return;

    const mediaItem = buildMediaItem(linkElement.getAttribute("href"), "inline-link");
    if (!mediaItem) return;

    addIconNearLink(linkElement, mediaItem);
  });

  document.querySelectorAll("audio, video").forEach((mediaElement) => {
    if (!isElementReallyVisible(mediaElement)) return;

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

    return;
  }

  if (message.type === "SET_MEDIA_DOWNLOADER_UI") {
    applyMediaDownloaderUiState(Boolean(message.enabled));

    sendResponse({
      ok: true,
      enabled: Boolean(message.enabled)
    });
  }
});

loadMediaDownloaderUiState();

scanAndAddIcons();

const observer = new MutationObserver(() => {
  scanAndAddIcons();
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});