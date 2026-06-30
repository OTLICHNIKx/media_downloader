// Stream-type и filename-хелперы для popup/panel (идентичны в обеих копиях).

import { sanitizeFilename } from "./filename.js";

export function getStreamTypeFromExtension(extension) {
  const cleanExtension = String(extension || "").replace(/^\./, "").toLowerCase();

  if (cleanExtension === "m3u8") return "hls";
  if (cleanExtension === "mpd") return "dash";

  if (["mp3", "m4a", "aac", "ogg", "opus", "wav", "flac"].includes(cleanExtension)) {
    return "audio";
  }

  if (["mp4", "webm", "m4v", "mov"].includes(cleanExtension)) {
    return "video";
  }

  return "media";
}

export function getFilenameFromUrl(url, fallbackExtension = "media") {
  try {
    const parsedUrl = new URL(url);
    const parts = parsedUrl.pathname.split("/");
    const lastPart = parts[parts.length - 1];

    if (lastPart && lastPart.includes(".")) {
      return sanitizeFilename(decodeURIComponent(lastPart));
    }

    return `media-file.${fallbackExtension}`;
  } catch {
    return `media-file.${fallbackExtension}`;
  }
}

export function getStreamFilename(stream) {
  if (stream.filename) return sanitizeFilename(stream.filename);

  const extension = stream.extension || "media";
  return getFilenameFromUrl(stream.url, extension);
}

// normalizePageMediaItem принимает media-item из content-script (collectMediaLinks)
// и приводит к потоковому формату popup/panel. Идентична в popup.js и panel.js.
export function normalizePageMediaItem(mediaItem) {
  if (!mediaItem || !mediaItem.url) return null;

  const extension = mediaItem.extension || "media";
  const type = mediaItem.streamType || getStreamTypeFromExtension(extension);

  return {
    url: mediaItem.url,
    type,
    extension,
    contentType: null,
    contentLength: null,
    qualityLabel: mediaItem.quality && mediaItem.quality !== "unknown" ? mediaItem.quality : null,
    source: mediaItem.source ? `page:${mediaItem.source}` : "page",
    requestType: "page-scan",
    foundAt: Date.now(),
    filename: mediaItem.filename || getFilenameFromUrl(mediaItem.url, extension)
  };
}
