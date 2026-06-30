import { resolveUrl } from "../../shared/http.js";
import { initialFilename } from "./ui-state.js";
import { sanitizeFilename } from "../../shared/filename.js";

export function parseAttributeList(attributeText) {
  const result = {};
  const parts = [];

  let current = "";
  let insideQuotes = false;

  for (const char of attributeText) {
    if (char === '"') {
      insideQuotes = !insideQuotes;
      current += char;
      continue;
    }

    if (char === "," && !insideQuotes) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  parts.forEach((part) => {
    const index = part.indexOf("=");
    if (index === -1) return;

    const key = part.slice(0, index).trim();
    let value = part.slice(index + 1).trim();

    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  });

  return result;
}

export function parseMasterPlaylist(text, baseUrl) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const variants = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line.startsWith("#EXT-X-STREAM-INF")) {
      continue;
    }

    const attributesText = line.includes(":") ? line.slice(line.indexOf(":") + 1) : "";
    const attributes = parseAttributeList(attributesText);

    let nextLine = null;

    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      if (!lines[nextIndex].startsWith("#")) {
        nextLine = lines[nextIndex];
        break;
      }
    }

    if (!nextLine) continue;

    variants.push({
      url: resolveUrl(baseUrl, nextLine),
      bandwidth: Number(attributes.BANDWIDTH || 0),
      resolution: attributes.RESOLUTION || "unknown",
      codecs: attributes.CODECS || "unknown"
    });
  }

  variants.sort((a, b) => b.bandwidth - a.bandwidth);

  return variants;
}

export function getUnsupportedEncryptionInfo(text) {
  const keyLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("#EXT-X-KEY"));

  for (const line of keyLines) {
    const attributesText = line.includes(":") ? line.slice(line.indexOf(":") + 1) : "";
    const attributes = parseAttributeList(attributesText);
    const method = attributes.METHOD || "UNKNOWN";

    if (method !== "NONE") {
      return {
        encrypted: true,
        method
      };
    }
  }

  return {
    encrypted: false,
    method: null
  };
}

export function parseMapUrl(text, baseUrl) {
  const mapLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("#EXT-X-MAP"));

  if (!mapLine) return null;

  const attributesText = mapLine.includes(":") ? mapLine.slice(mapLine.indexOf(":") + 1) : "";
  const attributes = parseAttributeList(attributesText);

  if (!attributes.URI) return null;

  return resolveUrl(baseUrl, attributes.URI);
}

export function parseSegmentUrls(text, baseUrl) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .map((line) => resolveUrl(baseUrl, line));
}

export function getPathnameExtension(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();

    if (pathname.endsWith(".aac")) return ".aac";
    if (pathname.endsWith(".mp3")) return ".mp3";
    if (pathname.endsWith(".m4s")) return ".mp4";
    if (pathname.endsWith(".mp4")) return ".mp4";
    if (pathname.endsWith(".ts")) return ".ts";

    return null;
  } catch {
    return null;
  }
}

export function isAudioOnlyVariant(variant) {
  if (!variant) {
    return false;
  }

  const codecs = String(variant.codecs || "").toLowerCase();
  const resolution = String(variant.resolution || "").toLowerCase();

  if (resolution && resolution !== "unknown") {
    return false;
  }

  if (!codecs || codecs === "unknown") {
    return false;
  }

  const hasAudioCodec = /(mp4a|aac|ac-3|ec-3|opus|vorbis|flac|alac|mp3)/.test(codecs);
  const hasVideoCodec = /(avc|hev1|hvc1|vp09|vp9|av01|theora|h264|h265)/.test(codecs);

  return hasAudioCodec && !hasVideoCodec;
}

export function isLikelySoundCloudAudioHls(segmentUrls, playlistText = "", playlistUrl = "") {
  const sample = [
    playlistUrl,
    playlistText,
    ...segmentUrls.slice(0, 5)
  ]
    .join("\n")
    .toLowerCase();

  return (
    sample.includes("soundcloud") &&
    (
      sample.includes("/aac_") ||
      sample.includes("aac_160k") ||
      sample.includes("mp4a") ||
      sample.includes("audio/mp4")
    )
  );
}

export function isLikelyAudioOnlyHlsOutput(segmentUrls, hasInitMap, variant = null, playlistText = "", playlistUrl = "") {
  if (isAudioOnlyVariant(variant)) {
    return true;
  }

  if (isLikelySoundCloudAudioHls(segmentUrls, playlistText, playlistUrl)) {
    return true;
  }

  const sample = [
    playlistUrl,
    playlistText,
    ...segmentUrls.slice(0, 5)
  ]
    .join("\n")
    .toLowerCase();

  if (
    hasInitMap &&
    (
      sample.includes("codecs=\"mp4a") ||
      sample.includes("codecs=mp4a") ||
      sample.includes("audio/mp4") ||
      sample.includes("/aac_")
    )
  ) {
    return true;
  }

  return false;
}

export function getOutputInfo(segmentUrls, hasInitMap, variant = null, playlistText = "", playlistUrl = "") {
  const firstSegmentExtension = getPathnameExtension(segmentUrls[0]);

  const audioOnlyOutput = isLikelyAudioOnlyHlsOutput(
    segmentUrls,
    hasInitMap,
    variant,
    playlistText,
    playlistUrl
  );

  if (hasInitMap) {
    return audioOnlyOutput
      ? {
          extension: ".m4a",
          mimeType: "audio/mp4"
        }
      : {
          extension: ".mp4",
          mimeType: "video/mp4"
        };
  }

  if (firstSegmentExtension === ".aac") {
    return {
      extension: ".aac",
      mimeType: "audio/aac"
    };
  }

  if (firstSegmentExtension === ".mp3") {
    return {
      extension: ".mp3",
      mimeType: "audio/mpeg"
    };
  }

  if (firstSegmentExtension === ".mp4") {
    return audioOnlyOutput
      ? {
          extension: ".m4a",
          mimeType: "audio/mp4"
        }
      : {
          extension: ".mp4",
          mimeType: "video/mp4"
        };
  }

  return audioOnlyOutput
    ? {
        extension: ".m4a",
        mimeType: "audio/mp4"
      }
    : {
        extension: ".ts",
        mimeType: "video/mp2t"
      };
}

function replaceFileExtension(filename, extension) {
  const cleanName = sanitizeFilename(filename || "media.m3u8");
  const withoutQuery = cleanName.split("?")[0].split("#")[0];

  if (withoutQuery.toLowerCase().endsWith(".m3u8")) {
    return withoutQuery.replace(/\.m3u8$/i, extension);
  }

  if (/\.[a-z0-9]{2,5}$/i.test(withoutQuery)) {
    return withoutQuery.replace(/\.[a-z0-9]{2,5}$/i, extension);
  }

  return `${withoutQuery}${extension}`;
}

export function prepareMediaPlaylist(playlistUrl, playlistText, variant = null, variantIndex = null) {
  const encryptionInfo = getUnsupportedEncryptionInfo(playlistText);

  if (encryptionInfo.encrypted) {
    throw new Error(
      `Поток использует шифрование ${encryptionInfo.method}. ` +
      "В этой версии обработка зашифрованных HLS-потоков не поддерживается."
    );
  }

  const initMapUrl = parseMapUrl(playlistText, playlistUrl);
  const segmentUrls = parseSegmentUrls(playlistText, playlistUrl);

  if (segmentUrls.length === 0) {
    throw new Error("В playlist не найдено сегментов.");
  }

  const outputInfo = getOutputInfo(
    segmentUrls,
    Boolean(initMapUrl),
    variant,
    playlistText,
    playlistUrl
  );
  const outputFilename = replaceFileExtension(initialFilename, outputInfo.extension);

  return {
    playlistUrl,
    playlistText,
    variant,
    variantIndex,
    initMapUrl,
    segmentUrls,
    outputInfo,
    outputFilename,
    isLiveLikePlaylist: !playlistText.includes("#EXT-X-ENDLIST")
  };
}
