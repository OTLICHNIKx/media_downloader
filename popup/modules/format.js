import { formatTime, getHostFromUrl } from "../../shared/format.js";

// Локальный formatStreamType: fallback "media" (в panel — "Media").
export function formatStreamType(stream) {
  if (!stream) return "media";

  if (stream.type === "hls") return "HLS";
  if (stream.type === "dash") return "DASH";
  if (stream.type === "audio") return "Audio";
  if (stream.type === "video") return "Video";

  return stream.type || "media";
}

// Локальный formatBytes: возвращает null для нуля (в hls/dash — "0 B").
export function formatBytes(bytes) {
  const number = Number(bytes);

  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = number;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const formattedValue = value >= 10 ? value.toFixed(1) : value.toFixed(2);

  return `${formattedValue} ${units[unitIndex]}`;
}

export function getStreamMetaParts(stream) {
  const parts = [];

  const host = getHostFromUrl(stream.url);
  const size = formatBytes(stream.contentLength);

  if (stream.contentType) parts.push(stream.contentType);
  if (host) parts.push(host);
  if (stream.qualityLabel) parts.push(stream.qualityLabel);
  if (size) parts.push(size);
  if (stream.statusCode) parts.push(`HTTP ${stream.statusCode}`);
  if (stream.acceptRanges) parts.push(`ranges: ${stream.acceptRanges}`);
  if (stream.source) parts.push(`source: ${stream.source}`);
  if (stream.requestType) parts.push(stream.requestType);
  if (stream.foundAt) parts.push(formatTime(stream.foundAt));

  return parts;
}

export { formatTime };
