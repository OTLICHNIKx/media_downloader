function createCaptureId() {
  return `capture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function findTrackCandidateFromTarget(target) {
  if (!target || !(target instanceof Element)) return null;

  const existingTrack = target.closest("[data-media-downloader-track]");
  if (existingTrack) return existingTrack;

  // SPA fallback:
  // пользователь может нажать play раньше, чем MutationObserver успел
  // пометить новую SoundCloud-карточку как data-media-downloader-track.
  try {
    const adapter =
      typeof getCurrentSiteMediaAdapter === "function"
        ? getCurrentSiteMediaAdapter()
        : null;

    if (!adapter || !Array.isArray(adapter.cardSelectors) || adapter.cardSelectors.length === 0) {
      return null;
    }

    const candidate = target.closest(adapter.cardSelectors.join(","));
    if (!candidate) return null;

    if (candidate.closest(`.${MEDIA_DOWNLOADER_ICON_CLASS}`)) {
      return null;
    }

    const metadata =
      typeof getAdapterMetadata === "function"
        ? getAdapterMetadata(candidate, adapter)
        : null;

    if (!metadata || !metadata.title) {
      return null;
    }

    if (typeof markAdapterTrackCandidate === "function") {
      markAdapterTrackCandidate(candidate, adapter, metadata);
    }

    return candidate.matches("[data-media-downloader-track]")
      ? candidate
      : null;
  } catch {
    return null;
  }
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
    resolvedFrom: stream.resolvedFrom || null,
    soundCloudTrackId: stream.soundCloudTrackId || null,
    soundCloudPermalinkUrl: stream.soundCloudPermalinkUrl || null,
    soundCloudClientId: stream.soundCloudClientId || null,
    soundCloudFallbackPlaylistId: stream.soundCloudFallbackPlaylistId || null,
    soundCloudFallbackSegmentCount: stream.soundCloudFallbackSegmentCount || null,
    soundCloudFallbackQuality: stream.soundCloudFallbackQuality || null
  };
}

// SoundCloud кладёт track id в ссылку карточки: /tracks/123456.
// Используется как «ожидаемый» трек для capture, чтобы prefetch соседних
// треков не привязывался к нажатой карточке.
function getSoundCloudTrackIdFromTrackElement(trackElement) {
  if (!trackElement || !(trackElement instanceof Element)) return null;

  const trackLinks = trackElement.querySelectorAll(
    "a[href*='/tracks/']"
  );

  for (const link of trackLinks) {
    const match = (link.getAttribute("href") || "").match(/\/tracks\/(\d+)/);

    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

function getSoundCloudTrackPermalinkFromTrackElement(trackElement) {
  if (!trackElement || !(trackElement instanceof Element)) return "";

  const selectors = [
    ".soundTitle__title[href]",
    ".soundTitle__title a[href]",
    ".trackItem__trackTitle[href]",
    ".trackItem__trackTitle a[href]",
    "a[itemprop='url'][href]",

    // Fallback для новых SoundCloud карточек:
    // часто трек лежит как /artist/track-slug, а не /tracks/123.
    "a[href^='/'][href]",
    "a[href*='soundcloud.com/'][href]"
  ];

  const seenLinks = new Set();

  for (const selector of selectors) {
    const links = trackElement.querySelectorAll(selector);

    for (const link of links) {
      const href = link.getAttribute("href") || "";
      if (!href || seenLinks.has(href)) continue;

      seenLinks.add(href);

      try {
        const url = new URL(href, window.location.origin);

        if (!url.hostname.includes("soundcloud.com")) continue;

        url.hash = "";
        url.search = "";

        const parts = url.pathname
          .split("/")
          .map((part) => part.trim())
          .filter(Boolean);

        // Трековый permalink SoundCloud обычно: /artist/track-slug.
        if (parts.length !== 2) continue;

        const [userSlug, trackSlug] = parts;

        if (!userSlug || !trackSlug) continue;

        const blockedFirstParts = new Set([
          "discover",
          "search",
          "you",
          "messages",
          "notifications",
          "settings",
          "upload",
          "pages",
          "terms-of-use",
          "privacy"
        ]);

        if (blockedFirstParts.has(userSlug)) continue;

        if (
          trackSlug === "sets" ||
          trackSlug === "likes" ||
          trackSlug === "reposts" ||
          trackSlug === "comments"
        ) {
          continue;
        }

        return url.href;
      } catch {
        // ignore
      }
    }
  }

  return "";
}

function getSoundCloudClientIdForSoloTrack() {
  try {
    if (typeof getClientId === "function") {
      return getClientId() || "";
    }
  } catch {
    // ignore
  }

  try {
    const entries = performance.getEntriesByType("resource");

    for (const entry of entries) {
      const name = entry.name || "";
      const match = name.match(/client_id=([a-zA-Z0-9]{20,40})/);

      if (match && match[1]) {
        return match[1];
      }
    }
  } catch {
    // ignore
  }

  return "";
}

// Ищет трек-карточку по SoundCloud trackId среди видимых [data-media-downloader-track].
function getSoundCloudTrackKeyFromTrackElement(trackElement) {
  const trackId = getSoundCloudTrackIdFromTrackElement(trackElement);

  if (trackId) {
    return `id:${trackId}`;
  }

  const permalinkUrl = getSoundCloudTrackPermalinkFromTrackElement(trackElement);

  if (permalinkUrl) {
    return `url:${permalinkUrl}`;
  }

  return "";
}

// Название оставляем старым, чтобы не менять bootstrap.js.
// Но теперь функция умеет искать не только по numeric trackId,
// а и по permalink-key вида url:https://soundcloud.com/artist/track.
function findTrackElementByTrackId(trackIdOrKey) {
  if (!trackIdOrKey) return null;

  const rawKey = String(trackIdOrKey);
  const expectedKey =
    rawKey.startsWith("id:") || rawKey.startsWith("url:")
      ? rawKey
      : `id:${rawKey}`;

  const trackElements = document.querySelectorAll("[data-media-downloader-track]");

  for (const element of trackElements) {
    if (getSoundCloudTrackKeyFromTrackElement(element) === expectedKey) {
      return element;
    }
  }

  return null;
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

  // Numeric id оставляем для background-фильтрации prefetch соседних треков.
  const expectedTrackId = getSoundCloudTrackIdFromTrackElement(trackElement);

  // А для восстановления DOM-карточки используем более устойчивый ключ:
  // numeric id или permalink.
  const trackKey = getSoundCloudTrackKeyFromTrackElement(trackElement);

  if (trackKey) {
    mediaDownloaderCaptureToTrackId.set(captureId, trackKey);
  }

  chrome.runtime.sendMessage(
    {
      type: "START_STREAM_CAPTURE",
      captureId,
      trackTitle,
      reason,
      expectedTrackId,
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

// Запоминает связь trackId → mediaItem для восстановления кнопки
// после ре-рендера/виртуализации DOM SoundCloud.
function rememberTrackBinding(trackElement, mediaItem) {
  if (!trackElement || !mediaItem) return;

  const trackKey = getSoundCloudTrackKeyFromTrackElement(trackElement);
  if (!trackKey) return;

  mediaDownloaderTrackBindings.set(trackKey, mediaItem);
}

// Возвращает сохранённый mediaItem по trackId карточки.
function getBoundMediaItemForTrackElement(trackElement) {
  if (!trackElement) return null;

  const trackKey = getSoundCloudTrackKeyFromTrackElement(trackElement);
  if (!trackKey) return null;

  return mediaDownloaderTrackBindings.get(trackKey) || null;
}

function isSoundCloudTrackButtonContext(trackElement) {
  return (
    window.location.hostname.toLowerCase().includes("soundcloud.com") ||
    trackElement?.getAttribute(TRACK_ADAPTER_ATTRIBUTE) === "soundcloud"
  );
}

function isUsableSoundCloudActionsContainer(element) {
  if (!element || !(element instanceof Element)) return false;

  const rect = element.getBoundingClientRect();

  return rect.width > 20 && rect.height > 20;
}

function getSoundCloudTrackActionsContainer(trackElement) {
  if (!trackElement || !(trackElement instanceof Element)) {
    return null;
  }

  const selectors = [
    ".soundActions .sc-button-group",
    ".soundActions",
    ".sound__soundActions .sc-button-group",
    ".sound__soundActions",
    ".soundFooter .sc-button-group",
    ".soundFooter",
    ".trackItem__actions",
    ".trackItem__additional",
    ".listenEngagement__actions",
    ".listenEngagement"
  ];

  for (const selector of selectors) {
    if (
      trackElement.matches(selector) &&
      isUsableSoundCloudActionsContainer(trackElement)
    ) {
      return trackElement;
    }

    const element = trackElement.querySelector(selector);

    if (isUsableSoundCloudActionsContainer(element)) {
      return element;
    }
  }

  return null;
}

function scheduleSoundCloudTrackButtonRetry() {
  if (typeof scheduleMediaDownloaderScan === "function") {
    scheduleMediaDownloaderScan(500);
  }
}

function addIconOnTrackElement(trackElement, mediaItem) {
  if (!trackElement || !mediaItem) return;

  const isSoundCloud = isSoundCloudTrackButtonContext(trackElement);
  const targetContainer = isSoundCloud
    ? getSoundCloudTrackActionsContainer(trackElement)
    : trackElement;

  // На SoundCloud нельзя падать в absolute/generic overlay.
  // Если action bar ещё не дорисован Ember'ом — ждём следующий scan.
  if (isSoundCloud && !targetContainer) {
    scheduleSoundCloudTrackButtonRetry();
    return;
  }

  const existingIcon = trackElement.querySelector(
    `.${MEDIA_DOWNLOADER_ICON_CLASS}.media-downloader-track-button`
  );

  const nextFallbackId = mediaItem.soundCloudFallbackPlaylistId || "";
  const existingIsCorrectSoundCloudButton =
    !isSoundCloud ||
    (
      existingIcon &&
      existingIcon.classList.contains("media-downloader-soundcloud-track-button") &&
      targetContainer.contains(existingIcon)
    );

  if (
    existingIcon &&
    existingIsCorrectSoundCloudButton &&
    existingIcon.getAttribute(MEDIA_DOWNLOADER_URL_ATTRIBUTE) === mediaItem.url &&
    (existingIcon.getAttribute(MEDIA_DOWNLOADER_FALLBACK_ATTRIBUTE) || "") === nextFallbackId
  ) {
    return;
  }

  if (existingIcon) {
    existingIcon.remove();
  }

  if (!isSoundCloud) {
    const computedStyle = window.getComputedStyle(trackElement);
    if (computedStyle.position === "static") {
      trackElement.style.position = "relative";
    }
  }

  const icon = createDownloadIcon(mediaItem);

  icon.classList.add("media-downloader-track-button");

  if (isSoundCloud) {
    icon.classList.add("media-downloader-soundcloud-track-button");
  }

  icon.setAttribute(MEDIA_DOWNLOADER_URL_ATTRIBUTE, mediaItem.url);

  if (mediaItem.soundCloudFallbackPlaylistId) {
    icon.setAttribute(MEDIA_DOWNLOADER_FALLBACK_ATTRIBUTE, mediaItem.soundCloudFallbackPlaylistId);
  }

  icon.setAttribute(TRACK_STREAM_TYPE_ATTRIBUTE, mediaItem.streamType || mediaItem.extension);

  targetContainer.appendChild(icon);

  trackElement.setAttribute(TRACK_BOUND_ATTRIBUTE, "true");
  trackElement.setAttribute(TRACK_STREAM_URL_ATTRIBUTE, mediaItem.url);
  trackElement.setAttribute(TRACK_STREAM_TYPE_ATTRIBUTE, mediaItem.streamType || mediaItem.extension);

  rememberTrackBinding(trackElement, mediaItem);
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
  const extension = getMediaItemFileExtension(mediaItem);

  const filename = filenameBase
    ? (
        filenameBase.toLowerCase().endsWith(`.${extension}`)
          ? filenameBase
          : `${filenameBase}.${extension}`
      )
    : mediaItem.filename;

  const soundCloudTrackId =
    getSoundCloudTrackIdFromTrackElement(trackElement) ||
    mediaItem.soundCloudTrackId ||
    "";

  const soundCloudPermalinkUrl =
    getSoundCloudTrackPermalinkFromTrackElement(trackElement) ||
    mediaItem.soundCloudPermalinkUrl ||
    "";

  const soundCloudClientId =
    getSoundCloudClientIdForSoloTrack() ||
    mediaItem.soundCloudClientId ||
    "";

  const enriched = {
    ...mediaItem,
    filename,
    trackTitle: cleanMetadataText(trackElement.getAttribute(TRACK_TITLE_ATTRIBUTE) || ""),
    trackAuthor: cleanMetadataText(trackElement.getAttribute(TRACK_AUTHOR_ATTRIBUTE) || ""),
    soundCloudTrackId,
    soundCloudPermalinkUrl,
    soundCloudClientId
  };

  console.log("[Media Downloader] Solo SoundCloud binding:", {
    filename,
    soundCloudTrackId,
    soundCloudPermalinkUrl,
    hasClientId: Boolean(soundCloudClientId),
    capturedUrl: mediaItem.url
  });

  return enriched;
}

// Восстанавливает кнопки скачивания на трек-карточках, которые потеряли их
// из-за ре-рендера/виртуализации SoundCloud. Вызывается после каждого скана.
function restoreTrackButtonsIfMissing() {
  if (mediaDownloaderTrackBindings.size === 0) return;

  document.querySelectorAll("[data-media-downloader-track]").forEach((trackElement) => {
    const existingIcon = trackElement.querySelector(
      `.${MEDIA_DOWNLOADER_ICON_CLASS}.media-downloader-track-button`
    );

    if (existingIcon) {
      if (
        isSoundCloudTrackButtonContext(trackElement) &&
        !existingIcon.classList.contains("media-downloader-soundcloud-track-button")
      ) {
        existingIcon.remove();
      } else {
        return;
      }
    }

    const boundItem = getBoundMediaItemForTrackElement(trackElement);
    if (!boundItem) return;

    addIconOnTrackElement(trackElement, boundItem);
  });
}
