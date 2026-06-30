export function isSoundCloudPlaybackHlsEndpoint(url) {
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

export function getSoundCloudHlsStreamInfoFromUrl(url) {
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

export function isSoundCloudPlaybackHost(url) {
  if (!url) return false;

  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "playback.media-streaming.soundcloud.cloud" || host.endsWith(".soundcloud.com") || host.endsWith(".soundcloud.cloud");
  } catch {
    return false;
  }
}

export function getSoundCloudCaptureHint(url) {
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
