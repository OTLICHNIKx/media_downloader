import { fetchText } from "../../shared/http.js";
import {
  isLikelyHlsPlaylistText,
  extractHlsPlaylistUrlFromJsonResource
} from "./hls-json.js";
import {
  initialFallbackPlaylistId,
  initialSite,
  initialSoundCloudTrackId,
  initialSoundCloudPermalinkUrl,
  initialSoundCloudClientId,
  initialSoundCloudApiUrl
} from "./ui-state.js";

export function isAuthLikePlaylistError(error) {
  const message = String(error?.message || "");

  return (
    message.includes("HTTP 401") ||
    message.includes("HTTP 403")
  );
}

export function getSoundCloudFallbackPlaylist(fallbackPlaylistId) {
  return new Promise((resolve, reject) => {
    if (!fallbackPlaylistId) {
      reject(new Error("SoundCloud fallback playlist id не передан."));
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: "GET_SOUNDCLOUD_FALLBACK_PLAYLIST",
        fallbackPlaylistId
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response || !response.ok) {
          reject(new Error(response?.error || "SoundCloud fallback playlist недоступен."));
          return;
        }

        resolve(response);
      }
    );
  });
}

function getQueryParamFromUrl(url, name) {
  try {
    return new URL(url).searchParams.get(name) || "";
  } catch {
    return "";
  }
}

function getSoundCloudTrackIdFromUrl(url) {
  if (!url) return "";

  try {
    const decoded = decodeURIComponent(url);
    const match = decoded.match(/soundcloud:tracks:(\d+)/i);

    return match && match[1] ? match[1] : "";
  } catch {
    return "";
  }
}

function resolveSoundCloudTrackHlsFresh() {
  return new Promise((resolve, reject) => {
    const trackId =
      initialSoundCloudTrackId ||
      getSoundCloudTrackIdFromUrl(initialSoundCloudApiUrl);

    const clientId = getQueryParamFromUrl(initialSoundCloudApiUrl, "client_id");

    if (!trackId || !clientId) {
      reject(new Error("Недостаточно данных для fresh SoundCloud resolve."));
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: "RESOLVE_TRACK_HLS",
        trackId,
        clientId
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response || !response.ok) {
          reject(new Error(response?.error || "RESOLVE_TRACK_HLS failed"));
          return;
        }

        if (response.kind !== "hls") {
          reject(
            new Error(
              `SoundCloud вернул не-HLS поток: ${response.kind || "unknown"}`
            )
          );
          return;
        }

        resolve({
          playlistUrl: response.playlistUrl,
          playlistText: response.playlistText,
          resolvedFrom: "soundcloud-fresh-resolve",
          durationMs: response.durationMs || 0
        });
      }
    );
  });
}

export async function fetchHlsPlaylistResource(url, options = {}) {
  const firstText = await fetchText(url, { ...options, label: "playlist" });

  if (isLikelyHlsPlaylistText(firstText)) {
    return {
      playlistUrl: url,
      playlistText: firstText,
      resolvedFrom: null
    };
  }

  const resolvedPlaylistUrl = extractHlsPlaylistUrlFromJsonResource(firstText, url);
  const playlistText = await fetchText(resolvedPlaylistUrl, { ...options, label: "playlist" });

  if (!isLikelyHlsPlaylistText(playlistText)) {
    throw new Error(
      "Развернутый URL получен, но его ответ не похож на HLS playlist."
    );
  }

  return {
    playlistUrl: resolvedPlaylistUrl,
    playlistText,
    resolvedFrom: url
  };
}

export async function fetchHlsPlaylistResourceWithFallback(url, options = {}) {
  if (initialSite === "soundcloud") {
    if (
      initialSoundCloudTrackId ||
      initialSoundCloudPermalinkUrl ||
      initialSoundCloudApiUrl
    ) {
      return resolveSoundCloudTrackHlsFresh();
    }

    throw new Error(
      "SoundCloud solo-трек не привязан к permalink/id. Скачивание остановлено, чтобы не скачать соседний трек."
    );
  }

  try {
    return await fetchHlsPlaylistResource(url, options);
  } catch (error) {
    if (!initialFallbackPlaylistId || !isAuthLikePlaylistError(error)) {
      throw error;
    }

    const fallback = await getSoundCloudFallbackPlaylist(initialFallbackPlaylistId);

    return {
      playlistUrl: fallback.playlistUrl,
      playlistText: fallback.playlistText,
      resolvedFrom: url,
      isFallback: true,
      fallback
    };
  }
}

export function buildFallbackDetails(resource) {
  if (!resource?.isFallback || !resource.fallback) {
    return "";
  }

  const lines = [
    "SoundCloud fallback: включён",
    `Источник: ${resource.fallback.source}`,
    `Качество: ${resource.fallback.qualityLabel || "unknown"}`,
    `Поймано сегментов: ${resource.fallback.segmentCount}`,
    ""
  ];

  if (resource.fallback.warning) {
    lines.push(resource.fallback.warning);
    lines.push("");
  }

  return lines.join("\n");
}

export function buildPlaylistSourceDetails(resource) {
  if (!resource || !resource.resolvedFrom) {
    return "";
  }

  return [
    `API endpoint: ${resource.resolvedFrom}`,
    `Resolved playlist: ${resource.playlistUrl}`,
    ""
  ].join("\n");
}
