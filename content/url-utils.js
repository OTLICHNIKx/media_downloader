function normalizeUrl(url) {
  try {
    return new URL(url, window.location.href).href;
  } catch {
    return null;
  }
}

function getStreamTypeFromExtension(extension) {
  const cleanExtension = String(extension || "").replace(/^\./, "").toLowerCase();

  if (cleanExtension === "m3u8") return "hls";
  if (cleanExtension === "mpd") return "dash";
  if (AUDIO_EXTENSIONS.includes(cleanExtension)) return "audio";
  if (VIDEO_EXTENSIONS.includes(cleanExtension)) return "video";

  return null;
}

function getExtensionFromQueryParams(parsedUrl) {
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
    return "m3u8";
  }

  if (
    queryText.includes("mpd") ||
    queryText.includes("dash")
  ) {
    return "mpd";
  }

  for (const extension of SUPPORTED_EXTENSIONS) {
    if (
      queryText.includes(`format=${extension}`) ||
      queryText.includes(`ext=${extension}`) ||
      queryText.includes(`type=${extension}`) ||
      queryText.includes(`mime=audio/${extension}`) ||
      queryText.includes(`mime=video/${extension}`) ||
      queryText.includes(`audio/${extension}`) ||
      queryText.includes(`video/${extension}`)
    ) {
      return extension;
    }
  }

  return null;
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
      if (href.includes(`%2e${extension}`)) return extension;
    }

    return getExtensionFromQueryParams(parsedUrl);
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
    streamType: "hls",
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

  const streamType = getStreamTypeFromExtension(extension);
  if (!streamType) return null;

  return {
    url: normalizedUrl,
    extension,
    streamType,
    quality: guessQuality(normalizedUrl),
    filename: getFileName(normalizedUrl),
    source
  };
}
