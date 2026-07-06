// SoundCloud /sets/ pages: добавляет плавающую кнопку "Скачать плейлист".
// Собирает видимые треки из DOM (только отрендеренные — без автоскролла),
// передаёт их в background через START_PLAYLIST_BATCH_DOWNLOAD, который
// открывает playlist-downloader.html для батч-скачивания в MP3 + ZIP.

// Дубликат shared/filename.js — content-скрипты classic, не могут import.
function sanitizeSetsFilename(filename) {
  return filename
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

const SETS_INLINE_BUTTON_CLASS = "media-downloader-inline-sets-button";
const SETS_INLINE_CARD_ATTRIBUTE = "data-media-downloader-soundcloud-playlist-card";
const SETS_INLINE_URL_ATTRIBUTE = "data-media-downloader-sets-url";

const embeddedPlaylistInfoCache = new Map();
const embeddedPlaylistResolveInFlight = new Set();

const SETS_BUTTON_ID = "media-downloader-sets-button";
const SETS_BUTTON_CLASS = "media-downloader-sets-button";
const SETS_STYLES_ID = "media-downloader-sets-styles";

const SETS_MAX_SCAN_WAIT_MS = 1500;
const SETS_DOM_COUNT_GRACE_AFTER_NAV_MS = 1200;
const SETS_RESCAN_AFTER_NAV_DELAYS_MS = [0, 150, 400, 900, 1600, 3000, 5000];

let setsScanTimer = null;
let setsLastLocation = window.location.href;
let setsLastScanRunAt = 0;
let setsLastNavigationAt = 0;
let setsNavigationScanToken = 0;
let setsButtonBusy = false;

let setsInlineScanTimer = null;
let setsInlineLastScanAt = 0;

const SETS_INLINE_SCAN_DEBOUNCE_MS = 900;
const SETS_INLINE_MAX_CARDS_PER_SCAN = 40;

// Инжектирует стили плавающей кнопки (один раз).
// Скрывается через .media-downloader-ui-disabled, как и инлайн-иконки.
function injectSetsStyles() {
  if (document.getElementById(SETS_STYLES_ID)) return;

  const style = document.createElement("style");
  style.id = SETS_STYLES_ID;

  style.textContent = `
    .media-downloader-sets-button {
      position: fixed !important;
      bottom: 20px !important;
      right: 20px !important;
      z-index: 2147483647 !important;
    
      display: inline-flex !important;
      align-items: center !important;
      gap: 8px !important;
    
      padding: 12px 20px !important;
      border: none !important;
      border-radius: 999px !important;
      background: #16a34a !important;
      color: #ffffff !important;
    
      font-family: Arial, sans-serif !important;
      font-size: 14px !important;
      font-weight: 700 !important;
      line-height: 1 !important;
    
      cursor: pointer !important;
      box-shadow: 0 4px 14px rgba(22, 163, 74, 0.4) !important;
      transition: background 0.18s ease, transform 0.12s ease !important;
    }
    
    .media-downloader-sets-button:hover {
      background: #15803d !important;
      transform: translateY(-1px) !important;
    }

    .media-downloader-sets-button:active {
      transform: translateY(0) !important;
    }

    .media-downloader-sets-button:disabled {
      opacity: 0.7 !important;
      cursor: default !important;
      transform: none !important;
    }
    
        .media-downloader-inline-sets-button {
      position: static !important;

      height: 40px !important;
      min-height: 40px !important;
      max-height: 40px !important;

      padding: 0 14px !important;
      border: none !important;
      border-radius: 4px !important;

      background: #16a34a !important;
      color: #ffffff !important;

      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;

      font-family: Arial, sans-serif !important;
      font-size: 13px !important;
      font-weight: 700 !important;
      line-height: 1 !important;
      white-space: nowrap !important;

      cursor: pointer !important;
      vertical-align: top !important;
      flex: 0 0 auto !important;
    }

    .media-downloader-inline-sets-button:hover {
      background: #15803d !important;
      color: #ffffff !important;
    }

    .media-downloader-inline-sets-button:disabled {
      opacity: 0.72 !important;
      cursor: default !important;
    }

    .media-downloader-ui-disabled .media-downloader-inline-sets-button {
      display: none !important;
    }

    .media-downloader-ui-disabled .media-downloader-sets-button {
      display: none !important;
    }
  `;

  document.documentElement.appendChild(style);
}

// True только на страницах плейлистов SoundCloud (/sets/...).
function isSoundCloudSetsPage() {
  return (
    window.location.hostname.includes("soundcloud.com") &&
    window.location.pathname.includes("/sets/")
  );
}

function getSoundCloudComparablePath(value) {
  try {
    const parsedUrl = new URL(value, window.location.href);

    if (!parsedUrl.hostname.includes("soundcloud.com")) {
      return "";
    }

    return parsedUrl.pathname
      .replace(/\/+$/g, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

function getCurrentSetsPageKey() {
  return getSoundCloudComparablePath(window.location.href);
}

function getPlaylistResourceCandidatePaths(resource) {
  const paths = [];

  function addPath(value) {
    const path = getSoundCloudComparablePath(value);
    if (path) paths.push(path);
  }

  addPath(resource?.permalink_url);
  addPath(resource?.permalinkUrl);

  const userSlug = resource?.user?.permalink;
  const playlistSlug = resource?.permalink;

  if (userSlug && playlistSlug) {
    paths.push(
      `/${String(userSlug).replace(/^\/+|\/+$/g, "")}/sets/${String(playlistSlug).replace(/^\/+|\/+$/g, "")}`
        .toLowerCase()
    );
  }

  return [...new Set(paths)];
}

function isPlaylistResourceForCurrentPage(resource) {
  const currentPath = getCurrentSetsPageKey();
  const resourcePaths = getPlaylistResourceCandidatePaths(resource);

  // Если SoundCloud не дал permalink в hydration, оставляем старое поведение.
  // Но когда permalink есть, обязательно сверяем его с текущим URL,
  // иначе после SPA-перехода можно взять track_count от прошлого плейлиста.
  if (resourcePaths.length === 0) return true;

  return resourcePaths.includes(currentPath);
}

// Извлекает числовой track id из href.
// SoundCloud использует два формата ссылок на треки:
//   /tracks/123456            — числовой id напрямую
//   /artist/track-slug        — slug, id отсутствует (нужен hydration)
function getTrackIdFromHref(href) {
  if (!href) return null;

  const match = href.match(/\/tracks\/(\d+)/);

  return match && match[1] ? match[1] : null;
}

function getTrackIdFromApiTrack(track) {
  if (!track) return null;

  if (typeof track.id === "number" || typeof track.id === "string") {
    return String(track.id);
  }

  const urn = track.urn || track.track_urn || "";
  const match = String(urn).match(/soundcloud:tracks:(\d+)/i);

  return match && match[1] ? match[1] : null;
}

function getTrackUrnFromApiTrack(track) {
  if (!track) return null;

  const urn = track.urn || track.track_urn || "";
  if (urn) return String(urn);

  const trackId = getTrackIdFromApiTrack(track);
  return trackId ? `soundcloud:tracks:${trackId}` : null;
}

function findStringValueByKeyDeep(value, keyMatchers, depth = 0, seen = new Set()) {
  if (!value || typeof value !== "object" || depth > 6 || seen.has(value)) {
    return "";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStringValueByKeyDeep(item, keyMatchers, depth + 1, seen);
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

    const nested = findStringValueByKeyDeep(item, keyMatchers, depth + 1, seen);
    if (nested) return nested;
  }

  return "";
}

function getTrackAuthorizationFromApiTrack(track) {
  return findStringValueByKeyDeep(track, [/^track_authorization$/i, /^trackAuthorization$/i]);
}

function getPermalinkUrlFromApiTrack(track) {
  return String(track?.permalink_url || track?.permalinkUrl || "");
}

function isSnippedSoundCloudTranscoding(transcoding) {
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

function getTrackDurationMsFromApiTrack(track) {
  return Number(
    track?.duration ||
      track?.full_duration ||
      track?.fullDuration ||
      track?.publisher_metadata?.duration ||
      0
  ) || 0;
}

function scoreSoundCloudHlsTranscoding(transcoding, trackDurationMs) {
  const mime = String(transcoding?.format?.mime_type || "").toLowerCase();
  const preset = String(transcoding?.preset || "").toLowerCase();
  const duration = Number(transcoding?.duration || 0) || 0;

  let score = 0;

  if (!isSnippedSoundCloudTranscoding(transcoding)) score += 1000;
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

function getSoundCloudPolicy(track) {
  return String(track?.policy || "").toUpperCase();
}

function getTrackAvailabilityReason(track) {
  const policy = getSoundCloudPolicy(track);
  const streamable = track?.streamable;

  if (policy === "BLOCK") {
    return "Трек недоступен в текущем регионе";
  }

  if (policy === "SNIP") {
    return "Трек доступен только как 30-секундный preview";
  }

  if (streamable === false) {
    return "Трек недоступен для стриминга";
  }

  return "";
}

function getBestHlsTranscodingUrl(track) {
  const transcodings = track?.media?.transcodings;
  if (!Array.isArray(transcodings)) return "";

  const hlsTranscodings = transcodings.filter((transcoding) => {
    return (
      transcoding?.url &&
      String(transcoding?.format?.protocol || "").toLowerCase() === "hls" &&
      !isSnippedSoundCloudTranscoding(transcoding)
    );
  });

  if (hlsTranscodings.length === 0) return "";

  const trackDurationMs = getTrackDurationMsFromApiTrack(track);

  const sorted = [...hlsTranscodings].sort((a, b) => {
    return (
      scoreSoundCloudHlsTranscoding(b, trackDurationMs) -
      scoreSoundCloudHlsTranscoding(a, trackDurationMs)
    );
  });

  return sorted[0]?.url || "";
}

function normalizePlaylistTrack(track) {
  const title = cleanSetsText(track?.title || "");
  const trackId = getTrackIdFromApiTrack(track);
  const trackUrn = getTrackUrnFromApiTrack(track);

  if (!title || (!trackId && !trackUrn)) return null;

    return {
    trackId: trackId || trackUrn,
    trackUrn,
    title,
    author: cleanAuthorName(track?.user?.username || ""),
    permalinkUrl: getPermalinkUrlFromApiTrack(track),
    hlsUrl: getBestHlsTranscodingUrl(track),
    trackAuthorization: getTrackAuthorizationFromApiTrack(track),
    availabilityReason: getTrackAvailabilityReason(track),
    durationMs: getTrackDurationMsFromApiTrack(track)
  };
}

// Извлекает плейлист-данные из SoundCloud hydration JSON.
// SoundCloud встраивает на странице <script>window.__sc_hydration = [...]</script>
// с информацией о плейлисте и (обрезанным) списком треков.
// Возвращает { playlistId, tracks } или null.
function extractPlaylistFromHydration() {
  try {
    const scripts = document.querySelectorAll("script:not([src])");

    for (const script of scripts) {
      const text = script.textContent || "";

      const match = text.match(
        /window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);/
      );

      if (!match || !match[1]) continue;

      const hydration = JSON.parse(match[1]);

      // Ищем playlist-ресурс именно для текущего /sets/ URL.
      // На SPA-переходах старый hydration-скрипт остаётся в DOM,
      // поэтому без проверки permalink можно показать кнопку прошлого плейлиста.
      for (const item of hydration) {
        const resource = item?.hydratable === "playlist" ? item?.data : null;

        if (!resource || (!resource.id && !resource.urn)) continue;
        if (!isPlaylistResourceForCurrentPage(resource)) continue;

        const tracks = Array.isArray(resource.tracks)
          ? resource.tracks.map(normalizePlaylistTrack).filter(Boolean)
          : [];

        return {
          playlistId: String(resource.id || resource.urn),
          playlistUrn: resource.urn ? String(resource.urn) : "",
          trackCount: Number(resource.track_count || resource.trackCount || tracks.length) || tracks.length,
          permalinkUrl: String(resource.permalink_url || resource.permalinkUrl || ""),
          tracks
        };
      }
    }
  } catch {
    // ignore — фолбэк на DOM
  }

  return null;
}

async function fetchSoundCloudJson(url) {
  const response = await fetch(url, { credentials: "include" });

  if (!response.ok) {
    throw new Error(`SoundCloud API HTTP ${response.status}`);
  }

  return response.json();
}

function appendSoundCloudUrlParams(url, params) {
  const parsedUrl = new URL(url, window.location.href);

  Object.entries(params).forEach(([key, value]) => {
    if (!value || parsedUrl.searchParams.has(key)) return;
    parsedUrl.searchParams.set(key, value);
  });

  return parsedUrl.href;
}

function getSoundCloudCollectionItems(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.collection)) return data.collection;
  if (Array.isArray(data?.tracks)) return data.tracks;

  return [];
}

function normalizePlaylistTrackFromCollectionItem(item) {
  return normalizePlaylistTrack(item?.track || item);
}

function getPlaylistTrackDedupKey(track) {
  return String(track?.trackUrn || track?.trackId || track?.permalinkUrl || "");
}

function dedupePlaylistTracks(tracks) {
  const seen = new Set();
  const result = [];

  for (const track of tracks) {
    const key = getPlaylistTrackDedupKey(track);
    if (!key || seen.has(key)) continue;

    seen.add(key);
    result.push(track);
  }

  return result;
}

async function fetchAllSoundCloudCollection(firstUrl, clientId, maxPages = 20) {
  const items = [];
  const seenUrls = new Set();
  let nextUrl = firstUrl;
  let page = 0;

  while (nextUrl && page < maxPages && !seenUrls.has(nextUrl)) {
    page += 1;
    seenUrls.add(nextUrl);

    const data = await fetchSoundCloudJson(nextUrl);
    items.push(...getSoundCloudCollectionItems(data));

    const rawNextUrl = data?.next_href || data?.nextHref || "";

    nextUrl = rawNextUrl
      ? appendSoundCloudUrlParams(rawNextUrl, {
          client_id: clientId,
          limit: "200",
          linked_partitioning: "1",
          representation: "full"
        })
      : "";
  }

  return items;
}

function mergeTrackMetadata(baseTrack, detailedTrack) {
  if (!detailedTrack) return baseTrack;

  return {
    ...baseTrack,
    trackId: baseTrack.trackId || detailedTrack.trackId,
    trackUrn: baseTrack.trackUrn || detailedTrack.trackUrn,
    title: baseTrack.title || detailedTrack.title,
    author: baseTrack.author || detailedTrack.author,
    permalinkUrl: baseTrack.permalinkUrl || detailedTrack.permalinkUrl,
    hlsUrl: baseTrack.hlsUrl || detailedTrack.hlsUrl,
    trackAuthorization: baseTrack.trackAuthorization || detailedTrack.trackAuthorization,
    durationMs: baseTrack.durationMs || detailedTrack.durationMs,
    availabilityReason: baseTrack.availabilityReason || detailedTrack.availabilityReason,
  };
}

async function enrichPlaylistTrack(track, clientId) {
  if (!track || !clientId) return track;

  if (track.hlsUrl && track.trackAuthorization) return track;

  const candidates = [];
  const numericTrackId = getTrackIdFromApiTrack(track);

  if (numericTrackId) {
    candidates.push(
      `https://api-v2.soundcloud.com/tracks/${encodeURIComponent(numericTrackId)}` +
        `?client_id=${encodeURIComponent(clientId)}`
    );
  }

  if (track.permalinkUrl) {
    candidates.push(
      `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(track.permalinkUrl)}` +
        `&client_id=${encodeURIComponent(clientId)}`
    );
  }

  for (const url of candidates) {
    try {
      const data = await fetchSoundCloudJson(url);
      const detailedTrack = normalizePlaylistTrack(data);
      const mergedTrack = mergeTrackMetadata(track, detailedTrack);

      if (mergedTrack.hlsUrl && mergedTrack.trackAuthorization) {
        return mergedTrack;
      }

      return mergedTrack;
    } catch (error) {
      console.warn(
        "[Media Downloader] Sets: track detail fetch failed:",
        error?.message || error
      );
    }
  }

  return track;
}

async function enrichPlaylistTracks(tracks, clientId) {
  const result = [];
  const concurrency = 3;
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < tracks.length) {
      const index = nextIndex;
      nextIndex += 1;
      result[index] = await enrichPlaylistTrack(tracks[index], clientId);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tracks.length) }, () => runWorker())
  );

  const hlsCount = result.filter((track) => track?.hlsUrl).length;
  const authCount = result.filter((track) => track?.trackAuthorization).length;

  console.log(
    `[Media Downloader] Sets: HLS URL ${hlsCount}/${result.length}, track_authorization ${authCount}/${result.length}`
  );

  return result;
}

// Получает полный список треков плейлиста через SoundCloud API.
// Запрос идёт со страницы (origin: soundcloud.com) — cookies и referer
// подхватываются автоматически. client_id извлекается из страницы.
// Возвращает массив { trackId, title, author } или null при ошибке.
function getNumericPlaylistId(value) {
  if (value === null || value === undefined) return "";

  const text = String(value);

  if (/^\d+$/.test(text)) {
    return text;
  }

  const match = text.match(/soundcloud:playlists:(\d+)/i);
  return match && match[1] ? match[1] : "";
}

function encodeSoundCloudRefForPath(value) {
  return encodeURIComponent(String(value)).replace(/%3A/gi, ":");
}

function getPlaylistApiRefs(playlistInfoOrId) {
  const playlistId =
    typeof playlistInfoOrId === "object"
      ? playlistInfoOrId?.playlistId
      : playlistInfoOrId;

  const playlistUrn =
    typeof playlistInfoOrId === "object"
      ? playlistInfoOrId?.playlistUrn
      : "";

  const numericPlaylistId = getNumericPlaylistId(playlistId || playlistUrn);

  const refs = [
    playlistUrn,
    numericPlaylistId ? `soundcloud:playlists:${numericPlaylistId}` : "",
    numericPlaylistId,
    playlistId
  ].filter(Boolean);

  return [...new Set(refs.map(String))];
}

function getPlaylistTrackCount(data) {
  return Number(data?.track_count || data?.trackCount || 0) || 0;
}

async function fetchPlaylistObject(playlistRef, clientId, representation) {
  const playlistUrl =
    `https://api-v2.soundcloud.com/playlists/${encodeSoundCloudRefForPath(playlistRef)}` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&representation=${encodeURIComponent(representation)}`;

  return fetchSoundCloudJson(playlistUrl);
}

async function fetchPlaylistObjectTracks(playlistRef, clientId, representation) {
  const data = await fetchPlaylistObject(playlistRef, clientId, representation);

  const tracks = Array.isArray(data?.tracks)
    ? data.tracks.map(normalizePlaylistTrack).filter(Boolean)
    : [];

  const trackCount = getPlaylistTrackCount(data);

  console.log(
    `[Media Downloader] Sets: /playlists ${playlistRef} representation=${representation} дал ${tracks.length} трек(ов), track_count=${trackCount || "?"}`
  );

  return {
    tracks,
    trackCount
  };
}

async function fetchPlaylistTracksEndpoint(playlistRef, clientId, representation = "compact") {
  const firstUrl =
    `https://api-v2.soundcloud.com/playlists/${encodeSoundCloudRefForPath(playlistRef)}/tracks` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&limit=200` +
    `&linked_partitioning=true` +
    `&representation=${encodeURIComponent(representation)}` +
    `&app_locale=en`;

  console.log(
    `[Media Downloader] Sets: пробую /playlists/${playlistRef}/tracks representation=${representation}`
  );

  const rawTrackItems = await fetchAllSoundCloudCollection(firstUrl, clientId);

  return dedupePlaylistTracks(
    rawTrackItems
      .map(normalizePlaylistTrackFromCollectionItem)
      .filter(Boolean)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSoundCloudTrackPermalinkUrl(url) {
  try {
    const parsedUrl = new URL(url, window.location.href);

    if (parsedUrl.hostname !== "soundcloud.com") {
      return false;
    }

    const parts = parsedUrl.pathname
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length !== 2) {
      return false;
    }

    const [userSlug, trackSlug] = parts;

    if (!userSlug || !trackSlug) {
      return false;
    }

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

    if (blockedFirstParts.has(userSlug)) {
      return false;
    }

    if (trackSlug === "sets" || trackSlug === "likes" || trackSlug === "reposts") {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function normalizeSoundCloudPermalinkUrl(url) {
  const parsedUrl = new URL(url, window.location.href);
  parsedUrl.hash = "";
  parsedUrl.search = "";

  return parsedUrl.href;
}

function collectDomPlaylistTrackPermalinks() {
  // ВАЖНО:
  // Не используем широкие селекторы вроде "article a[href]" или ".soundList__item a[href]".
  // Они цепляют related tracks, заголовок плейлиста и другие ссылки со страницы.
  const trackContainers = document.querySelectorAll(
    [
      ".trackList .trackItem",
      ".systemPlaylistTrackList .trackItem",
      ".playlist__tracks .trackItem",
      ".listenDetails__trackList .trackItem",
      ".soundList .trackItem"
    ].join(",")
  );

  const byUrl = new Map();

  trackContainers.forEach((container) => {
    const link =
      container.querySelector(".trackItem__trackTitle[href]") ||
      container.querySelector(".trackItem__trackTitle a[href]") ||
      container.querySelector(".soundTitle__title[href]") ||
      container.querySelector(".soundTitle__title a[href]");

    if (!link) {
      return;
    }

    const href = link.getAttribute("href") || "";
    const absoluteUrl = normalizeSoundCloudPermalinkUrl(href);

    if (!isSoundCloudTrackPermalinkUrl(absoluteUrl)) {
      return;
    }

    const title =
      extractTrackTitle(container, link) ||
      cleanSetsText(link.textContent || "");

    const author = extractTrackAuthor(container) || "";

    if (!title) {
      return;
    }

    if (!byUrl.has(absoluteUrl)) {
      byUrl.set(absoluteUrl, {
        trackId: "",
        trackUrn: "",
        title,
        author,
        permalinkUrl: absoluteUrl,
        hlsUrl: "",
        trackAuthorization: ""
      });
    }
  });

  return Array.from(byUrl.values());
}

async function collectAllDomPlaylistTracks(expectedTrackCount) {
  const startY = window.scrollY;
  const collected = new Map();
  let previousCount = 0;
  let stableRounds = 0;

  for (let round = 0; round < 35; round++) {
    for (const track of collectDomPlaylistTrackPermalinks()) {
      if (!track.permalinkUrl) continue;
      collected.set(track.permalinkUrl, track);
    }

    const currentCount = collected.size;

    if (expectedTrackCount && currentCount >= expectedTrackCount) {
      break;
    }

    if (currentCount === previousCount) {
      stableRounds += 1;
    } else {
      stableRounds = 0;
      previousCount = currentCount;
    }

    if (stableRounds >= 5 && currentCount > 0) {
      break;
    }

    window.scrollBy(0, Math.max(window.innerHeight * 0.9, 700));
    await sleep(650);
  }

  // Возвращаем пользователя ближе к началу, чтобы страница не оставалась внизу.
  window.scrollTo({ top: startY, behavior: "instant" });

  let tracks = Array.from(collected.values());

    if (expectedTrackCount && tracks.length > expectedTrackCount) {
      console.warn(
        `[Media Downloader] Sets: DOM-scroll собрал лишние ссылки ${tracks.length}/${expectedTrackCount}, обрезаю до ${expectedTrackCount}`
      );

    tracks = tracks.slice(0, expectedTrackCount);
  }

  console.log(
    `[Media Downloader] Sets: DOM-scroll собрал ${tracks.length}/${expectedTrackCount || "?"} permalink(ов)`
  );

  return tracks;
}

function isPlayableResolvedTrack(track) {
  return Boolean(
    track &&
      track.title &&
      (track.trackId || track.trackUrn || track.hlsUrl)
  );
}

async function resolveTrackFromPermalinkTrack(track, clientId) {
  if (!track?.permalinkUrl || !clientId) {
    return null;
  }

  try {
    const url =
      `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(track.permalinkUrl)}` +
      `&client_id=${encodeURIComponent(clientId)}`;

    const data = await fetchSoundCloudJson(url);

    // Если resolve вернул playlist/user/etc., а не track — выкидываем.
    if (data?.kind && data.kind !== "track") {
      console.warn(
        "[Media Downloader] Sets: DOM permalink не является track:",
        track.permalinkUrl,
        data.kind
      );

      return null;
    }

    const resolvedTrack = normalizePlaylistTrack(data);

    if (!isPlayableResolvedTrack(resolvedTrack)) {
      console.warn(
        "[Media Downloader] Sets: DOM permalink не дал playable track:",
        track.permalinkUrl
      );

      return null;
    }

    const mergedTrack = mergeTrackMetadata(track, resolvedTrack);

    return isPlayableResolvedTrack(mergedTrack) ? mergedTrack : null;
  } catch (error) {
    console.error(
      "[Media Downloader] Sets: resolve DOM permalink failed:",
      track.permalinkUrl,
      error?.message || error
    );

    return null;
  }
}

async function resolveDomPlaylistTracks(domTracks, clientId, expectedTrackCount = 0) {
  const result = [];
  const concurrency = 3;
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < domTracks.length) {
      const index = nextIndex;
      nextIndex += 1;

      result[index] = await resolveTrackFromPermalinkTrack(
        domTracks[index],
        clientId
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, domTracks.length) }, () =>
      runWorker()
    )
  );

  let tracks = dedupePlaylistTracks(
    result.filter(isPlayableResolvedTrack)
  );

  if (expectedTrackCount && tracks.length > expectedTrackCount) {
    console.warn(
      `[Media Downloader] Sets: DOM-resolve дал лишние треки ${tracks.length}/${expectedTrackCount}, обрезаю`
    );

    tracks = tracks.slice(0, expectedTrackCount);
  }

  return tracks;
}

async function fetchFullPlaylistTracks(playlistInfoOrId, options = {}) {
  const allowDomFallback = options.allowDomFallback !== false;
  const allowPartialApiFallback = options.allowPartialApiFallback !== false;

  try {
    const clientId = getClientId();
    if (!clientId) return null;

    const playlistRefs = getPlaylistApiRefs(playlistInfoOrId);

    console.log("[Media Downloader] Sets: playlist refs", playlistRefs);

    if (playlistRefs.length === 0) {
      return null;
    }

    let compactTracks = [];
    let endpointTracks = [];

    let expectedTrackCount =
      typeof playlistInfoOrId === "object"
        ? Number(playlistInfoOrId?.trackCount || 0)
        : 0;

    // 1. Берём playlist object ради track_count и возможного списка tracks.
    // Пробуем compact и full, потому что SoundCloud иногда отдаёт разные поля.
    for (const playlistRef of playlistRefs) {
      for (const representation of ["compact", "full"]) {
        try {
          const result = await fetchPlaylistObjectTracks(
            playlistRef,
            clientId,
            representation
          );

          if (result.tracks.length > compactTracks.length) {
            compactTracks = result.tracks;
          }

          if (result.trackCount > expectedTrackCount) {
            expectedTrackCount = result.trackCount;
          }

          if (
            expectedTrackCount > 0 &&
            compactTracks.length >= expectedTrackCount
          ) {
            return enrichPlaylistTracks(
              dedupePlaylistTracks(compactTracks),
              clientId
            );
          }
        } catch (error) {
          console.warn(
            `[Media Downloader] Sets: playlist object ${representation} failed for ${playlistRef}:`,
            error?.message || error
          );
        }
      }

      if (expectedTrackCount > 0) {
        break;
      }
    }

    // 2. Основной путь для полного списка: /playlists/{id}/tracks.
    // Для inline-плейлистов это должен быть единственный полный источник.
    for (const playlistRef of playlistRefs) {
      for (const representation of ["compact", "full"]) {
        try {
          const tracks = await fetchPlaylistTracksEndpoint(
            playlistRef,
            clientId,
            representation
          );

          console.log(
            `[Media Downloader] Sets: /playlists/${playlistRef}/tracks representation=${representation} дал ${tracks.length} трек(ов), expected=${expectedTrackCount || "?"}`
          );

          if (tracks.length > endpointTracks.length) {
            endpointTracks = tracks;
          }

          if (
            expectedTrackCount > 0 &&
            tracks.length >= expectedTrackCount
          ) {
            return enrichPlaylistTracks(tracks, clientId);
          }
        } catch (error) {
          console.error(
            `[Media Downloader] Sets: /playlists/${playlistRef}/tracks representation=${representation} failed:`,
            error?.message || error
          );
        }
      }
    }

    const bestApiTracks =
      endpointTracks.length > compactTracks.length
        ? endpointTracks
        : compactTracks;

    // 3. DOM-scroll fallback разрешён только на реальной странице /sets/.
    // На странице артиста он собирает чужие треки и двигает страницу.
    if (
      allowDomFallback &&
      isSoundCloudSetsPage() &&
      expectedTrackCount &&
      bestApiTracks.length < expectedTrackCount
    ) {
      const domTracks = await collectAllDomPlaylistTracks(expectedTrackCount);

      if (domTracks.length > bestApiTracks.length) {
        const resolvedDomTracks = await resolveDomPlaylistTracks(
          domTracks,
          clientId,
          expectedTrackCount
        );

        console.log(
          `[Media Downloader] Sets: DOM-resolve дал ${resolvedDomTracks.length}/${expectedTrackCount} трек(ов)`
        );

        if (resolvedDomTracks.length > bestApiTracks.length) {
          return enrichPlaylistTracks(resolvedDomTracks, clientId);
        }
      }
    }

    // 4. Если это inline playlist-card, неполный API-результат лучше считать ошибкой,
    // чем скачать неправильные/неполные треки.
    if (
      bestApiTracks.length > 0 &&
      !allowPartialApiFallback &&
      expectedTrackCount &&
      bestApiTracks.length < expectedTrackCount
    ) {
      throw new Error(
        `SoundCloud API вернул только ${bestApiTracks.length} из ${expectedTrackCount} треков`
      );
    }

    // 5. Последний fallback на лучший API-результат.
    if (bestApiTracks.length > 0) {
      console.warn(
        `[Media Downloader] Sets: беру лучший API fallback ${bestApiTracks.length}/${expectedTrackCount || "?"}`
      );

      return enrichPlaylistTracks(
        dedupePlaylistTracks(bestApiTracks),
        clientId
      );
    }

    return null;
  } catch (error) {
    console.warn(
      "[Media Downloader] Sets: API playlist fetch failed:",
      error?.message || error
    );

    throw error;
  }
}

// Извлекает SoundCloud client_id со страницы.
// Пробует несколько источников: inline-скрипты, hydration, performance entries.
// Возвращает строку client_id или null.
function extractClientIdFromPage() {
  try {
    // Способ 1: прямой паттерн в инлайн-скриптах.
    const scripts = document.querySelectorAll("script:not([src])");

    for (const script of scripts) {
      const text = script.textContent || "";

      // client_id: "..."  или  client_id:"..."
      const idMatch = text.match(/client_id["':\s]+["']([a-zA-Z0-9]{20,40})["']/);
      if (idMatch && idMatch[1]) return idMatch[1];
    }

    // Способ 2: JSON-форма в инлайн-скриптах.
    for (const script of scripts) {
      const text = script.textContent || "";
      const match = text.match(/"client_id"\s*:\s*"([a-zA-Z0-9]{20,40})"/);
      if (match && match[1]) return match[1];
    }

    // Способ 3: performance entries — SoundCloud при загрузке страницы делает
    // запросы к api-v2.soundcloud.com с client_id в query string. Это самый
    // надёжный способ: используем реальный client_id, которым SoundCloud
    // пользуется сам.
    const entries = performance.getEntriesByType("resource");

    for (const entry of entries) {
      const name = entry.name || "";
      if (!name.includes("soundcloud.com")) continue;

      const match = name.match(/client_id=([a-zA-Z0-9]{20,40})/);
      if (match && match[1]) return match[1];
    }

    // Способ 4: через скрапинг внешних JS-бандлов SoundCloud (async, тут sync-фолбэк).
    // Этот способ не сработает синхронно — оставляем как комментарий.
  } catch {
    // ignore
  }

  return null;
}

// Кэш client_id: извлекаем один раз, переиспользуем.
let cachedClientId = null;

function getClientId() {
  if (cachedClientId) return cachedClientId;

  cachedClientId = extractClientIdFromPage();

  if (cachedClientId) {
    console.log("[Media Downloader] Sets: client_id извлечён");
  } else {
    console.warn("[Media Downloader] Sets: client_id НЕ найден");
  }

  return cachedClientId;
}

// Очищает текст от типового мусора SoundCloud (play-кнопки, whitespace).
function cleanSetsText(text) {
  if (!text) return "";

  return text
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAuthorName(text) {
  if (!text) return "";

  return cleanSetsText(text)
    .replace(/\bVerified\b/gi, "")
    .replace(/\bOfficial\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[·•\-–—\s]+|[·•\-–—\s]+$/g, "")
    .trim();
}

// Пытается достать заголовок трека из карточки.
function extractTrackTitle(cardElement, trackLink) {
  // Сначала явные селекторы SoundCloud внутри карточки.
  const titleEl =
    cardElement.querySelector(".trackItem__trackTitle") ||
    cardElement.querySelector(".soundTitle__title span") ||
    cardElement.querySelector(".soundTitle__title");

  if (titleEl && titleEl.textContent) {
    const text = cleanSetsText(titleEl.textContent);

    if (text) return text;
  }

  // Фолбэк: текст самой ссылки (часто содержит название трека).
  if (trackLink && trackLink.textContent) {
    const text = cleanSetsText(trackLink.textContent);

    if (text && text.length >= 2) return text;
  }

  return null;
}

// Пытается достать автора трека из карточки.
function extractTrackAuthor(cardElement) {
  const authorEl =
    cardElement.querySelector(".soundTitle__username") ||
    cardElement.querySelector(".soundTitle__usernameText") ||
    cardElement.querySelector(".trackItem__username");

  if (authorEl && authorEl.textContent) {
    const text = cleanAuthorName(authorEl.textContent);

    if (text) return text;
  }

  // Фолбэк: ссылка на пользователя в карточке.
  const userLink = cardElement.querySelector("a[href*='/user-']");

  if (userLink && userLink.textContent) {
    const text = cleanSetsText(userLink.textContent);

    if (text) return text;
  }

  return null;
}

// Находит подходящую карточку-контейнер для ссылки на трек.
// Идём вверх по предкам, пока не встретим типичный SoundCloud-контейнер трека.
function findTrackContainer(linkElement) {
  return linkElement.closest(
    ".soundList__item, .trackItem, .sound__body, article, li"
  );
}

// Собирает уникальные треки со страницы /sets/.
// Приоритет:
//   1. SoundCloud API /playlists/{id} (полный список, требует client_id)
//   2. Hydration data (может быть обрезана до первых N треков)
//   3. DOM-ссылки /tracks/NNN (фолбэк)
// Возвращает массив { trackId, title, author }.
async function collectVisiblePlaylistTracks() {
  // 1. Hydration data — извлекаем playlistId и tracks.
  // На SPA-переходах hydration может быть пустым/старым, поэтому ниже есть DOM permalink fallback.
  const playlistInfo = extractPlaylistFromHydration();

  const expectedTrackCount = Number(
    playlistInfo?.trackCount ||
      getCurrentDomPlaylistTrackCount() ||
      0
  ) || 0;

  // 2. Пробуем получить полный список через API, если есть актуальный playlistId.
  if (playlistInfo && playlistInfo.playlistId) {
    const apiTracks = await fetchFullPlaylistTracks(playlistInfo);

    if (apiTracks && apiTracks.length > 0) {
      const playableApiTracks = apiTracks.filter(isPlayableResolvedTrack);

      if (playableApiTracks.length !== apiTracks.length) {
        console.warn(
          `[Media Downloader] Sets: отфильтровано непригодных треков ${apiTracks.length - playableApiTracks.length}/${apiTracks.length}`
        );
      }

      console.log(
        `[Media Downloader] Sets: API дал ${playableApiTracks.length} трек(ов)`
      );

      return playableApiTracks;
    }
  }

  // 3. Hydration tracks, если они есть.
  if (playlistInfo && playlistInfo.tracks.length > 0) {
    console.log(
      `[Media Downloader] Sets: hydration дал ${playlistInfo.tracks.length} трек(ов)`
    );

    return playlistInfo.tracks;
  }

  // 4. Новый основной fallback для SPA:
  // собираем реальные permalink-ссылки треков вида /artist/track-slug,
  // потом resolve'им их через api-v2.soundcloud.com/resolve.
  const clientId = getClientId();
  const domTracks = await collectAllDomPlaylistTracks(expectedTrackCount);

  if (domTracks.length > 0) {
    console.log(
      `[Media Downloader] Sets: DOM permalink fallback дал ${domTracks.length}/${expectedTrackCount || "?"} ссылок`
    );

    if (!clientId) {
      console.warn(
        "[Media Downloader] Sets: client_id не найден, DOM permalink resolve невозможен"
      );

      return domTracks;
    }

    const resolvedDomTracks = await resolveDomPlaylistTracks(
      domTracks,
      clientId,
      expectedTrackCount
    );

    console.log(
      `[Media Downloader] Sets: DOM permalink resolve дал ${resolvedDomTracks.length}/${expectedTrackCount || "?"} трек(ов)`
    );

    if (resolvedDomTracks.length > 0) {
      return enrichPlaylistTracks(resolvedDomTracks, clientId);
    }
  }

  // 5. Старый fallback оставляем только как последний шанс:
  // он работает только для ссылок /tracks/123.
  const trackLinks = document.querySelectorAll("a[href*='/tracks/']");
  const seen = new Set();
  const tracks = [];

  trackLinks.forEach((link) => {
    const href = link.getAttribute("href") || "";
    const trackId = getTrackIdFromHref(href);

    if (!trackId || seen.has(trackId)) return;

    const rect = link.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const container = findTrackContainer(link);
    const title = extractTrackTitle(container || link, link);
    const author = extractTrackAuthor(container || link);

    if (!title) return;

    seen.add(trackId);

    tracks.push({
      trackId,
      trackUrn: `soundcloud:tracks:${trackId}`,
      title,
      author: author || "",
      permalinkUrl: "",
      hlsUrl: "",
      trackAuthorization: ""
    });
  });

  console.log(
    `[Media Downloader] Sets: legacy DOM /tracks fallback дал ${tracks.length} трек(ов)`
  );

  return tracks;
}

// Извлекает название плейлиста из шапки SoundCloud sets-страницы.
function extractPlaylistTitle() {
  const headerEl =
    document.querySelector("h1.soundTitle__title") ||
    document.querySelector("h1") ||
    document.querySelector("[data-media-title]");

  if (headerEl && headerEl.textContent) {
    const text = cleanSetsText(headerEl.textContent);

    if (text) return text;
  }

  // Фолбэк: последний сегмент pathname.
  const segments = window.location.pathname.split("/").filter(Boolean);

  return segments[segments.length - 1] || "playlist";
}

function extractPlaylistAuthor() {
  const authorEl =
    document.querySelector(".soundTitle__username") ||
    document.querySelector(".soundTitle__usernameText") ||
    document.querySelector(".userBadge__username") ||
    document.querySelector("a.soundTitle__username") ||
    document.querySelector("a[href^='/'][href]:not([href*='/sets/'])");

  if (authorEl && authorEl.textContent) {
    const text = cleanAuthorName(authorEl.textContent);

    if (text) return text;
  }

  // Fallback: первый сегмент URL SoundCloud обычно является artist/user slug.
  const segments = window.location.pathname.split("/").filter(Boolean);

  return segments[0] || "";
}

function setChromeStorageLocal(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve();
    });
  });
}

function openPlaylistDownloaderUrl(url) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      {
        type: "OPEN_PLAYLIST_DOWNLOADER",
        url
      },
      (response) => {
        const runtimeError = chrome.runtime.lastError;

        if (runtimeError || !response || !response.ok) {
          console.warn(
            "[Media Downloader] Sets: background не открыл загрузчик:",
            runtimeError?.message || response?.error || "unknown error"
          );

          const openedWindow = window.open(url, "_blank", "noopener");

          if (openedWindow) {
            resolve({ ok: true, fallback: "window.open" });
            return;
          }

          // Если popup заблокирован — открываем загрузчик в текущей вкладке.
          window.location.href = url;
          resolve({ ok: true, fallback: "current-tab" });
          return;
        }

        resolve({ ok: true, fallback: null });
      }
    );
  });
}

function isSoundCloudPlaylistPermalinkUrl(url) {
  try {
    const parsedUrl = new URL(url, window.location.href);

    if (!parsedUrl.hostname.toLowerCase().includes("soundcloud.com")) {
      return false;
    }

    const parts = parsedUrl.pathname
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);

    return parts.length >= 3 && parts[1] === "sets" && Boolean(parts[2]);
  } catch {
    return false;
  }
}

function normalizeSoundCloudPlaylistPermalinkUrl(url) {
  const parsedUrl = new URL(url, window.location.href);
  parsedUrl.hash = "";
  parsedUrl.search = "";

  return parsedUrl.href;
}

function getInlinePlaylistLinkFromCard(cardElement) {
  if (!cardElement || !(cardElement instanceof Element)) {
    return null;
  }

  const selectors = [
    ".soundTitle__title[href*='/sets/']",
    ".soundTitle__title a[href*='/sets/']",
    "a[itemprop='url'][href*='/sets/']",
    "a[href*='/sets/']"
  ];

  for (const selector of selectors) {
    const links = cardElement.querySelectorAll(selector);

    for (const link of links) {
      const href = link.getAttribute("href") || "";

      if (isSoundCloudPlaylistPermalinkUrl(href)) {
        return link;
      }
    }
  }

  return null;
}

function getInlinePlaylistTitle(cardElement, playlistLink) {
  const title =
    cleanSetsText(playlistLink?.textContent || "") ||
    cleanSetsText(
      cardElement.querySelector(".soundTitle__title")?.textContent || ""
    );

  return title || "playlist";
}

function getInlinePlaylistAuthor(cardElement) {
  return (
    cleanAuthorName(cardElement.querySelector(".soundTitle__username")?.textContent || "") ||
    cleanAuthorName(cardElement.querySelector(".soundTitle__usernameText")?.textContent || "") ||
    cleanAuthorName(cardElement.querySelector(".userBadge__username")?.textContent || "") ||
    ""
  );
}

function getInlinePlaylistDomTrackCount(cardElement) {
  if (!cardElement || !(cardElement instanceof Element)) {
    return 0;
  }

  const rowSelectors = [
    ".trackList .trackItem",
    ".systemPlaylistTrackList .trackItem",
    ".systemPlaylistTrackList__item",
    ".playlist__tracks .trackItem",
    ".listenDetails__trackList .trackItem"
  ];

  for (const selector of rowSelectors) {
    const count = cardElement.querySelectorAll(selector).length;

    if (count > 0) {
      return count;
    }
  }

  const text = cleanSetsText(cardElement.textContent || "");
  const match =
    text.match(/\b(\d+)\s+tracks?\b/i) ||
    text.match(/\b(\d+)\s+трек/i);

  return match && match[1] ? Number(match[1]) || 0 : 0;
}

function getInlinePlaylistActionsContainer(cardElement) {
  if (!cardElement || !(cardElement instanceof Element)) {
    return null;
  }

  const selectors = [
    ".soundActions .sc-button-group",
    ".soundActions",
    ".sound__soundActions .sc-button-group",
    ".sound__soundActions",
    ".soundFooter .sc-button-group",
    ".soundFooter",
    ".listenEngagement__actions",
    ".listenEngagement"
  ];

  for (const selector of selectors) {
    const element = cardElement.querySelector(selector);

    if (!element) continue;

    const rect = element.getBoundingClientRect();

    if (rect.width > 20 && rect.height > 20) {
      return element;
    }
  }

  return null;
}

function getInlinePlaylistButtonText(trackCount) {
  return trackCount > 0
    ? `Скачать плейлист (${trackCount})`
    : "Скачать плейлист";
}

async function resolveInlinePlaylistInfo(permalinkUrl, fallbackInfo = {}) {
  if (embeddedPlaylistInfoCache.has(permalinkUrl)) {
    return embeddedPlaylistInfoCache.get(permalinkUrl);
  }

  const clientId = getClientId();

  if (!clientId) {
    throw new Error("client_id не найден");
  }

  const data = await fetchSoundCloudJson(
    `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(permalinkUrl)}` +
      `&client_id=${encodeURIComponent(clientId)}`
  );

  if (data?.kind && data.kind !== "playlist") {
    throw new Error(`SoundCloud resolve вернул не playlist: ${data.kind}`);
  }

  const tracks = Array.isArray(data?.tracks)
    ? data.tracks.map(normalizePlaylistTrack).filter(Boolean)
    : [];

  const playlistInfo = {
    playlistId: String(data?.id || data?.urn || fallbackInfo.playlistId || ""),
    playlistUrn: data?.urn ? String(data.urn) : "",
    trackCount:
      Number(data?.track_count || data?.trackCount || fallbackInfo.trackCount || tracks.length) ||
      tracks.length,
    permalinkUrl: String(data?.permalink_url || data?.permalinkUrl || permalinkUrl),
    playlistTitle: cleanSetsText(data?.title || fallbackInfo.playlistTitle || "playlist"),
    playlistAuthor: cleanAuthorName(data?.user?.username || fallbackInfo.playlistAuthor || ""),
    tracks
  };

  embeddedPlaylistInfoCache.set(permalinkUrl, playlistInfo);

  return playlistInfo;
}

async function openInlinePlaylistDownloader(playlistInfo) {
  const clientId = getClientId();

  if (!clientId) {
    throw new Error("client_id не найден");
  }

  // Для embedded playlist всегда сначала resolve'им конкретную /sets/... ссылку.
  // Так мы получаем настоящий playlist id/urn, а не текущую страницу артиста.
  const resolvedInfo = await resolveInlinePlaylistInfo(
    playlistInfo.permalinkUrl,
    playlistInfo
  );

  const tracks = await fetchFullPlaylistTracks(resolvedInfo, {
    // ВАЖНО:
    // Inline playlist находится на странице артиста/search/all.
    // Там нельзя использовать DOM-scroll fallback — он соберёт треки страницы,
    // а не треки конкретного плейлиста.
    allowDomFallback: false,

    // Для embedded плейлиста лучше показать ошибку, чем скачать 10/16 чужих
    // или неполных треков.
    allowPartialApiFallback: false
  });

  if (!tracks || tracks.length === 0) {
    throw new Error("Треки плейлиста не найдены через SoundCloud API");
  }

  const expectedTrackCount = Number(resolvedInfo.trackCount || playlistInfo.trackCount || 0) || 0;

  if (expectedTrackCount && tracks.length < expectedTrackCount) {
    throw new Error(
      `Найдено только ${tracks.length} из ${expectedTrackCount} треков плейлиста`
    );
  }

  const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const storageKey = `playlistBatch:${batchId}`;
  const playlistIndexWidth = Math.max(2, String(tracks.length).length);

  const batchTracks = tracks.map((track, index) => ({
    playlistIndex: index + 1,
    playlistIndexWidth,
    trackId: track.trackId || "",
    trackUrn: track.trackUrn || "",
    title: track.title || "",
    author: track.author || "",
    permalinkUrl: track.permalinkUrl || "",
    durationMs: track.durationMs || 0,
    availabilityReason: track.availabilityReason || ""
  }));

  await setChromeStorageLocal({
    [storageKey]: {
      tracks: batchTracks,
      playlistTitle:
        resolvedInfo.playlistTitle ||
        playlistInfo.playlistTitle ||
        "playlist",
      playlistAuthor:
        resolvedInfo.playlistAuthor ||
        playlistInfo.playlistAuthor ||
        "",
      clientId,
      createdAt: Date.now()
    }
  });

  const downloaderUrl = chrome.runtime.getURL(
    `playlist-downloader/playlist-downloader.html?batchId=${encodeURIComponent(batchId)}`
  );

  await openPlaylistDownloaderUrl(downloaderUrl);

  return tracks.length;
}

function warmUpInlinePlaylistInfo(permalinkUrl, fallbackInfo, button) {
  if (!permalinkUrl || embeddedPlaylistInfoCache.has(permalinkUrl)) {
    const cached = embeddedPlaylistInfoCache.get(permalinkUrl);

    if (cached && button) {
      button.textContent = getInlinePlaylistButtonText(cached.trackCount);
    }

    return;
  }

  if (embeddedPlaylistResolveInFlight.has(permalinkUrl)) {
    return;
  }

  embeddedPlaylistResolveInFlight.add(permalinkUrl);

  resolveInlinePlaylistInfo(permalinkUrl, fallbackInfo)
    .then((playlistInfo) => {
      if (!button || !document.documentElement.contains(button)) return;

      button.textContent = getInlinePlaylistButtonText(playlistInfo.trackCount);
    })
    .catch((error) => {
      console.warn(
        "[Media Downloader] Sets: inline playlist resolve failed:",
        error?.message || error
      );
    })
    .finally(() => {
      embeddedPlaylistResolveInFlight.delete(permalinkUrl);
    });
}

function upsertInlinePlaylistButton(cardElement, playlistInfo) {
  const actionsContainer = getInlinePlaylistActionsContainer(cardElement);

  if (!actionsContainer) {
    scheduleInlineSoundCloudPlaylistScan(1200);
    return;
  }

  let button = cardElement.querySelector(`.${SETS_INLINE_BUTTON_CLASS}`);

  if (
    button &&
    button.getAttribute(SETS_INLINE_URL_ATTRIBUTE) !== playlistInfo.permalinkUrl
  ) {
    button.remove();
    button = null;
  }

  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = SETS_INLINE_BUTTON_CLASS;
    button.setAttribute(SETS_INLINE_URL_ATTRIBUTE, playlistInfo.permalinkUrl);
    button.title = "Скачать все треки этого плейлиста в MP3 и упаковать в ZIP";

    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      button.disabled = true;
      button.textContent = "Собираю плейлист...";

      try {
        const count = await openInlinePlaylistDownloader(playlistInfo);

        button.textContent = `Открыт загрузчик (${count})`;
      } catch (error) {
        console.warn(
          "[Media Downloader] Sets: inline playlist download failed:",
          error?.message || error
        );

        button.textContent = "Ошибка плейлиста";

        setTimeout(() => {
          button.disabled = false;
          button.textContent = getInlinePlaylistButtonText(playlistInfo.trackCount);
        }, 1800);

        return;
      }

      setTimeout(() => {
        button.disabled = false;
        button.textContent = getInlinePlaylistButtonText(playlistInfo.trackCount);
      }, 1800);
    });

    actionsContainer.appendChild(button);
  }

  const nextText = getInlinePlaylistButtonText(playlistInfo.trackCount);

  if (button.textContent !== nextText) {
    button.textContent = nextText;
  }

  // ВАЖНО:
  // Не делаем warmUpInlinePlaylistInfo() автоматически.
  // Иначе на странице артиста можно запустить десятки SoundCloud API resolve
  // прямо во время рендера, из-за чего сайт начинает лагать.
  // Полный resolve делаем только по клику.
}

function isInlinePlaylistCardNearViewport(cardElement) {
  if (!cardElement || !(cardElement instanceof Element)) {
    return false;
  }

  const rect = cardElement.getBoundingClientRect();

  return (
    rect.width > 120 &&
    rect.height > 40 &&
    rect.bottom >= -800 &&
    rect.top <= window.innerHeight + 2200
  );
}

function scheduleInlineSoundCloudPlaylistScan(delay = SETS_INLINE_SCAN_DEBOUNCE_MS) {
  if (!window.location.hostname.toLowerCase().includes("soundcloud.com")) {
    return;
  }

  const sinceLastScan = Date.now() - setsInlineLastScanAt;
  const effectiveDelay = sinceLastScan > 2500
    ? Math.min(delay, 250)
    : delay;

  clearTimeout(setsInlineScanTimer);

  setsInlineScanTimer = setTimeout(() => {
    try {
      scanInlineSoundCloudPlaylistCards();
    } catch (error) {
      console.warn(
        "[Media Downloader] Sets: inline playlist scan failed:",
        error?.message || error
      );
    }
  }, effectiveDelay);
}

function scanInlineSoundCloudPlaylistCards() {
  if (!window.location.hostname.toLowerCase().includes("soundcloud.com")) {
    return;
  }

  setsInlineLastScanAt = Date.now();

  const cards = Array.from(
    document.querySelectorAll(
      [
        ".sound",
        ".soundList__item",
        ".searchList__item"
      ].join(",")
    )
  )
    .filter(isInlinePlaylistCardNearViewport)
    .slice(0, SETS_INLINE_MAX_CARDS_PER_SCAN);

  cards.forEach((cardElement) => {
    const existingButton = cardElement.querySelector(`.${SETS_INLINE_BUTTON_CLASS}`);

    // Уже обработанная карточка не должна заново трогать DOM на каждый mutation.
    if (existingButton && existingButton.getAttribute(SETS_INLINE_URL_ATTRIBUTE)) {
      return;
    }

    const playlistLink = getInlinePlaylistLinkFromCard(cardElement);

    if (!playlistLink) {
      return;
    }

    const permalinkUrl = normalizeSoundCloudPlaylistPermalinkUrl(
      playlistLink.getAttribute("href") || ""
    );

    if (!isSoundCloudPlaylistPermalinkUrl(permalinkUrl)) {
      return;
    }

    if (
      isSoundCloudSetsPage() &&
      getSoundCloudComparablePath(permalinkUrl) === getCurrentSetsPageKey()
    ) {
      return;
    }

    cardElement.setAttribute(SETS_INLINE_CARD_ATTRIBUTE, "true");
    cardElement.setAttribute(SETS_INLINE_URL_ATTRIBUTE, permalinkUrl);

    cardElement
      .querySelectorAll(`.${MEDIA_DOWNLOADER_ICON_CLASS}.media-downloader-track-button`)
      .forEach((element) => element.remove());

    const domCount = getInlinePlaylistDomTrackCount(cardElement);

    const playlistInfo = {
      playlistId: "",
      playlistUrn: "",
      trackCount: domCount,
      permalinkUrl,
      playlistTitle: getInlinePlaylistTitle(cardElement, playlistLink),
      playlistAuthor: getInlinePlaylistAuthor(cardElement),
      tracks: []
    };

    upsertInlinePlaylistButton(cardElement, playlistInfo);
  });
}

function createSetsButton(trackCount) {
  const pageKey = getCurrentSetsPageKey();
  const button = document.getElementById(SETS_BUTTON_ID);

  if (button) {
    if (button.dataset.setsPageKey !== pageKey) {
      setsButtonBusy = false;
      button.disabled = false;
    }

    button.dataset.setsPageKey = pageKey;

    if (!setsButtonBusy) {
      button.disabled = false;
      button.textContent = `Скачать плейлист (${trackCount})`;
    }

    return button;
  }

  const newButton = document.createElement("button");
  newButton.id = SETS_BUTTON_ID;
  newButton.className = SETS_BUTTON_CLASS;
  newButton.type = "button";
  newButton.dataset.setsPageKey = pageKey;
  newButton.textContent = `Скачать плейлист (${trackCount})`;
  newButton.title = "Скачать все треки плейлиста в MP3 и упаковать в ZIP";

  newButton.addEventListener("click", async () => {
    setsButtonBusy = true;
    newButton.disabled = true;
    newButton.textContent = "Собираю треки...";

    try {
      const tracks = await collectVisiblePlaylistTracks();
      const playlistTitle = extractPlaylistTitle();
      const playlistAuthor = extractPlaylistAuthor();
      const clientId = getClientId();

      if (!clientId) {
        setsButtonBusy = false;
        newButton.disabled = false;
        newButton.textContent = "client_id не найден";
        setTimeout(() => {
          newButton.textContent = `Скачать плейлист (${tracks.length || 0})`;
        }, 2500);
        return;
      }

      if (tracks.length === 0) {
        setsButtonBusy = false;
        newButton.textContent = "Треки не найдены";
        setTimeout(() => {
          newButton.disabled = false;
          newButton.textContent = "Скачать плейлист";
        }, 2000);
        return;
      }

      newButton.textContent = `Открываю загрузчик (${tracks.length})...`;

      const batchId = `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const storageKey = `playlistBatch:${batchId}`;
      const playlistIndexWidth = Math.max(2, String(tracks.length).length);

      const batchTracks = tracks.map((track, index) => ({
        // Фиксируем исходный порядок плейлиста в самом батче.
        // Downloader использует этот номер в имени файла: 01. Artist - Track.mp3.
        playlistIndex: index + 1,
        playlistIndexWidth,
        trackId: track.trackId || "",
        trackUrn: track.trackUrn || "",
        title: track.title || "",
        author: track.author || "",
        permalinkUrl: track.permalinkUrl || "",
        durationMs: track.durationMs || 0,
        availabilityReason: track.availabilityReason || ""
      }));

      await setChromeStorageLocal({
        [storageKey]: {
          tracks: batchTracks,
          playlistTitle,
          playlistAuthor,
          clientId,
          createdAt: Date.now()
        }
      });

      console.log("[Media Downloader] Sets: batch сохранён в storage fresh-only", {
        batchId,
        tracks: batchTracks.length
      });

      const downloaderUrl = chrome.runtime.getURL(
        `playlist-downloader/playlist-downloader.html?batchId=${encodeURIComponent(batchId)}`
      );

      await openPlaylistDownloaderUrl(downloaderUrl);

      setsButtonBusy = false;
      newButton.disabled = false;
      newButton.textContent = "Загрузчик открыт ✓";
    } catch (error) {
      setsButtonBusy = false;
      newButton.disabled = false;
      newButton.textContent = "Ошибка сбора треков";
      setTimeout(() => {
        newButton.textContent = "Скачать плейлист";
      }, 2000);
    }
  });

  document.body.appendChild(newButton);
  return newButton;
}

function removeSetsButton() {
  const button = document.getElementById(SETS_BUTTON_ID);

  setsButtonBusy = false;

  if (button) {
    button.remove();
  }
}

function getCurrentDomPlaylistTrackCount() {
  try {
    const permalinkCount = collectDomPlaylistTrackPermalinks().length;

    if (permalinkCount > 0) {
      return permalinkCount;
    }

    return document.querySelectorAll("a[href*='/tracks/']").length;
  } catch {
    return 0;
  }
}

// Сканирует DOM, обновляет/создаёт/скрывает кнопку.
// Для счётчика используем только синхронные источники (hydration/DOM).
// Полный список через API достаётся при клике — это медленный запрос.
function refreshSetsButton() {
  if (!isSoundCloudSetsPage()) {
    removeSetsButton();
    return;
  }

  // Быстрый синхронный подсчёт для отображения на кнопке.
  // priority: актуальный hydration > DOM trackItem/permalink count.
  const playlistInfo = extractPlaylistFromHydration();
  const hydrationCount = playlistInfo
    ? Number(playlistInfo.trackCount || playlistInfo.tracks.length || 0)
    : 0;

  if (hydrationCount > 0) {
    createSetsButton(hydrationCount);
    return;
  }

  // Сразу после SPA-перехода DOM ещё может содержать треки прошлого плейлиста.
  // Ненадолго убираем кнопку, чтобы не показывать старое количество.
  if (setsLastNavigationAt && Date.now() - setsLastNavigationAt < SETS_DOM_COUNT_GRACE_AFTER_NAV_MS) {
    removeSetsButton();
    return;
  }

  const domCount = getCurrentDomPlaylistTrackCount();

  if (domCount > 0) {
    createSetsButton(domCount);
    return;
  }

  removeSetsButton();
}

function runSetsScanSafely() {
  try {
    refreshSetsButton();
  } catch (error) {
    console.warn("[Media Downloader] Sets: scan failed:", error);
  } finally {
    setsLastScanRunAt = Date.now();
  }
}

// Bounded debounce: SoundCloud/Ember может мутировать DOM непрерывно.
// Обычный clearTimeout+setTimeout способен откладывать кнопку бесконечно,
// поэтому раз в SETS_MAX_SCAN_WAIT_MS принудительно запускаем scan.
function scheduleSetsScan(delay = 400) {
  const sinceLastScan = Date.now() - setsLastScanRunAt;
  const effectiveDelay = sinceLastScan >= SETS_MAX_SCAN_WAIT_MS
    ? Math.min(delay, 50)
    : delay;

  clearTimeout(setsScanTimer);
  setsScanTimer = setTimeout(runSetsScanSafely, effectiveDelay);
}

// Слежение за SPA-навигацией: кнопка должна жить только на /sets/.
function scheduleSetsRescansAfterNavigation() {
  const token = ++setsNavigationScanToken;

  SETS_RESCAN_AFTER_NAV_DELAYS_MS.forEach((delay) => {
    setTimeout(() => {
      if (token !== setsNavigationScanToken) return;
      runSetsScanSafely();
    }, delay);
  });
}

// Слежение за SPA-навигацией: кнопка должна жить только на актуальной /sets/ странице.
function handleSetsSpaNavigation() {
  if (setsLastLocation === window.location.href) return;

  setsLastLocation = window.location.href;
  setsLastNavigationAt = Date.now();

  // Не даём старой кнопке пережить переход на другой плейлист.
  removeSetsButton();
  scheduleSetsRescansAfterNavigation();
}

function installSetsSpaNavigationHooks() {
  if (window.__mediaDownloaderSetsNavigationHooksInstalled) return;
  window.__mediaDownloaderSetsNavigationHooksInstalled = true;

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  function emitLocationChange() {
    window.dispatchEvent(new Event("mediaDownloaderSetsLocationChange"));
  }

  history.pushState = function patchedPushState(...args) {
    const result = originalPushState.apply(this, args);
    setTimeout(emitLocationChange, 0);
    return result;
  };

  history.replaceState = function patchedReplaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    setTimeout(emitLocationChange, 0);
    return result;
  };

  window.addEventListener("popstate", () => {
    setTimeout(emitLocationChange, 0);
  });

  window.addEventListener("hashchange", () => {
    setTimeout(emitLocationChange, 0);
  });

  window.addEventListener("mediaDownloaderSetsLocationChange", () => {
    handleSetsSpaNavigation();
  });
}

// Стартовая инициализация + наблюдатели.
function initSoundCloudSetsButton() {
  injectSetsStyles();
  installSetsSpaNavigationHooks();
  runSetsScanSafely();
  scheduleInlineSoundCloudPlaylistScan(1000);

  // MutationObserver — реагируем на ре-рендер карточек Ember'ом.
  const observer = new MutationObserver(() => {
    handleSetsSpaNavigation();
    scheduleSetsScan(400);
    scheduleInlineSoundCloudPlaylistScan(1000);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // Periodic fallback — на случай если MutationObserver пропустил.
  // Каждые 3с перепроверяем, не изменился ли URL и не появились ли треки.
  setInterval(() => {
    handleSetsSpaNavigation();
    scheduleSetsScan(800);
    scheduleInlineSoundCloudPlaylistScan(1200);
  }, 3000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSoundCloudSetsButton);
} else {
  initSoundCloudSetsButton();
}
