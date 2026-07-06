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
  // Если есть серия SPA-ресканов — используем её.
  // Один scheduleMediaDownloaderScan() может не попасть в момент,
  // когда SoundCloud уже дорисовал action bar.
  if (typeof scheduleMediaDownloaderRescansAfterNavigation === "function") {
    scheduleMediaDownloaderRescansAfterNavigation();
    return;
  }

  if (typeof scheduleMediaDownloaderScan === "function") {
    scheduleMediaDownloaderScan(500);
  }
}

function addIconOnTrackElement(trackElement, mediaItem) {
  if (!trackElement || !mediaItem) return;

  const isSoundCloud = isSoundCloudTrackButtonContext(trackElement);

  // ВАЖНО:
  // Сначала запоминаем stream binding, и только потом пытаемся вставить кнопку.
  // На F5 / SPA-render SoundCloud может поймать поток раньше, чем дорисует
  // .soundActions/.trackItem__actions. Если выйти раньше без rememberTrackBinding(),
  // повторный scan уже не сможет восстановить кнопку.
  if (isSoundCloud) {
    rememberTrackBinding(trackElement, mediaItem);
  }

  const targetContainer = isSoundCloud
    ? getSoundCloudTrackActionsContainer(trackElement)
    : trackElement;

  // На SoundCloud нельзя падать в absolute/generic overlay.
  // Если action bar ещё не дорисован Ember'ом — ждём следующий scan.
  // Binding уже сохранён выше, поэтому restoreTrackButtonsIfMissing()
  // сможет поставить кнопку позже.
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
    icon.setAttribute(
      MEDIA_DOWNLOADER_FALLBACK_ATTRIBUTE,
      mediaItem.soundCloudFallbackPlaylistId
    );
  }

  icon.setAttribute(
    TRACK_STREAM_TYPE_ATTRIBUTE,
    mediaItem.streamType || mediaItem.extension
  );

  targetContainer.appendChild(icon);

  trackElement.setAttribute(TRACK_BOUND_ATTRIBUTE, "true");
  trackElement.setAttribute(TRACK_STREAM_URL_ATTRIBUTE, mediaItem.url);
  trackElement.setAttribute(
    TRACK_STREAM_TYPE_ATTRIBUTE,
    mediaItem.streamType || mediaItem.extension
  );

  // Для не-SoundCloud сохраняем как раньше в конце.
  // Для SoundCloud это повторный safe-call, Map просто обновит тот же ключ.
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

const soloSoundCloudResolvedTrackCache = new Map();
const soloSoundCloudResolveInFlight = new Set();
const soloSoundCloudResolveFailedAt = new Map();

function isSoundCloudTrackNearViewport(trackElement) {
  if (!trackElement || !(trackElement instanceof Element)) return false;

  const rect = trackElement.getBoundingClientRect();

  return (
    rect.width > 20 &&
    rect.height > 20 &&
    rect.bottom >= -400 &&
    rect.top <= window.innerHeight + 1800
  );
}

function soloSoundCloudAppendUrlParams(url, params) {
  const parsedUrl = new URL(url, window.location.href);

  Object.entries(params).forEach(([key, value]) => {
    if (!value || parsedUrl.searchParams.has(key)) return;
    parsedUrl.searchParams.set(key, value);
  });

  return parsedUrl.href;
}

async function soloSoundCloudFetchJson(url) {
  const response = await fetch(url, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(`SoundCloud API HTTP ${response.status}`);
  }

  return response.json();
}

function soloSoundCloudFindStringValueByKeyDeep(value, keyMatchers, depth = 0, seen = new Set()) {
  if (!value || typeof value !== "object" || depth > 6 || seen.has(value)) {
    return "";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = soloSoundCloudFindStringValueByKeyDeep(
        item,
        keyMatchers,
        depth + 1,
        seen
      );

      if (found) return found;
    }

    return "";
  }

  for (const [key, item] of Object.entries(value)) {
    if (
      keyMatchers.some((matcher) => matcher.test(key)) &&
      (typeof item === "string" || typeof item === "number") &&
      String(item)
    ) {
      return String(item);
    }

    const nested = soloSoundCloudFindStringValueByKeyDeep(
      item,
      keyMatchers,
      depth + 1,
      seen
    );

    if (nested) return nested;
  }

  return "";
}

function soloSoundCloudGetTrackAuthorization(track) {
  return soloSoundCloudFindStringValueByKeyDeep(track, [
    /^track_authorization$/i,
    /^trackAuthorization$/i
  ]);
}

function soloSoundCloudGetTrackIdFromApiTrack(track) {
  if (!track) return "";

  if (typeof track.id === "number" || typeof track.id === "string") {
    return String(track.id);
  }

  const urn = track.urn || track.track_urn || "";
  const match = String(urn).match(/soundcloud:tracks:(\d+)/i);

  return match && match[1] ? match[1] : "";
}

function soloSoundCloudGetTrackDurationMs(track) {
  return Number(
    track?.duration ||
      track?.full_duration ||
      track?.fullDuration ||
      track?.publisher_metadata?.duration ||
      0
  ) || 0;
}

function soloSoundCloudIsSnippedTranscoding(transcoding) {
  const markerText = [
    transcoding?.preset,
    transcoding?.quality,
    transcoding?.url,
    transcoding?.format?.mime_type,
    transcoding?.format?.protocol
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    transcoding?.snipped === true ||
    markerText.includes("preview") ||
    markerText.includes("snippet") ||
    markerText.includes("snipped")
  );
}

function soloSoundCloudScoreHlsTranscoding(transcoding, trackDurationMs) {
  const mime = String(transcoding?.format?.mime_type || "").toLowerCase();
  const preset = String(transcoding?.preset || "").toLowerCase();
  const duration = Number(transcoding?.duration || 0) || 0;

  let score = 0;

  if (!soloSoundCloudIsSnippedTranscoding(transcoding)) score += 1000;
  if (mime.includes("audio/aac")) score += 200;
  if (preset.includes("aac_160k")) score += 120;
  if (mime.includes("audio/mpeg")) score += 80;

  if (trackDurationMs && duration) {
    const ratio = duration / trackDurationMs;

    if (ratio >= 0.9 && ratio <= 1.1) score += 300;
    else if (ratio >= 0.6) score += 100;
    else if (ratio < 0.4) score -= 500;
  }

  return score;
}

function soloSoundCloudGetBestHlsTranscoding(track) {
  const transcodings = track?.media?.transcodings;

  if (!Array.isArray(transcodings)) {
    return null;
  }

  const hlsTranscodings = transcodings.filter((transcoding) => {
    return (
      transcoding?.url &&
      String(transcoding?.format?.protocol || "").toLowerCase() === "hls" &&
      !soloSoundCloudIsSnippedTranscoding(transcoding)
    );
  });

  if (hlsTranscodings.length === 0) {
    return null;
  }

  const trackDurationMs = soloSoundCloudGetTrackDurationMs(track);

  return [...hlsTranscodings].sort((a, b) => {
    return (
      soloSoundCloudScoreHlsTranscoding(b, trackDurationMs) -
      soloSoundCloudScoreHlsTranscoding(a, trackDurationMs)
    );
  })[0] || null;
}

async function soloSoundCloudResolvePlaylistUrlFromTranscoding(transcoding, clientId, trackAuthorization) {
  if (!transcoding?.url || !clientId) {
    return "";
  }

  const mediaUrl = soloSoundCloudAppendUrlParams(transcoding.url, {
    client_id: clientId,
    track_authorization: trackAuthorization
  });

  const data = await soloSoundCloudFetchJson(mediaUrl);

  return String(data?.url || "");
}

async function resolveSoloSoundCloudTrackMediaItemFromApi(trackElement) {
  const trackKey = getSoundCloudTrackKeyFromTrackElement(trackElement);
  const permalinkUrl = getSoundCloudTrackPermalinkFromTrackElement(trackElement);
  const clientId = getSoundCloudClientIdForSoloTrack();

  if (!trackKey || !permalinkUrl || !clientId) {
    return null;
  }

  if (soloSoundCloudResolvedTrackCache.has(trackKey)) {
    return soloSoundCloudResolvedTrackCache.get(trackKey);
  }

  const resolveUrl =
    `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(permalinkUrl)}` +
    `&client_id=${encodeURIComponent(clientId)}`;

  const trackData = await soloSoundCloudFetchJson(resolveUrl);

  if (trackData?.kind && trackData.kind !== "track") {
    throw new Error(`Resolved object is not track: ${trackData.kind}`);
  }

  const trackAuthorization = soloSoundCloudGetTrackAuthorization(trackData);
  const bestTranscoding = soloSoundCloudGetBestHlsTranscoding(trackData);

  if (!bestTranscoding) {
    throw new Error("No HLS transcoding found");
  }

  const playlistUrl = await soloSoundCloudResolvePlaylistUrlFromTranscoding(
    bestTranscoding,
    clientId,
    trackAuthorization
  );

  if (!playlistUrl) {
    throw new Error("No HLS playlist URL returned");
  }

  const trackId = soloSoundCloudGetTrackIdFromApiTrack(trackData);

  const mediaItem = buildStreamMediaItem(
    {
      url: playlistUrl,
      type: "hls",
      extension: "m3u8",
      isManifestLike: true,
      isFragmentLike: false,
      contentType: "application/vnd.apple.mpegurl",
      soundCloudTrackId: trackId,
      soundCloudPermalinkUrl: permalinkUrl,
      soundCloudClientId: clientId
    },
    "soundcloud-api-resolve"
  );

  if (!mediaItem) {
    return null;
  }

  const enrichedMediaItem = enrichMediaItemWithTrackMetadata(
    mediaItem,
    trackElement
  );

  soloSoundCloudResolvedTrackCache.set(trackKey, enrichedMediaItem);

  return enrichedMediaItem;
}

function maybeResolveMissingSoloSoundCloudButton(trackElement) {
  if (!isSoundCloudTrackButtonContext(trackElement)) return;

  const trackKey = getSoundCloudTrackKeyFromTrackElement(trackElement);
  if (!trackKey) return;

  if (mediaDownloaderTrackBindings.has(trackKey)) return;
  if (soloSoundCloudResolveInFlight.has(trackKey)) return;

  const failedAt = Number(soloSoundCloudResolveFailedAt.get(trackKey) || 0);
  if (failedAt && Date.now() - failedAt < 30000) return;

  if (!isSoundCloudTrackNearViewport(trackElement)) return;

  soloSoundCloudResolveInFlight.add(trackKey);

  resolveSoloSoundCloudTrackMediaItemFromApi(trackElement)
    .then((mediaItem) => {
      if (!mediaItem) return;

      const currentTrackElement = findTrackElementByTrackId(trackKey) || trackElement;

      if (!currentTrackElement || !document.documentElement.contains(currentTrackElement)) {
        return;
      }

      addIconOnTrackElement(currentTrackElement, mediaItem);
    })
    .catch((error) => {
      soloSoundCloudResolveFailedAt.set(trackKey, Date.now());

      console.warn(
        "[Media Downloader] Solo SoundCloud API resolve failed:",
        error?.message || error
      );
    })
    .finally(() => {
      soloSoundCloudResolveInFlight.delete(trackKey);
    });
}

// Восстанавливает кнопки скачивания на трек-карточках, которые потеряли их
// из-за ре-рендера/виртуализации SoundCloud. Вызывается после каждого скана.
function restoreTrackButtonsIfMissing() {
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

    if (boundItem) {
      addIconOnTrackElement(trackElement, boundItem);
      return;
    }

    // После F5 SoundCloud иногда уже загрузил поток до того,
    // как capture успел привязаться к карточке.
    // Тогда восстанавливаем кнопку через api-v2 resolve по permalink.
    maybeResolveMissingSoloSoundCloudButton(trackElement);
  });
}
