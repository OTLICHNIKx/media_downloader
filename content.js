
const TRACK_CAPTURE_ATTRIBUTE = "data-media-downloader-capture-id";
const TRACK_STREAM_URL_ATTRIBUTE = "data-media-downloader-stream-url";
const TRACK_STREAM_TYPE_ATTRIBUTE = "data-media-downloader-stream-type";
const TRACK_BOUND_ATTRIBUTE = "data-media-downloader-track-bound";

const MEDIA_DOWNLOADER_ICON_CLASS = "media-downloader-icon";
const MEDIA_DOWNLOADER_URL_ATTRIBUTE = "data-media-downloader-url";

let mediaDownloaderScanTimer = null;
let mediaDownloaderLastLocation = window.location.href;

let mediaDownloaderUiEnabled = true;
const HLS_PANEL_ID = "media-downloader-hls-panel";
const SUPPORTED_EXTENSIONS = ["mp3", "mp4", "wav", "m3u8", "mpd"];

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

function buildHlsMediaItem(url, source = "latest-hls") {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return null;

  return {
    url: normalizedUrl,
    extension: "m3u8",
    quality: "HLS",
    filename: getFileName(normalizedUrl) || "media.m3u8",
    source
  };
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

  const isHls =
    mediaItem.extension === "m3u8" ||
    mediaItem.streamType === "hls";

  const isDash =
    mediaItem.extension === "mpd" ||
    mediaItem.streamType === "dash";

  if (isHls) {
    buttonElement.textContent = "Открываю HLS...";

    openHlsDownloaderPanel(mediaItem);

    setTimeout(() => {
      buttonElement.innerHTML = getDownloadIconMarkup();
    }, 1200);

    return;
  }

  if (isDash) {
    buttonElement.textContent = "DASH позже";

    console.warn(
      "[Media Downloader] DASH detected, but DASH downloader is not implemented yet:",
      mediaItem.url
    );

    setTimeout(() => {
      buttonElement.innerHTML = getDownloadIconMarkup();
    }, 1500);

    return;
  }

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
    
    [data-media-downloader-track] {
      position: relative;
    }

    [data-media-downloader-capturing="true"] {
      outline: 1px dashed rgba(31, 157, 85, 0.35);
      outline-offset: 3px;
    }

    .media-downloader-track-button {
      position: absolute !important;
      top: 10px !important;
      right: 10px !important;
      margin-left: 0 !important;
      z-index: 30 !important;
    }
  `;

  document.documentElement.appendChild(style);
}

function addIconNearLink(linkElement, mediaItem) {
  const nextElement = linkElement.nextElementSibling;
  const existingIcon =
    nextElement && nextElement.classList && nextElement.classList.contains(MEDIA_DOWNLOADER_ICON_CLASS)
      ? nextElement
      : null;

  if (
    linkElement.hasAttribute(ICON_ADDED_ATTRIBUTE) &&
    existingIcon &&
    existingIcon.getAttribute(MEDIA_DOWNLOADER_URL_ATTRIBUTE) === mediaItem.url
  ) {
    return;
  }

  if (existingIcon) {
    existingIcon.remove();
  }

  const icon = createDownloadIcon(mediaItem);
  icon.setAttribute(MEDIA_DOWNLOADER_URL_ATTRIBUTE, mediaItem.url);

  linkElement.insertAdjacentElement("afterend", icon);
  linkElement.setAttribute(ICON_ADDED_ATTRIBUTE, "true");
}

function wrapMediaElementIfNeeded(mediaElement) {
  if (!mediaElement || !mediaElement.parentNode) return null;

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
  const wrapper = wrapMediaElementIfNeeded(mediaElement);

  if (!wrapper) return;

  const existingIcon = wrapper.querySelector(`.${MEDIA_DOWNLOADER_ICON_CLASS}.media-downloader-video-button`);

  if (
    mediaElement.hasAttribute(ICON_ADDED_ATTRIBUTE) &&
    existingIcon &&
    existingIcon.getAttribute(MEDIA_DOWNLOADER_URL_ATTRIBUTE) === mediaItem.url
  ) {
    return;
  }

  if (existingIcon) {
    existingIcon.remove();
  }

  const icon = createDownloadIcon(mediaItem);
  icon.classList.add("media-downloader-video-button");
  icon.setAttribute(MEDIA_DOWNLOADER_URL_ATTRIBUTE, mediaItem.url);

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

function getLatestHlsStream(callback) {
  chrome.runtime.sendMessage(
    {
      type: "GET_LATEST_HLS_STREAM"
    },
    (response) => {
      if (chrome.runtime.lastError) {
        callback(null);
        return;
      }

      if (!response || !response.ok || !response.stream) {
        callback(null);
        return;
      }

      callback(response.stream);
    }
  );
}

function cleanupBrokenDownloaderMarks() {
  document.querySelectorAll(`[${ICON_ADDED_ATTRIBUTE}]`).forEach((element) => {
    if (element.tagName.toLowerCase() === "a") {
      const nextElement = element.nextElementSibling;
      const hasIcon =
        nextElement &&
        nextElement.classList &&
        nextElement.classList.contains(MEDIA_DOWNLOADER_ICON_CLASS);

      if (!hasIcon) {
        element.removeAttribute(ICON_ADDED_ATTRIBUTE);
      }

      return;
    }

    if (element.matches("audio, video")) {
      const parent = element.parentElement;
      const hasIcon =
        parent &&
        parent.querySelector &&
        parent.querySelector(`.${MEDIA_DOWNLOADER_ICON_CLASS}.media-downloader-video-button`);

      if (!hasIcon) {
        element.removeAttribute(ICON_ADDED_ATTRIBUTE);
      }
    }
  });
}

function createCaptureId() {
  return `capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function findTrackCandidateFromTarget(target) {
  if (!target || !(target instanceof Element)) return null;

  return target.closest("[data-media-downloader-track]");
}

function getOrCreateTrackCaptureId(trackElement) {
  let captureId = trackElement.getAttribute(TRACK_CAPTURE_ATTRIBUTE);

  if (!captureId) {
    captureId = createCaptureId();
    trackElement.setAttribute(TRACK_CAPTURE_ATTRIBUTE, captureId);
  }

  return captureId;
}

function getTrackTitle(trackElement) {
  const explicitTitle =
    trackElement.getAttribute("data-media-title") ||
    trackElement.getAttribute("aria-label");

  if (explicitTitle && explicitTitle.trim()) {
    return explicitTitle.trim();
  }

  const text = trackElement.textContent || "";
  const cleanText = text.replace(/\s+/g, " ").trim();

  if (cleanText) {
    return cleanText.slice(0, 120);
  }

  return "media";
}

function buildStreamMediaItem(stream, source = "captured-stream") {
  if (!stream || !stream.url) return null;

  const normalizedUrl = normalizeUrl(stream.url);
  if (!normalizedUrl) return null;

  const streamType =
    stream.type ||
    (normalizedUrl.toLowerCase().includes(".mpd") ? "dash" : "hls");

  const extension = streamType === "dash" ? "mpd" : "m3u8";

  return {
    url: normalizedUrl,
    extension,
    streamType,
    quality: streamType.toUpperCase(),
    filename: getFileName(normalizedUrl) || `media.${extension}`,
    source
  };
}

function startStreamCaptureForTrack(trackElement, reason = "interaction") {
  if (!trackElement) return;

  const now = Date.now();
  const lastCaptureAt = Number(trackElement.dataset.mediaDownloaderLastCaptureAt || 0);

  if (now - lastCaptureAt < 2500) {
    return;
  }

  trackElement.dataset.mediaDownloaderLastCaptureAt = String(now);

  const captureId = getOrCreateTrackCaptureId(trackElement);
  const trackTitle = getTrackTitle(trackElement);

  chrome.runtime.sendMessage(
    {
      type: "START_STREAM_CAPTURE",
      captureId,
      trackTitle,
      reason,
      timeoutMs: 7000
    },
    (response) => {
      if (chrome.runtime.lastError) {
        return;
      }

      if (!response || !response.ok) {
        return;
      }

      trackElement.setAttribute("data-media-downloader-capturing", "true");

      setTimeout(() => {
        trackElement.removeAttribute("data-media-downloader-capturing");
      }, 7000);
    }
  );
}

function addIconOnTrackElement(trackElement, mediaItem) {
  if (!trackElement || !mediaItem) return;

  const existingIcon = trackElement.querySelector(
    `:scope > .${MEDIA_DOWNLOADER_ICON_CLASS}.media-downloader-track-button`
  );

  if (
    existingIcon &&
    existingIcon.getAttribute(MEDIA_DOWNLOADER_URL_ATTRIBUTE) === mediaItem.url
  ) {
    return;
  }

  if (existingIcon) {
    existingIcon.remove();
  }

  const computedStyle = window.getComputedStyle(trackElement);
  if (computedStyle.position === "static") {
    trackElement.style.position = "relative";
  }

  const icon = createDownloadIcon(mediaItem);
  icon.classList.add("media-downloader-track-button");
  icon.setAttribute(MEDIA_DOWNLOADER_URL_ATTRIBUTE, mediaItem.url);
  icon.setAttribute(TRACK_STREAM_TYPE_ATTRIBUTE, mediaItem.streamType || mediaItem.extension);

  trackElement.appendChild(icon);

  trackElement.setAttribute(TRACK_BOUND_ATTRIBUTE, "true");
  trackElement.setAttribute(TRACK_STREAM_URL_ATTRIBUTE, mediaItem.url);
  trackElement.setAttribute(TRACK_STREAM_TYPE_ATTRIBUTE, mediaItem.streamType || mediaItem.extension);
}

function scanAndAddIcons() {
  injectStyles();
  cleanupBrokenDownloaderMarks();
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

    if (mediaItem) {
      addIconOnMediaElement(mediaElement, mediaItem);
      return;
    }

    if (mediaElement.hasAttribute(ICON_ADDED_ATTRIBUTE)) return;

    const now = Date.now();
    const lastHlsCheckAt = Number(mediaElement.dataset.mediaDownloaderLastHlsCheckAt || 0);

    if (now - lastHlsCheckAt < 2000) return;

    mediaElement.dataset.mediaDownloaderLastHlsCheckAt = String(now);

    getLatestHlsStream((stream) => {
      if (!stream || !stream.url) return;
      if (mediaElement.hasAttribute(ICON_ADDED_ATTRIBUTE)) return;
      if (!isElementReallyVisible(mediaElement)) return;

      const hlsItem = buildHlsMediaItem(stream.url, "latest-hls-stream");

      if (!hlsItem) return;

      addIconOnMediaElement(mediaElement, hlsItem);
    });
  });
}

function scheduleMediaDownloaderScan(delay = 250) {
  clearTimeout(mediaDownloaderScanTimer);

  mediaDownloaderScanTimer = setTimeout(() => {
    try {
      scanAndAddIcons();
    } catch (error) {
      console.warn("[Media Downloader] scan failed:", error);
    }
  }, delay);
}

function handlePossibleSpaNavigation() {
  if (mediaDownloaderLastLocation === window.location.href) {
    return;
  }

  mediaDownloaderLastLocation = window.location.href;

  document.querySelectorAll(`[${ICON_ADDED_ATTRIBUTE}]`).forEach((element) => {
    element.removeAttribute(ICON_ADDED_ATTRIBUTE);
  });

  document.querySelectorAll(`.${MEDIA_DOWNLOADER_ICON_CLASS}`).forEach((element) => {
    element.remove();
  });

  scheduleMediaDownloaderScan(400);
  scheduleMediaDownloaderScan(1200);
}

function installSpaNavigationHooks() {
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function patchedPushState(...args) {
    const result = originalPushState.apply(this, args);

    setTimeout(handlePossibleSpaNavigation, 0);
    setTimeout(() => scheduleMediaDownloaderScan(600), 600);

    return result;
  };

  history.replaceState = function patchedReplaceState(...args) {
    const result = originalReplaceState.apply(this, args);

    setTimeout(handlePossibleSpaNavigation, 0);
    setTimeout(() => scheduleMediaDownloaderScan(600), 600);

    return result;
  };

  window.addEventListener("popstate", () => {
    handlePossibleSpaNavigation();
    scheduleMediaDownloaderScan(600);
  });

  window.addEventListener("hashchange", () => {
    handlePossibleSpaNavigation();
    scheduleMediaDownloaderScan(600);
  });

  window.addEventListener("pageshow", () => {
    scheduleMediaDownloaderScan(300);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      scheduleMediaDownloaderScan(300);
    }
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

function closeHlsDownloaderPanel() {
  const existingPanel = document.getElementById(HLS_PANEL_ID);

  if (existingPanel) {
    existingPanel.remove();
  }
}

function openHlsDownloaderPanel(mediaItem) {
  if (!mediaItem || !mediaItem.url) return;

  closeHlsDownloaderPanel();

  const panelUrl =
    chrome.runtime.getURL("hls/hls.html") +
    `?url=${encodeURIComponent(mediaItem.url)}` +
    `&filename=${encodeURIComponent(mediaItem.filename || "media.m3u8")}` +
    `&embed=1`;

  const iframe = document.createElement("iframe");

  iframe.id = HLS_PANEL_ID;
  iframe.src = panelUrl;
  iframe.allow = "downloads";
  iframe.style.position = "fixed";
  iframe.style.right = "18px";
  iframe.style.bottom = "18px";
  iframe.style.width = "420px";
  iframe.style.height = "320px";
  iframe.style.border = "none";
  iframe.style.borderRadius = "16px";
  iframe.style.background = "#ffffff";
  iframe.style.boxShadow = "0 12px 40px rgba(0, 0, 0, 0.25)";
  iframe.style.zIndex = "2147483646";
  iframe.style.overflow = "hidden";

  document.documentElement.appendChild(iframe);
}

document.addEventListener(
  "pointerover",
  (event) => {
    const target = event.target;

    if (target instanceof Element && target.closest(`.${MEDIA_DOWNLOADER_ICON_CLASS}`)) {
      return;
    }

    const trackElement = findTrackCandidateFromTarget(target);
    if (!trackElement) return;

    startStreamCaptureForTrack(trackElement, "pointerover");
  },
  true
);

document.addEventListener(
  "pointerdown",
  (event) => {
    const target = event.target;

    if (target instanceof Element && target.closest(`.${MEDIA_DOWNLOADER_ICON_CLASS}`)) {
      return;
    }

    const trackElement = findTrackCandidateFromTarget(target);
    if (!trackElement) return;

    startStreamCaptureForTrack(trackElement, "pointerdown");
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

    return;
  }

  if (message.type === "SET_MEDIA_DOWNLOADER_UI") {
    applyMediaDownloaderUiState(Boolean(message.enabled));

    sendResponse({
      ok: true,
      enabled: Boolean(message.enabled)
    });

    return;
  }

  if (message.type === "MEDIA_DOWNLOADER_CAPTURED_STREAM") {
    const captureId = message.captureId;
    const stream = message.stream;

    const trackElement = Array.from(
      document.querySelectorAll(`[${TRACK_CAPTURE_ATTRIBUTE}]`)
    ).find((element) => {
      return element.getAttribute(TRACK_CAPTURE_ATTRIBUTE) === captureId;
    });

    if (!trackElement) {
      sendResponse({
        ok: false,
        error: "Track element not found for captureId"
      });

      return;
    }

    const mediaItem = buildStreamMediaItem(stream, "captured-stream");

    if (!mediaItem) {
      sendResponse({
        ok: false,
        error: "Cannot build media item from captured stream"
      });

      return;
    }

    addIconOnTrackElement(trackElement, mediaItem);

    sendResponse({
      ok: true
    });
  }
});

window.addEventListener("message", (event) => {
  const panel = document.getElementById(HLS_PANEL_ID);

  if (!panel) return;
  if (event.source !== panel.contentWindow) return;

  if (
    event.data &&
    event.data.source === "MEDIA_DOWNLOADER_HLS" &&
    event.data.type === "CLOSE"
  ) {
    closeHlsDownloaderPanel();
  }
});

loadMediaDownloaderUiState();

installSpaNavigationHooks();

scheduleMediaDownloaderScan(100);
scheduleMediaDownloaderScan(800);
scheduleMediaDownloaderScan(1800);

const observer = new MutationObserver(() => {
  handlePossibleSpaNavigation();
  scheduleMediaDownloaderScan(350);
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

setInterval(() => {
  handlePossibleSpaNavigation();
  scheduleMediaDownloaderScan(300);
}, 3000);