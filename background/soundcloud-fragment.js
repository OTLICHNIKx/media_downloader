import {
  soundCloudFragmentGroupsByTabId,
  soundCloudFallbackPlaylistsById,
  soundCloudResolvedByTabId,
  soundCloudResolveInFlightByTabId,
  capturedStreamsByTabId
} from "./state.js";

function hashString(value) {
  let hash = 0;
  const text = String(value || "");

  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36);
}

export function getSoundCloudFragmentInfo(url) {
  if (!url) return null;

  try {
    const parsedUrl = new URL(url);
    const host = parsedUrl.hostname.toLowerCase();

    if (!host.includes("soundcloud.cloud")) {
      return null;
    }

    const parts = decodeURIComponent(parsedUrl.pathname)
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);

    const fileName = parts[parts.length - 1];

    if (!fileName) return null;

    const isInit = fileName.toLowerCase() === "init.mp4";
    const segmentMatch = fileName.toLowerCase().match(/^data(\d+)\.m4s$/);

    if (!isInit && !segmentMatch) {
      return null;
    }

    const qualityIndex = parts.findIndex((part) => /^aac_\d+k$/i.test(part));

    if (qualityIndex <= 0 || qualityIndex + 1 >= parts.length) {
      return null;
    }

    const groupParts = parts.slice(0, qualityIndex + 2);
    const groupKey = `${host}/${groupParts.join("/")}`;

    return {
      groupKey,
      qualityLabel: parts[qualityIndex],
      fileName,
      isInit,
      segmentIndex: segmentMatch ? Number(segmentMatch[1]) : null,
      url
    };
  } catch {
    return null;
  }
}

function getSoundCloudFallbackId(tabId, captureId, groupKey) {
  return `soundcloud-${tabId}-${hashString(`${captureId}:${groupKey}`)}`;
}

function ensureSoundCloudFragmentGroup(tabId, activeCapture, fragmentInfo) {
  if (!soundCloudFragmentGroupsByTabId[tabId]) {
    soundCloudFragmentGroupsByTabId[tabId] = {};
  }

  const fallbackId = getSoundCloudFallbackId(
    tabId,
    activeCapture.captureId,
    fragmentInfo.groupKey
  );

  if (!soundCloudFragmentGroupsByTabId[tabId][fallbackId]) {
    soundCloudFragmentGroupsByTabId[tabId][fallbackId] = {
      id: fallbackId,
      tabId,
      captureId: activeCapture.captureId,
      trackTitle: activeCapture.trackTitle || "media",
      groupKey: fragmentInfo.groupKey,
      qualityLabel: fragmentInfo.qualityLabel || null,
      initUrl: null,
      segmentsByIndex: {},
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  }

  return soundCloudFragmentGroupsByTabId[tabId][fallbackId];
}

export function rememberSoundCloudFragmentFallback(tabId, activeCapture, url) {
  if (!activeCapture || !url) return null;

  const fragmentInfo = getSoundCloudFragmentInfo(url);

  if (!fragmentInfo) {
    return null;
  }

  const group = ensureSoundCloudFragmentGroup(tabId, activeCapture, fragmentInfo);

  if (fragmentInfo.isInit) {
    group.initUrl = fragmentInfo.url;
  } else if (Number.isFinite(fragmentInfo.segmentIndex)) {
    group.segmentsByIndex[String(fragmentInfo.segmentIndex)] = fragmentInfo.url;
  }

  group.updatedAt = Date.now();
  soundCloudFallbackPlaylistsById[group.id] = group;

  return group;
}

export function getSoundCloudGroupSegmentCount(group) {
  if (!group || !group.segmentsByIndex) return 0;

  return Object.keys(group.segmentsByIndex).length;
}

function getBestSoundCloudFallbackForCapture(tabId, captureId) {
  const groups = Object.values(soundCloudFragmentGroupsByTabId[tabId] || {})
    .filter((group) => group.captureId === captureId)
    .filter((group) => group.initUrl && getSoundCloudGroupSegmentCount(group) > 0)
    .sort((a, b) => {
      const segmentDiff = getSoundCloudGroupSegmentCount(b) - getSoundCloudGroupSegmentCount(a);

      if (segmentDiff !== 0) {
        return segmentDiff;
      }

      return b.updatedAt - a.updatedAt;
    });

  return groups[0] || null;
}

function escapeHlsQuotedUri(url) {
  return String(url || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

export function buildSoundCloudObservedPlaylist(group) {
  if (!group || !group.initUrl) {
    return null;
  }

  const segments = Object.entries(group.segmentsByIndex || {})
    .map(([index, url]) => {
      return {
        index: Number(index),
        url
      };
    })
    .filter((segment) => Number.isFinite(segment.index) && segment.url)
    .sort((a, b) => a.index - b.index);

  if (segments.length === 0) {
    return null;
  }

  const firstIndex = segments[0].index;

  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-TARGETDURATION:10",
    `#EXT-X-MEDIA-SEQUENCE:${firstIndex}`,
    `#EXT-X-MAP:URI="${escapeHlsQuotedUri(group.initUrl)}"`
  ];

  segments.forEach((segment) => {
    lines.push("#EXTINF:10.000,");
    lines.push(segment.url);
  });

  return lines.join("\n");
}

export function attachSoundCloudFallbackToCapturedStream(tabId, capturedStream) {
  if (!capturedStream || !capturedStream.captureId) {
    return capturedStream;
  }

  const fallbackGroup = getBestSoundCloudFallbackForCapture(
    tabId,
    capturedStream.captureId
  );

  if (!fallbackGroup) {
    return capturedStream;
  }

  return {
    ...capturedStream,
    soundCloudFallbackPlaylistId: fallbackGroup.id,
    soundCloudFallbackSegmentCount: getSoundCloudGroupSegmentCount(fallbackGroup),
    soundCloudFallbackQuality: fallbackGroup.qualityLabel || null
  };
}

export function resendCapturedStreamWithFallbackIfNeeded(tabId, activeCapture, existingCapturedStream) {
  if (!existingCapturedStream || !activeCapture) {
    return;
  }

  const oldFallbackId = existingCapturedStream.soundCloudFallbackPlaylistId || null;
  const enrichedStream = attachSoundCloudFallbackToCapturedStream(tabId, existingCapturedStream);
  const newFallbackId = enrichedStream.soundCloudFallbackPlaylistId || null;

  if (!newFallbackId || newFallbackId === oldFallbackId) {
    return;
  }

  capturedStreamsByTabId[tabId][activeCapture.captureId] = enrichedStream;

  chrome.tabs.sendMessage(
    tabId,
    {
      type: "MEDIA_DOWNLOADER_CAPTURED_STREAM",
      captureId: activeCapture.captureId,
      stream: enrichedStream
    },
    () => {
      if (chrome.runtime.lastError) {
        // ignore
      }
    }
  );
}

export function cleanupSoundCloudFallbacksForTab(tabId) {
  delete soundCloudFragmentGroupsByTabId[tabId];

  Object.keys(soundCloudFallbackPlaylistsById).forEach((fallbackId) => {
    if (soundCloudFallbackPlaylistsById[fallbackId]?.tabId === tabId) {
      delete soundCloudFallbackPlaylistsById[fallbackId];
    }
  });

  delete soundCloudResolvedByTabId[tabId];
  delete soundCloudResolveInFlightByTabId[tabId];
}
