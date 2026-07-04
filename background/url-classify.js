import {
  STREAM_EXTENSIONS,
  AUDIO_STREAM_EXTENSIONS,
  VIDEO_STREAM_EXTENSIONS,
  MEDIA_MIME_RULES
} from "./constants.js";
import { getSoundCloudHlsStreamInfoFromUrl, isSoundCloudPlaybackHlsEndpoint } from "./soundcloud-helpers.js";

export function getExtensionFromUrl(url) {
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

export function getStreamInfoFromExtension(extension) {
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

export function getStreamInfoFromContentType(contentType) {
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

export function getNumberHeaderValue(responseHeaders, headerName) {
  const value = getHeaderValue(responseHeaders, headerName);
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : null;
}

export function mergePlusSeparatedValues(currentValue, nextValue) {
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

export function getQualityLabelFromUrl(url) {
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

export function getHeaderValue(responseHeaders, headerName) {
  if (!Array.isArray(responseHeaders)) return "";

  const header = responseHeaders.find((item) => {
    return item.name && item.name.toLowerCase() === headerName.toLowerCase();
  });

  return header ? header.value || "" : "";
}

export function getFilenameFromContentDisposition(contentDisposition) {
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

export function getStreamInfoFromHeaders(responseHeaders) {
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

export function getStreamInfoFromQueryParams(parsedUrl) {
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

export function getStreamInfoFromUrl(url) {
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

export function isManifestLikeStream(streamInfo, url) {
  if (!streamInfo) return false;

  if (streamInfo.type === "hls" || streamInfo.type === "dash") {
    return true;
  }

  const normalizedUrl = String(url || "").toLowerCase();
  return normalizedUrl.includes(".m3u8") || normalizedUrl.includes(".mpd");
}

export function isFragmentLikeUrl(url) {
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

export function getCaptureCandidateScore(url, streamInfo, meta = {}) {
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

export function shouldReplaceCapturedStream(existingStream, nextStream) {
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

  // Равные score и типы (оба manifest / оба fragment).
  // Раньше: более поздний поток вытеснял первый (>=). Это позволяло prefetch
  // соседнего трека перебиндить карточку. Теперь удерживаем уже привязанный
  // поток — замена только при строгом преимуществе по foundAt невозможна,
  // поэтому сохраняем существующий.
  return false;
}
