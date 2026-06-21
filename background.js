const streamsByTabId = {};
const activeCapturesByTabId = {};
const capturedStreamsByTabId = {};
const diagnosticsByTabId = {};
const diagnosticSignaturesByTabId = {};
const scanSummariesByTabId = {};
const soundCloudFragmentGroupsByTabId = {};
const soundCloudFallbackPlaylistsById = {};

const MAX_STREAMS_PER_TAB = 50;
const MAX_DIAGNOSTICS_PER_TAB = 30;

const AUDIO_STREAM_EXTENSIONS = [
  "mp3",
  "m4a",
  "aac",
  "ogg",
  "opus",
  "wav",
  "flac"
];

const VIDEO_STREAM_EXTENSIONS = [
  "mp4",
  "webm",
  "m4v",
  "mov"
];

const MANIFEST_STREAM_EXTENSIONS = [
  "m3u8",
  "mpd"
];

const STREAM_EXTENSIONS = [
  ...MANIFEST_STREAM_EXTENSIONS,
  ...AUDIO_STREAM_EXTENSIONS,
  ...VIDEO_STREAM_EXTENSIONS
];

const MEDIA_MIME_RULES = [
  {
    includes: ["application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl", "audio/x-mpegurl"],
    type: "hls",
    extension: "m3u8"
  },
  {
    includes: ["application/dash+xml"],
    type: "dash",
    extension: "mpd"
  },
  {
    includes: ["audio/mpeg", "audio/mp3"],
    type: "audio",
    extension: "mp3"
  },
  {
    includes: ["audio/mp4", "audio/x-m4a"],
    type: "audio",
    extension: "m4a"
  },
  {
    includes: ["audio/aac"],
    type: "audio",
    extension: "aac"
  },
  {
    includes: ["audio/ogg", "application/ogg"],
    type: "audio",
    extension: "ogg"
  },
  {
    includes: ["audio/opus"],
    type: "audio",
    extension: "opus"
  },
  {
    includes: ["audio/wav", "audio/x-wav", "audio/wave"],
    type: "audio",
    extension: "wav"
  },
  {
    includes: ["audio/flac"],
    type: "audio",
    extension: "flac"
  },
  {
    includes: ["video/mp4"],
    type: "video",
    extension: "mp4"
  },
  {
    includes: ["video/webm"],
    type: "video",
    extension: "webm"
  }
];

function getExtensionFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const href = parsedUrl.href.toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();

    for (const extension of STREAM_EXTENSIONS) {
      if (pathname.endsWith(`.${extension}`)) return extension;
      if (href.includes(`.${extension}?`)) return extension;
      if (href.includes(`.${extension}&`)) return extension;
      if (href.includes(`.${extension}#`)) return extension;
      if (href.includes(`%2e${extension}`)) return extension;
    }

    return null;
  } catch {
    return null;
  }
}

function getStreamInfoFromExtension(extension) {
  if (!extension) return null;

  if (extension === "m3u8") {
    return {
      type: "hls",
      extension: "m3u8"
    };
  }

  if (extension === "mpd") {
    return {
      type: "dash",
      extension: "mpd"
    };
  }

  if (AUDIO_STREAM_EXTENSIONS.includes(extension)) {
    return {
      type: "audio",
      extension
    };
  }

  if (VIDEO_STREAM_EXTENSIONS.includes(extension)) {
    return {
      type: "video",
      extension
    };
  }

  return null;
}

function getStreamInfoFromContentType(contentType) {
  if (!contentType) return null;

  const cleanContentType = contentType.toLowerCase().split(";")[0].trim();

  for (const rule of MEDIA_MIME_RULES) {
    if (rule.includes.some((mime) => cleanContentType.includes(mime))) {
      return {
        type: rule.type,
        extension: rule.extension,
        contentType: cleanContentType
      };
    }
  }

  return null;
}

function getNumberHeaderValue(responseHeaders, headerName) {
  const value = getHeaderValue(responseHeaders, headerName);
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : null;
}

function mergePlusSeparatedValues(currentValue, nextValue) {
  const values = new Set();

  String(currentValue || "")
    .split("+")
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => values.add(value));

  String(nextValue || "")
    .split("+")
    .map((value) => value.trim())
    .filter(Boolean)
    .forEach((value) => values.add(value));

  return Array.from(values).join("+");
}

function getQualityLabelFromUrl(url) {
  if (!url) return null;

  try {
    const parsedUrl = new URL(url);
    const decodedUrl = decodeURIComponent(parsedUrl.href).toLowerCase();

    const resolutionMatch = decodedUrl.match(/(?:^|[^\d])([1-9]\d{2,3})x([1-9]\d{2,3})(?:[^\d]|$)/);
    if (resolutionMatch) {
      return `${resolutionMatch[1]}×${resolutionMatch[2]}`;
    }

    const qualityParam =
      parsedUrl.searchParams.get("quality") ||
      parsedUrl.searchParams.get("res") ||
      parsedUrl.searchParams.get("resolution") ||
      parsedUrl.searchParams.get("height") ||
      parsedUrl.searchParams.get("label");

    if (qualityParam) {
      const cleanQuality = String(qualityParam).trim();

      if (/^\d{3,4}$/.test(cleanQuality)) {
        return `${cleanQuality}p`;
      }

      return cleanQuality;
    }

    const qualityMatch = decodedUrl.match(/(?:^|[^\d])(\d{3,4})p(?:[^\d]|$)/);
    if (qualityMatch) {
      return `${qualityMatch[1]}p`;
    }

    const bitrateParam =
      parsedUrl.searchParams.get("bitrate") ||
      parsedUrl.searchParams.get("br") ||
      parsedUrl.searchParams.get("abr");

    if (bitrateParam) {
      const cleanBitrate = String(bitrateParam).trim();

      if (/^\d+$/.test(cleanBitrate)) {
        return `${cleanBitrate} kbps`;
      }

      return cleanBitrate;
    }

    const bitrateMatch = decodedUrl.match(/(?:^|[^\d])(\d{2,4})k(?:[^\d]|$)/);
    if (bitrateMatch) {
      return `${bitrateMatch[1]} kbps`;
    }

    return null;
  } catch {
    return null;
  }
}

function getHeaderValue(responseHeaders, headerName) {
  if (!Array.isArray(responseHeaders)) return "";

  const header = responseHeaders.find((item) => {
    return item.name && item.name.toLowerCase() === headerName.toLowerCase();
  });

  return header ? header.value || "" : "";
}

function getFilenameFromContentDisposition(contentDisposition) {
  if (!contentDisposition) return "";

  const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch {
      return utfMatch[1];
    }
  }

  const normalMatch = contentDisposition.match(/filename="?([^"]+)"?/i);
  return normalMatch ? normalMatch[1] : "";
}

function getStreamInfoFromHeaders(responseHeaders) {
  const contentType = getHeaderValue(responseHeaders, "content-type");
  const fromContentType = getStreamInfoFromContentType(contentType);

  if (fromContentType) {
    return fromContentType;
  }

  const contentDisposition = getHeaderValue(responseHeaders, "content-disposition");
  const filename = getFilenameFromContentDisposition(contentDisposition);
  const extension = getExtensionFromUrl(`https://local.test/${filename}`);

  return getStreamInfoFromExtension(extension);
}

function getStreamInfoFromQueryParams(parsedUrl) {
  const values = [];

  parsedUrl.searchParams.forEach((value, key) => {
    values.push(`${key}=${value}`);
  });

  const queryText = values.join("&").toLowerCase();

  if (!queryText) return null;

  if (
    queryText.includes("m3u8") ||
    queryText.includes("mpegurl") ||
    queryText.includes("hls")
  ) {
    return {
      type: "hls",
      extension: "m3u8"
    };
  }

  if (
    queryText.includes("mpd") ||
    queryText.includes("dash")
  ) {
    return {
      type: "dash",
      extension: "mpd"
    };
  }

  for (const extension of AUDIO_STREAM_EXTENSIONS) {
    if (
      queryText.includes(`format=${extension}`) ||
      queryText.includes(`ext=${extension}`) ||
      queryText.includes(`type=${extension}`) ||
      queryText.includes(`audio/${extension}`)
    ) {
      return {
        type: "audio",
        extension
      };
    }
  }

  for (const extension of VIDEO_STREAM_EXTENSIONS) {
    if (
      queryText.includes(`format=${extension}`) ||
      queryText.includes(`ext=${extension}`) ||
      queryText.includes(`type=${extension}`) ||
      queryText.includes(`video/${extension}`)
    ) {
      return {
        type: "video",
        extension
      };
    }
  }

  return null;
}

function isSoundCloudPlaybackHlsEndpoint(url) {
  if (!url) return false;

  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.toLowerCase();
    const pathname = decodeURIComponent(parsedUrl.pathname).toLowerCase();

    if (host !== "api-v2.soundcloud.com" && host !== "api.soundcloud.com") {
      return false;
    }

    return (
      pathname.includes("/media/soundcloud:tracks:") &&
      pathname.includes("/stream/hls")
    );
  } catch {
    return false;
  }
}

function getSoundCloudHlsStreamInfoFromUrl(url) {
  if (!isSoundCloudPlaybackHlsEndpoint(url)) {
    return null;
  }

  return {
    type: "hls",
    extension: "m3u8",
    source: "soundcloud-api",
    qualityLabel: "SoundCloud HLS"
  };
}

function getStreamInfoFromUrl(url) {
  if (!url) return null;

  try {
    const parsedUrl = new URL(url);
    const lower = parsedUrl.href.toLowerCase();

    const soundCloudHlsInfo = getSoundCloudHlsStreamInfoFromUrl(url);
    if (soundCloudHlsInfo) {
      return soundCloudHlsInfo;
    }

    if (
      lower.includes(".m3u8") ||
      lower.includes("application/vnd.apple.mpegurl") ||
      lower.includes("application/x-mpegurl")
    ) {
      return {
        type: "hls",
        extension: "m3u8"
      };
    }

    if (lower.includes(".mpd") || lower.includes("application/dash+xml")) {
      return {
        type: "dash",
        extension: "mpd"
      };
    }

    const extension = getExtensionFromUrl(url);
    const fromExtension = getStreamInfoFromExtension(extension);

    if (fromExtension) {
      return fromExtension;
    }

    return getStreamInfoFromQueryParams(parsedUrl);
  } catch {
    return null;
  }
}

function isSoundCloudPlaybackHost(url) {
  if (!url) return false;

  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "playback.media-streaming.soundcloud.cloud" || host.endsWith(".soundcloud.com") || host.endsWith(".soundcloud.cloud");
  } catch {
    return false;
  }
}

function getSoundCloudCaptureHint(url) {
  if (!url || !isSoundCloudPlaybackHost(url)) {
    return null;
  }

  if (isSoundCloudPlaybackHlsEndpoint(url)) {
    return "api";
  }

  const lower = String(url).toLowerCase();

  if (lower.includes(".m3u8") || lower.includes("/playlist") || lower.includes("/manifest")) {
    return "manifest";
  }

  if (lower.includes("/transcodings") || lower.includes("/streams") || lower.includes("/media/soundcloud:tracks:")) {
    return "api";
  }

  if (lower.includes(".m4s") || /\/data\d+\.m4s(?:[?#]|$)/.test(lower) || lower.includes("/aac_")) {
    return "fragment";
  }

  return null;
}

function hashString(value) {
  let hash = 0;
  const text = String(value || "");

  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36);
}

function getSoundCloudFragmentInfo(url) {
  if (!url) return null;

  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.toLowerCase();

    if (!host.includes("soundcloud.cloud")) {
      return null;
    }

    const parts = decodeURIComponent(parsedUrl.pathname)
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);

    const fileName = parts[parts.length - 1];

    if (!fileName) return null;

    const isInit = fileName.toLowerCase() === "init.mp4";
    const segmentMatch = fileName.toLowerCase().match(/^data(\d+)\.m4s$/);

    if (!isInit && !segmentMatch) {
      return null;
    }

    const qualityIndex = parts.findIndex((part) => /^aac_\d+k$/i.test(part));

    if (qualityIndex <= 0 || qualityIndex + 1 >= parts.length) {
      return null;
    }

    const groupParts = parts.slice(0, qualityIndex + 2);
    const groupKey = `${host}/${groupParts.join("/")}`;

    return {
      groupKey,
      qualityLabel: parts[qualityIndex],
      fileName,
      isInit,
      segmentIndex: segmentMatch ? Number(segmentMatch[1]) : null,
      url
    };
  } catch {
    return null;
  }
}

function getSoundCloudFallbackId(tabId, captureId, groupKey) {
  return `soundcloud-${tabId}-${hashString(`${captureId}:${groupKey}`)}`;
}

function ensureSoundCloudFragmentGroup(tabId, activeCapture, fragmentInfo) {
  if (!soundCloudFragmentGroupsByTabId[tabId]) {
    soundCloudFragmentGroupsByTabId[tabId] = {};
  }

  const fallbackId = getSoundCloudFallbackId(
    tabId,
    activeCapture.captureId,
    fragmentInfo.groupKey
  );

  if (!soundCloudFragmentGroupsByTabId[tabId][fallbackId]) {
    soundCloudFragmentGroupsByTabId[tabId][fallbackId] = {
      id: fallbackId,
      tabId,
      captureId: activeCapture.captureId,
      trackTitle: activeCapture.trackTitle || "media",
      groupKey: fragmentInfo.groupKey,
      qualityLabel: fragmentInfo.qualityLabel || null,
      initUrl: null,
      segmentsByIndex: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  return soundCloudFragmentGroupsByTabId[tabId][fallbackId];
}

function rememberSoundCloudFragmentFallback(tabId, activeCapture, url) {
  if (!activeCapture || !url) return null;

  const fragmentInfo = getSoundCloudFragmentInfo(url);

  if (!fragmentInfo) {
    return null;
  }

  const group = ensureSoundCloudFragmentGroup(tabId, activeCapture, fragmentInfo);

  if (fragmentInfo.isInit) {
    group.initUrl = fragmentInfo.url;
  } else if (Number.isFinite(fragmentInfo.segmentIndex)) {
    group.segmentsByIndex[String(fragmentInfo.segmentIndex)] = fragmentInfo.url;
  }

  group.updatedAt = Date.now();
  soundCloudFallbackPlaylistsById[group.id] = group;

  return group;
}

function getSoundCloudGroupSegmentCount(group) {
  if (!group || !group.segmentsByIndex) return 0;

  return Object.keys(group.segmentsByIndex).length;
}

function getBestSoundCloudFallbackForCapture(tabId, captureId) {
  const groups = Object.values(soundCloudFragmentGroupsByTabId[tabId] || {})
    .filter((group) => group.captureId === captureId)
    .filter((group) => group.initUrl && getSoundCloudGroupSegmentCount(group) > 0)
    .sort((a, b) => {
      const segmentDiff = getSoundCloudGroupSegmentCount(b) - getSoundCloudGroupSegmentCount(a);

      if (segmentDiff !== 0) {
        return segmentDiff;
      }

      return b.updatedAt - a.updatedAt;
    });

  return groups[0] || null;
}

function escapeHlsQuotedUri(url) {
  return String(url || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function buildSoundCloudObservedPlaylist(group) {
  if (!group || !group.initUrl) {
    return null;
  }

  const segments = Object.entries(group.segmentsByIndex || {})
    .map(([index, url]) => {
      return {
        index: Number(index),
        url
      };
    })
    .filter((segment) => Number.isFinite(segment.index) && segment.url)
    .sort((a, b) => a.index - b.index);

  if (segments.length === 0) {
    return null;
  }

  const firstIndex = segments[0].index;

  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-TARGETDURATION:10",
    `#EXT-X-MEDIA-SEQUENCE:${firstIndex}`,
    `#EXT-X-MAP:URI="${escapeHlsQuotedUri(group.initUrl)}"`
  ];

  segments.forEach((segment) => {
    lines.push("#EXTINF:10.000,");
    lines.push(segment.url);
  });

  return lines.join("\n");
}

function attachSoundCloudFallbackToCapturedStream(tabId, capturedStream) {
  if (!capturedStream || !capturedStream.captureId) {
    return capturedStream;
  }

  const fallbackGroup = getBestSoundCloudFallbackForCapture(
    tabId,
    capturedStream.captureId
  );

  if (!fallbackGroup) {
    return capturedStream;
  }

  return {
    ...capturedStream,
    soundCloudFallbackPlaylistId: fallbackGroup.id,
    soundCloudFallbackSegmentCount: getSoundCloudGroupSegmentCount(fallbackGroup),
    soundCloudFallbackQuality: fallbackGroup.qualityLabel || null
  };
}

function resendCapturedStreamWithFallbackIfNeeded(tabId, activeCapture, existingCapturedStream) {
  if (!existingCapturedStream || !activeCapture) {
    return;
  }

  const oldFallbackId = existingCapturedStream.soundCloudFallbackPlaylistId || null;
  const enrichedStream = attachSoundCloudFallbackToCapturedStream(tabId, existingCapturedStream);
  const newFallbackId = enrichedStream.soundCloudFallbackPlaylistId || null;

  if (!newFallbackId || newFallbackId === oldFallbackId) {
    return;
  }

  capturedStreamsByTabId[tabId][activeCapture.captureId] = enrichedStream;

  chrome.tabs.sendMessage(
    tabId,
    {
      type: "MEDIA_DOWNLOADER_CAPTURED_STREAM",
      captureId: activeCapture.captureId,
      stream: enrichedStream
    },
    () => {
      if (chrome.runtime.lastError) {
        // ignore
      }
    }
  );
}

function cleanupSoundCloudFallbacksForTab(tabId) {
  delete soundCloudFragmentGroupsByTabId[tabId];

  Object.keys(soundCloudFallbackPlaylistsById).forEach((fallbackId) => {
    if (soundCloudFallbackPlaylistsById[fallbackId]?.tabId === tabId) {
      delete soundCloudFallbackPlaylistsById[fallbackId];
    }
  });
}

function shouldIgnoreCaptureResponseDiagnostic(details, contentType = "") {
  if (!details || !details.url) {
    return true;
  }

  const lowerUrl = String(details.url).toLowerCase();
  const lowerType = String(contentType || "").toLowerCase();
  const requestType = String(details.type || "").toLowerCase();

  if (["ping", "csp_report", "font", "image"].includes(requestType)) {
    return true;
  }

  if (
    lowerUrl.includes("analytics") ||
    lowerUrl.includes("collect?") ||
    lowerUrl.includes("pixel") ||
    lowerUrl.includes("telemetry") ||
    lowerUrl.includes("tsub/") ||
    lowerUrl.includes("/connect/session")
  ) {
    return true;
  }

  if (
    lowerType.startsWith("application/json") ||
    lowerType.startsWith("text/plain") ||
    lowerType.startsWith("text/html") ||
    lowerType.startsWith("text/event-stream")
  ) {
    return true;
  }

  return false;
}

function isManifestLikeStream(streamInfo, url) {
  if (!streamInfo) return false;

  if (streamInfo.type === "hls" || streamInfo.type === "dash") {
    return true;
  }

  const normalizedUrl = String(url || "").toLowerCase();
  return normalizedUrl.includes(".m3u8") || normalizedUrl.includes(".mpd");
}

function isFragmentLikeUrl(url) {
  if (!url) return false;

  if (isSoundCloudPlaybackHlsEndpoint(url)) {
    return false;
  }

  try {
    const parsedUrl = new URL(url);
    const decodedHref = decodeURIComponent(parsedUrl.href).toLowerCase();
    const pathname = parsedUrl.pathname.toLowerCase();
    const search = parsedUrl.search.toLowerCase();

    if (
      pathname.endsWith(".m4s") ||
      pathname.endsWith(".cmfa") ||
      pathname.endsWith(".cmfv") ||
      pathname.endsWith(".ts")
    ) {
      return true;
    }

    if (
      /(?:^|[\/_\-.])(seg(?:ment)?|frag(?:ment)?|chunk|part|init)(?:[\/_\-.]|\d|$)/.test(pathname) ||
      /(?:^|[?&])(segment|frag(?:ment)?|chunk|part|init|seq(?:uence)?|range)=/i.test(search) ||
      decodedHref.includes("/media/") ||
      decodedHref.includes("/segment/") ||
      decodedHref.includes("/fragments/")
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function getCaptureCandidateScore(url, streamInfo, meta = {}) {
  let score = 0;

  if (isManifestLikeStream(streamInfo, url)) {
    score += 100;
  }

  if (streamInfo?.type === "audio" || streamInfo?.type === "video") {
    score += 20;
  }

  if (meta.contentLength && Number(meta.contentLength) > 256 * 1024) {
    score += 20;
  }

  if (meta.acceptRanges) {
    score += 10;
  }

  if (meta.requestType === "media") {
    score += 5;
  }

  if (isFragmentLikeUrl(url)) {
    score -= 80;
  }

  return score;
}

function shouldReplaceCapturedStream(existingStream, nextStream) {
  if (!existingStream) return true;
  if (!nextStream) return false;

  const currentScore = Number(existingStream.captureScore || 0);
  const nextScore = Number(nextStream.captureScore || 0);

  if (nextScore !== currentScore) {
    return nextScore > currentScore;
  }

  const existingIsFragment = Boolean(existingStream.isFragmentLike);
  const nextIsFragment = Boolean(nextStream.isFragmentLike);

  if (existingIsFragment !== nextIsFragment) {
    return !nextIsFragment;
  }

  const existingIsManifest = Boolean(existingStream.isManifestLike);
  const nextIsManifest = Boolean(nextStream.isManifestLike);

  if (existingIsManifest !== nextIsManifest) {
    return nextIsManifest;
  }

  return Number(nextStream.foundAt || 0) >= Number(existingStream.foundAt || 0);
}

function getDiagnosticSignature(code, message, data = {}) {
  const stableData = {
    host: data.host || null,
    adapter: data.adapter || null,
    visibleLinks: data.visibleLinks ?? null,
    inlineLinkMediaFound: data.inlineLinkMediaFound ?? null,
    visibleMediaElements: data.visibleMediaElements ?? null,
    inlineMediaFound: data.inlineMediaFound ?? null,
    latestHlsChecks: data.latestHlsChecks ?? null,
    adapterCandidates: data.adapterCandidates ?? null,
    buttonsOnPage: data.buttonsOnPage ?? null,
    url: data.url || null,
    contentType: data.contentType || null,
    requestType: data.requestType || null,
    statusCode: data.statusCode || null
  };

  return JSON.stringify({
    code,
    message,
    data: stableData
  });
}

function rememberDiagnostic(tabId, code, message, data = {}) {
  if (typeof tabId !== "number" || tabId < 0) return;

  if (!diagnosticsByTabId[tabId]) {
    diagnosticsByTabId[tabId] = [];
  }

  if (!diagnosticSignaturesByTabId[tabId]) {
    diagnosticSignaturesByTabId[tabId] = new Set();
  }

  const signature = getDiagnosticSignature(code, message, data);

  if (diagnosticSignaturesByTabId[tabId].has(signature)) {
    return;
  }

  diagnosticSignaturesByTabId[tabId].add(signature);

  const diagnostics = diagnosticsByTabId[tabId];

  const diagnostic = {
    code,
    message,
    data,
    createdAt: Date.now()
  };

  diagnostics.unshift(diagnostic);

  if (diagnostics.length > MAX_DIAGNOSTICS_PER_TAB) {
    diagnostics.length = MAX_DIAGNOSTICS_PER_TAB;
  }

  console.log("[Media Downloader] Diagnostic:", diagnostic);
}

function rememberStream(tabId, url, streamInfo, meta = {}) {
  if (tabId < 0 || !url || !streamInfo || !streamInfo.type) return;

  if (!streamsByTabId[tabId]) {
    streamsByTabId[tabId] = [];
  }

  const streams = streamsByTabId[tabId];

  const qualityLabel =
    meta.qualityLabel ||
    streamInfo.qualityLabel ||
    getQualityLabelFromUrl(url);

  const existingStream = streams.find((stream) => stream.url === url);

  if (existingStream) {
    existingStream.type = streamInfo.type || existingStream.type;
    existingStream.extension = streamInfo.extension || existingStream.extension || null;
    existingStream.contentType = streamInfo.contentType || meta.contentType || existingStream.contentType || null;

    existingStream.source = mergePlusSeparatedValues(
      existingStream.source,
      meta.source || "unknown"
    );

    existingStream.detector = mergePlusSeparatedValues(
      existingStream.detector,
      meta.detector || ""
    );

    existingStream.requestType = meta.requestType || existingStream.requestType || null;
    existingStream.method = meta.method || existingStream.method || null;
    existingStream.statusCode = meta.statusCode || existingStream.statusCode || null;
    existingStream.initiator = meta.initiator || existingStream.initiator || null;

    existingStream.contentLength = meta.contentLength || existingStream.contentLength || null;
    existingStream.acceptRanges = meta.acceptRanges || existingStream.acceptRanges || null;
    existingStream.contentRange = meta.contentRange || existingStream.contentRange || null;
    existingStream.qualityLabel = qualityLabel || existingStream.qualityLabel || null;

    existingStream.updatedAt = Date.now();

    return;
  }

  const stream = {
    url,
    type: streamInfo.type,
    extension: streamInfo.extension || null,
    contentType: streamInfo.contentType || meta.contentType || null,
    source: meta.source || "unknown",
    detector: meta.detector || null,
    requestType: meta.requestType || null,
    method: meta.method || null,
    statusCode: meta.statusCode || null,
    initiator: meta.initiator || null,
    contentLength: meta.contentLength || null,
    acceptRanges: meta.acceptRanges || null,
    contentRange: meta.contentRange || null,
    qualityLabel: qualityLabel || null,
    foundAt: Date.now()
  };

  streams.unshift(stream);

  if (streams.length > MAX_STREAMS_PER_TAB) {
    streams.length = MAX_STREAMS_PER_TAB;
  }

  console.log("[Media Downloader] Stream found:", stream);
}

function rememberStreamForActiveCapture(tabId, url, streamInfo, meta = {}) {
  if (tabId < 0 || !url || !streamInfo || !streamInfo.type) return;

  const activeCapture = activeCapturesByTabId[tabId];
  if (!activeCapture) return;

  const now = Date.now();

  if (now > activeCapture.expiresAt) {
    rememberDiagnostic(
      tabId,
      "capture-timeout-no-stream",
      "Время ожидания capture истекло: подходящий поток не был найден.",
      {
        captureId: activeCapture.captureId,
        trackTitle: activeCapture.trackTitle || "media",
        startedAt: activeCapture.startedAt,
        expiresAt: activeCapture.expiresAt,
        lastObservedUrl: url,
        lastObservedType: streamInfo.type
      }
    );

    delete activeCapturesByTabId[tabId];
    return;
  }

  if (!capturedStreamsByTabId[tabId]) {
    capturedStreamsByTabId[tabId] = {};
  }

  rememberSoundCloudFragmentFallback(tabId, activeCapture, url);

  const isManifestLike = isManifestLikeStream(streamInfo, url);
  const isFragmentLike = isFragmentLikeUrl(url);
  const captureScore = getCaptureCandidateScore(url, streamInfo, meta);

  const capturedStream = {
    url,
    type: streamInfo.type,
    extension: streamInfo.extension || null,
    contentType: streamInfo.contentType || meta.contentType || null,
    captureId: activeCapture.captureId,
    trackTitle: activeCapture.trackTitle || "media",
    foundAt: now,
    isManifestLike,
    isFragmentLike,
    captureScore,
    siteHint: getSoundCloudCaptureHint(url)
  };

  const existingCapturedStream = capturedStreamsByTabId[tabId][activeCapture.captureId] || null;

  if (!shouldReplaceCapturedStream(existingCapturedStream, capturedStream)) {
    resendCapturedStreamWithFallbackIfNeeded(tabId, activeCapture, existingCapturedStream);
    if (isFragmentLike && !existingCapturedStream?.isFragmentLike) {
      rememberDiagnostic(
        tabId,
        "captured-audio-fragment-not-full-file",
        "Во время capture найден audio/video fragment, но он проигнорирован в пользу более подходящего потока.",
        {
          captureId: activeCapture.captureId,
          trackTitle: activeCapture.trackTitle || "media",
          url,
          contentType: capturedStream.contentType,
          requestType: meta.requestType || null,
          statusCode: meta.statusCode || null
        }
      );
    }

    return;
  }

  if (existingCapturedStream?.isFragmentLike && isManifestLike) {
    rememberDiagnostic(
      tabId,
      "capture-preferred-hls-manifest",
      "Во время capture manifest был выбран вместо audio/video fragment.",
      {
        captureId: activeCapture.captureId,
        trackTitle: activeCapture.trackTitle || "media",
        url,
        contentType: capturedStream.contentType,
        requestType: meta.requestType || null,
        statusCode: meta.statusCode || null
      }
    );
  } else if (isFragmentLike && !existingCapturedStream) {
    rememberDiagnostic(
      tabId,
      "capture-found-fragment-without-manifest",
      "Во время capture найден только fragment-поток. Он может не быть полноценным скачиваемым файлом.",
      {
        captureId: activeCapture.captureId,
        trackTitle: activeCapture.trackTitle || "media",
        url,
        contentType: capturedStream.contentType,
        requestType: meta.requestType || null,
        statusCode: meta.statusCode || null
      }
    );

    if (capturedStream.siteHint === "fragment") {
      rememberDiagnostic(
        tabId,
        "soundcloud-fragment-detected-awaiting-manifest",
        "SoundCloud отдает fragment-сегменты. Для скачивания нужен связанный manifest или playback API URL.",
        {
          captureId: activeCapture.captureId,
          trackTitle: activeCapture.trackTitle || "media",
          url,
          contentType: capturedStream.contentType,
          requestType: meta.requestType || null,
          statusCode: meta.statusCode || null,
          host: "soundcloud"
        }
      );
    }
  }

  const streamForContent = attachSoundCloudFallbackToCapturedStream(tabId, capturedStream);

  capturedStreamsByTabId[tabId][activeCapture.captureId] = streamForContent;

  chrome.tabs.sendMessage(
    tabId,
    {
      type: "MEDIA_DOWNLOADER_CAPTURED_STREAM",
      captureId: activeCapture.captureId,
      stream: streamForContent
    },
    () => {
      if (chrome.runtime.lastError) {
        // Content script может быть недоступен на некоторых служебных страницах.
      }
    }
  );

  console.log("[Media Downloader] Stream bound to capture:", streamForContent);
}

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!details || !details.url) return;

    const streamInfo = getStreamInfoFromUrl(details.url);
    if (!streamInfo) return;

    rememberStream(details.tabId, details.url, streamInfo, {
      source: "url",
      qualityLabel: streamInfo.qualityLabel || null,
      detector: "onBeforeRequest",
      requestType: details.type || null,
      method: details.method || null,
      initiator: details.initiator || null
    });

    rememberStreamForActiveCapture(details.tabId, details.url, streamInfo, {
      source: streamInfo.source || "url",
      qualityLabel: streamInfo.qualityLabel || null,
      requestType: details.type || null,
      method: details.method || null,
      initiator: details.initiator || null
    });
  },
  {
    urls: ["<all_urls>"]
  }
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!details || !details.url) return;

    const fromHeaders = getStreamInfoFromHeaders(details.responseHeaders);
    const fromUrl = getStreamInfoFromUrl(details.url);
    const streamInfo = fromHeaders || fromUrl;

    if (!streamInfo) {
      const activeCapture = activeCapturesByTabId[details.tabId];

      if (activeCapture) {
        const contentType = getHeaderValue(details.responseHeaders, "content-type");
        const soundCloudHint = getSoundCloudCaptureHint(details.url);

        if (soundCloudHint === "manifest" || soundCloudHint === "api") {
          rememberDiagnostic(
            details.tabId,
            soundCloudHint === "manifest"
              ? "soundcloud-manifest-candidate-detected"
              : "soundcloud-api-playback-url-detected",
            soundCloudHint === "manifest"
              ? "Во время capture замечен SoundCloud manifest-кандидат. Нужна доработка site adapter для его извлечения."
              : "Во время capture замечен SoundCloud playback/API запрос. Он может содержать путь к manifest.",
            {
              url: details.url,
              contentType,
              requestType: details.type || null,
              statusCode: details.statusCode || null,
              trackTitle: activeCapture.trackTitle || "media"
            }
          );
        } else if (!shouldIgnoreCaptureResponseDiagnostic(details, contentType)) {
          rememberDiagnostic(
            details.tabId,
            "capture-response-not-media",
            "Во время capture был сетевой ответ, но Content-Type/URL не похожи на поддерживаемое медиа.",
            {
              url: details.url,
              contentType,
              requestType: details.type || null,
              statusCode: details.statusCode || null
            }
          );
        }
      }

      return;
    }

    rememberStream(details.tabId, details.url, streamInfo, {
      source: "headers",
      qualityLabel: streamInfo.qualityLabel || null,
      detector: "onHeadersReceived",
      requestType: details.type || null,
      method: details.method || null,
      statusCode: details.statusCode || null,
      initiator: details.initiator || null,
      contentType: getHeaderValue(details.responseHeaders, "content-type"),
      contentLength: getNumberHeaderValue(details.responseHeaders, "content-length"),
      acceptRanges: getHeaderValue(details.responseHeaders, "accept-ranges"),
      contentRange: getHeaderValue(details.responseHeaders, "content-range")
    });

    rememberStreamForActiveCapture(details.tabId, details.url, streamInfo, {
      source: streamInfo.source || "headers",
      qualityLabel: streamInfo.qualityLabel || null,
      requestType: details.type || null,
      method: details.method || null,
      statusCode: details.statusCode || null,
      initiator: details.initiator || null,
      contentType: getHeaderValue(details.responseHeaders, "content-type"),
      contentLength: getNumberHeaderValue(details.responseHeaders, "content-length"),
      acceptRanges: getHeaderValue(details.responseHeaders, "accept-ranges"),
      contentRange: getHeaderValue(details.responseHeaders, "content-range")
    });
  },
  {
    urls: ["<all_urls>"]
  },
  ["responseHeaders"]
);

chrome.tabs.onRemoved.addListener((tabId) => {
  delete streamsByTabId[tabId];
  delete activeCapturesByTabId[tabId];
  delete capturedStreamsByTabId[tabId];
  delete diagnosticsByTabId[tabId];
  delete diagnosticSignaturesByTabId[tabId];
  delete scanSummariesByTabId[tabId];
  cleanupSoundCloudFallbacksForTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;

  delete streamsByTabId[tabId];
  delete activeCapturesByTabId[tabId];
  delete capturedStreamsByTabId[tabId];
  delete diagnosticsByTabId[tabId];
  delete diagnosticSignaturesByTabId[tabId];
  delete scanSummariesByTabId[tabId];
  cleanupSoundCloudFallbacksForTab(tabId);
});


chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "GET_SOUNDCLOUD_FALLBACK_PLAYLIST") {
  const fallbackId = message.fallbackPlaylistId;
  const group = soundCloudFallbackPlaylistsById[fallbackId];

  if (!group) {
    sendResponse({
      ok: false,
      error: "SoundCloud fallback playlist not found"
    });

    return;
  }

  const playlistText = buildSoundCloudObservedPlaylist(group);

  if (!playlistText) {
    sendResponse({
      ok: false,
      error: "SoundCloud fallback playlist is not ready yet"
    });

    return;
  }

  sendResponse({
    ok: true,
    playlistUrl: `https://soundcloud.local/fallback/${encodeURIComponent(group.id)}.m3u8`,
    playlistText,
    source: "soundcloud-observed-fragments",
    trackTitle: group.trackTitle || "media",
    qualityLabel: group.qualityLabel || null,
    segmentCount: getSoundCloudGroupSegmentCount(group),
    hasInit: Boolean(group.initUrl),
    warning: "Fallback собран только из уже замеченных SoundCloud fragments. Для полного трека нужно, чтобы были пойманы все сегменты или чтобы API playlist открылся напрямую."
  });

  return;
}

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

  if (message.type === "START_STREAM_CAPTURE") {
    const tabId = sender.tab?.id ?? message.tabId;

    if (typeof tabId !== "number") {
      sendResponse({
        ok: false,
        error: "Cannot determine tabId"
      });
      return;
    }

    const timeoutMs = Number(message.timeoutMs || 7000);

    activeCapturesByTabId[tabId] = {
      captureId: message.captureId,
      trackTitle: message.trackTitle || "media",
      startedAt: Date.now(),
      expiresAt: Date.now() + timeoutMs
    };

    setTimeout(() => {
      const activeCapture = activeCapturesByTabId[tabId];

      if (!activeCapture || activeCapture.captureId !== message.captureId) {
        return;
      }

      rememberDiagnostic(
        tabId,
        "capture-timeout-no-stream",
        "Capture завершился без найденного поддерживаемого потока.",
        {
          captureId: activeCapture.captureId,
          trackTitle: activeCapture.trackTitle || "media",
          startedAt: activeCapture.startedAt,
          expiresAt: activeCapture.expiresAt,
          timeoutMs
        }
      );

      delete activeCapturesByTabId[tabId];
    }, timeoutMs + 250);

    sendResponse({
      ok: true,
      capture: activeCapturesByTabId[tabId]
    });

    return;
  }

  if (message.type === "GET_CAPTURED_STREAM") {
    const tabId = sender.tab?.id ?? message.tabId;
    const captureId = message.captureId;

    const stream =
      capturedStreamsByTabId[tabId] &&
      capturedStreamsByTabId[tabId][captureId]
        ? capturedStreamsByTabId[tabId][captureId]
        : null;

    sendResponse({
      ok: true,
      stream
    });

    return;
  }
    if (message.type === "GET_MEDIA_DOWNLOADER_STATE") {
      const tabId = message.tabId;

      sendResponse({
        ok: true,
        streams: streamsByTabId[tabId] || [],
        diagnostics: diagnosticsByTabId[tabId] || [],
        scanSummary: scanSummariesByTabId[tabId] || null
      });

      return;
    }

  if (message.type === "CLEAR_MEDIA_DOWNLOADER_STATE") {
    const tabId = message.tabId;

    streamsByTabId[tabId] = [];
    diagnosticsByTabId[tabId] = [];

    sendResponse({
      ok: true
    });

    return;
  }

    if (message.type === "CLEAR_MEDIA_DOWNLOADER_DIAGNOSTICS") {
      const tabId = message.tabId;

      diagnosticsByTabId[tabId] = [];

      sendResponse({
        ok: true
      });

      return;
  }
    if (message.type === "REPORT_MEDIA_DOWNLOADER_SCAN_SUMMARY") {
      const tabId = sender.tab?.id ?? message.tabId;

      if (typeof tabId === "number" && tabId >= 0) {
        scanSummariesByTabId[tabId] = {
          message: message.message || "Текущий скан страницы",
          data: message.data || {},
          updatedAt: Date.now()
        };
      }

      sendResponse({
        ok: true
      });

      return;
    }


  if (message.type === "REPORT_MEDIA_DOWNLOADER_DIAGNOSTIC") {
    const tabId = sender.tab?.id ?? message.tabId;

    rememberDiagnostic(
      tabId,
      message.code || "content-diagnostic",
      message.message || "Content script diagnostic",
      message.data || {}
    );

    sendResponse({
      ok: true
    });

    return;
  }

  if (message.type === "GET_HLS_STREAMS") {
    const tabId = message.tabId;
    const streams = streamsByTabId[tabId] || [];

    sendResponse({
      ok: true,
      streams: streams.filter((stream) => stream.type === "hls")
    });

    return;
  }

  if (message.type === "GET_LATEST_HLS_STREAM") {
    const tabId = sender.tab?.id ?? message.tabId;
    const streams = streamsByTabId[tabId] || [];
    const latestStream = streams.find((stream) => stream.type === "hls") || null;

    sendResponse({
      ok: true,
      stream: latestStream
    });

    return;
  }

  if (message.type === "GET_LATEST_STREAM") {
    const tabId = sender.tab?.id ?? message.tabId;
    const streams = streamsByTabId[tabId] || [];
    const latestStream = streams[0] || null;

    sendResponse({
      ok: true,
      stream: latestStream
    });

    return;
  }
});