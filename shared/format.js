// Общие formatting-хелперы, идентичные во всех копиях (popup/panel/hls/dash).

export function formatTime(timestamp) {
  if (!timestamp) return "";

  const date = new Date(timestamp);

  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function formatBandwidth(bitsPerSecond) {
  if (!bitsPerSecond) return "bitrate unknown";

  if (bitsPerSecond >= 1_000_000) {
    return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`;
  }

  if (bitsPerSecond >= 1_000) {
    return `${Math.round(bitsPerSecond / 1_000)} Kbps`;
  }

  return `${bitsPerSecond} bps`;
}

export function getHostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
