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
    trackElement.getAttribute(TRACK_TITLE_ATTRIBUTE) ||
    trackElement.getAttribute("aria-label");

  const author = trackElement.getAttribute(TRACK_AUTHOR_ATTRIBUTE);

  if (explicitTitle && explicitTitle.trim()) {
    const cleanTitle = cleanMetadataText(explicitTitle);
    const cleanAuthor = cleanMetadataText(author);

    return cleanAuthor ? `${cleanAuthor} - ${cleanTitle}` : cleanTitle;
  }

  const text = trackElement.textContent || "";
  const cleanText = cleanMetadataText(text);

  if (cleanText) {
    return cleanText.slice(0, 120);
  }

  return "media";
}

function buildStreamMediaItem(stream, source = "captured-stream") {
  if (!stream || !stream.url) return null;

  if (stream.isFragmentLike && !stream.isManifestLike) {
    return null;
  }

  const normalizedUrl = normalizeUrl(stream.url);
  if (!normalizedUrl) return null;

  const urlExtension = getExtensionFromUrl(normalizedUrl);

  const streamType =
    stream.type ||
    (normalizedUrl.toLowerCase().includes(".mpd") ? "dash" : null) ||
    (normalizedUrl.toLowerCase().includes(".m3u8") ? "hls" : null) ||
    "audio";

  let extension = stream.extension || urlExtension;

  if (!extension) {
    if (streamType === "dash") {
      extension = "mpd";
    } else if (streamType === "hls") {
      extension = "m3u8";
    } else {
      extension = "mp3";
    }
  }

  const quality =
    streamType === "audio"
      ? guessQuality(normalizedUrl)
      : streamType.toUpperCase();

  return {
    url: normalizedUrl,
    extension,
    streamType,
    quality,
    filename: getFileName(normalizedUrl) || `media.${extension}`,
    source,
    soundCloudFallbackPlaylistId: stream.soundCloudFallbackPlaylistId || null,
    soundCloudFallbackSegmentCount: stream.soundCloudFallbackSegmentCount || null,
    soundCloudFallbackQuality: stream.soundCloudFallbackQuality || null
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

  const nextFallbackId = mediaItem.soundCloudFallbackPlaylistId || "";

  if (
    existingIcon &&
    existingIcon.getAttribute(MEDIA_DOWNLOADER_URL_ATTRIBUTE) === mediaItem.url &&
    (existingIcon.getAttribute(MEDIA_DOWNLOADER_FALLBACK_ATTRIBUTE) || "") === nextFallbackId
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
  if (mediaItem.soundCloudFallbackPlaylistId) {
    icon.setAttribute(MEDIA_DOWNLOADER_FALLBACK_ATTRIBUTE, mediaItem.soundCloudFallbackPlaylistId);
  }
  icon.setAttribute(TRACK_STREAM_TYPE_ATTRIBUTE, mediaItem.streamType || mediaItem.extension);

  trackElement.appendChild(icon);

  trackElement.setAttribute(TRACK_BOUND_ATTRIBUTE, "true");
  trackElement.setAttribute(TRACK_STREAM_URL_ATTRIBUTE, mediaItem.url);
  trackElement.setAttribute(TRACK_STREAM_TYPE_ATTRIBUTE, mediaItem.streamType || mediaItem.extension);
}

function cleanMetadataText(text) {
  if (!text) return "";

  return text
    .replace(/\s+/g, " ")
    .replace(/\bplay\b/gi, "")
    .replace(/\bdownload\b/gi, "")
    .trim();
}

function getTrackFilenameBase(trackElement) {
  if (!trackElement) return "";

  const title = cleanMetadataText(
    trackElement.getAttribute(TRACK_TITLE_ATTRIBUTE) ||
    trackElement.getAttribute("aria-label") ||
    ""
  );

  const author = cleanMetadataText(
    trackElement.getAttribute(TRACK_AUTHOR_ATTRIBUTE) ||
    ""
  );

  if (!title) return "";

  const base = author ? `${author} - ${title}` : title;

  return sanitizeFilename(base).slice(0, 160);
}

function getMediaItemFileExtension(mediaItem) {
  if (!mediaItem) return "media";

  if (mediaItem.extension) {
    return mediaItem.extension.replace(/^\./, "");
  }

  if (mediaItem.streamType === "hls") return "m3u8";
  if (mediaItem.streamType === "dash") return "mpd";

  return getExtensionFromUrl(mediaItem.url) || "media";
}

function enrichMediaItemWithTrackMetadata(mediaItem, trackElement) {
  if (!mediaItem || !trackElement) return mediaItem;

  const filenameBase = getTrackFilenameBase(trackElement);

  if (!filenameBase) {
    return mediaItem;
  }

  const extension = getMediaItemFileExtension(mediaItem);
  const filename = filenameBase.toLowerCase().endsWith(`.${extension}`)
    ? filenameBase
    : `${filenameBase}.${extension}`;

  return {
    ...mediaItem,
    filename,
    trackTitle: cleanMetadataText(trackElement.getAttribute(TRACK_TITLE_ATTRIBUTE) || ""),
    trackAuthor: cleanMetadataText(trackElement.getAttribute(TRACK_AUTHOR_ATTRIBUTE) || "")
  };
}
