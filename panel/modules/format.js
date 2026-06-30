import { formatTime, getHostFromUrl } from "../../shared/format.js";

// Локальный formatStreamType: fallback "Media" (в popup — "media").
export function formatStreamType(stream) {
  if (!stream) return "Media";

  if (stream.type === "hls") return "HLS";
  if (stream.type === "dash") return "DASH";
  if (stream.type === "audio") return "Audio";
  if (stream.type === "video") return "Video";

  return stream.type || "Media";
}

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
  if (stream.foundAt) parts.push(`found: ${formatTime(stream.foundAt)}`);
  if (stream.updatedAt) parts.push(`updated: ${formatTime(stream.updatedAt)}`);

  return parts;
}

export function getScanSummaryParts(scanSummary) {
  if (!scanSummary || !scanSummary.data) return [];

  const data = scanSummary.data;
  const parts = [];

  const directFound =
    Number(data.inlineLinkMediaFound || 0) +
    Number(data.inlineMediaFound || 0);

  parts.push(`прямые media: ${directFound}`);
  parts.push(`видимые ссылки: ${data.visibleLinks || 0}`);
  parts.push(`audio/video элементов: ${data.visibleMediaElements || 0}`);
  parts.push(`кнопок на странице: ${data.buttonsOnPage || 0}`);

  if (data.adapter) {
    parts.push(`adapter: ${data.adapter}`);
  }

  if (scanSummary.updatedAt) {
    parts.push(`обновлено: ${formatTime(scanSummary.updatedAt)}`);
  }

  return parts;
}

export function getDiagnosticMetaParts(diagnostic) {
  if (!diagnostic) return [];

  const parts = [];
  const data = diagnostic.data || {};

  if (diagnostic.code) parts.push(diagnostic.code);
  if (data.adapter) parts.push(`adapter: ${data.adapter}`);
  if (Number.isFinite(Number(data.adapterCandidates)) && Number(data.adapterCandidates) > 0) {
    parts.push(`кандидатов: ${Number(data.adapterCandidates)}`);
  }
  if (data.contentType) parts.push(`type: ${data.contentType}`);
  if (data.statusCode) parts.push(`status: ${data.statusCode}`);
  if (data.trackTitle) parts.push(`track: ${data.trackTitle}`);

  const diagnosticUrl = data.url || data.lastObservedUrl || data.pageUrl;
  if (diagnosticUrl) {
    const host = getHostFromUrl(diagnosticUrl);
    if (host) parts.push(`host: ${host}`);
  }

  if (diagnostic.createdAt) parts.push(formatTime(diagnostic.createdAt));

  return parts;
}
