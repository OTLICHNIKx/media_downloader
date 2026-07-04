// Дедупликация: JSON-unwrap берётся из shared/hls-json.js
// (background уже использует тот же модуль — задание C/D).
import {
  resolveHlsUrl as resolveUrl,
  extractHlsPlaylistUrlFromJsonText
} from "../../shared/hls-json.js";

export { resolveUrl, extractHlsPlaylistUrlFromJsonText };

export function isLikelyHlsPlaylistText(text) {
  const cleanText = String(text || "").trim();

  return (
    cleanText.startsWith("#EXTM3U") ||
    cleanText.includes("#EXT-X-STREAM-INF") ||
    cleanText.includes("#EXTINF")
  );
}

export function extractHlsPlaylistUrlFromJsonResource(firstText, baseUrl) {
  const resolvedPlaylistUrl = extractHlsPlaylistUrlFromJsonText(firstText, baseUrl);

  if (!resolvedPlaylistUrl) {
    throw new Error(
      "URL не вернул HLS playlist и не содержит JSON-поля с HLS playlist URL."
    );
  }

  return resolvedPlaylistUrl;
}
