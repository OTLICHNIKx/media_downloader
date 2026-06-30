document.addEventListener(
  "pointerdown",
  (event) => {
    const target = event.target;

    if (target instanceof Element && target.closest(`.${MEDIA_DOWNLOADER_ICON_CLASS}`)) {
      return;
    }

    const trackElement = findTrackCandidateFromTarget(target);
    if (!trackElement) return;

    startStreamCaptureForTrack(trackElement, "pointerdown");
  },
  true
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "RESCAN_MEDIA_DOWNLOADER_PAGE") {
    try {
      scanAndAddIcons();

      sendResponse({
        ok: true,
        media: collectMediaLinks()
      });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error.message || "Rescan failed"
      });
    }

    return;
  }

  if (message.type === "SCAN_MEDIA") {
    const media = collectMediaLinks();

    sendResponse({
      ok: true,
      media
    });

    return;
  }

  if (message.type === "SET_MEDIA_DOWNLOADER_UI") {
    applyMediaDownloaderUiState(Boolean(message.enabled));

    sendResponse({
      ok: true,
      enabled: Boolean(message.enabled)
    });

    return;
  }

  if (message.type === "MEDIA_DOWNLOADER_CAPTURED_STREAM") {
    const captureId = message.captureId;
    const stream = message.stream;

    const trackElement = Array.from(
      document.querySelectorAll(`[${TRACK_CAPTURE_ATTRIBUTE}]`)
    ).find((element) => {
      return element.getAttribute(TRACK_CAPTURE_ATTRIBUTE) === captureId;
    });

    if (!trackElement) {
      sendResponse({
        ok: false,
        error: "Track element not found for captureId"
      });

      return;
    }

    const mediaItem = buildStreamMediaItem(stream, "captured-stream");

    if (!mediaItem) {
      reportMediaDownloaderDiagnostic(
        "captured-audio-fragment-not-full-file",
        "Пойманный поток похож на fragment/segment и не будет показан как прямое скачивание.",
        {
          adapter: trackElement.getAttribute(TRACK_ADAPTER_ATTRIBUTE) || null,
          trackTitle: getTrackTitle(trackElement),
          url: stream?.url || null,
          contentType: stream?.contentType || null,
          isFragmentLike: Boolean(stream?.isFragmentLike),
          isManifestLike: Boolean(stream?.isManifestLike)
        },
        {
          throttleMs: 1000
        }
      );

      sendResponse({
        ok: false,
        error: "Captured stream looks like fragment, not downloadable file"
      });

      return;
    }

    const enrichedMediaItem = enrichMediaItemWithTrackMetadata(mediaItem, trackElement);

    addIconOnTrackElement(trackElement, enrichedMediaItem);

    sendResponse({
      ok: true
    });
  }
});

window.addEventListener("message", (event) => {
  const hlsPanel = document.getElementById(HLS_PANEL_ID);
  const dashPanel = document.getElementById(DASH_PANEL_ID);

  if (
    hlsPanel &&
    event.source === hlsPanel.contentWindow &&
    event.data &&
    event.data.source === "MEDIA_DOWNLOADER_HLS" &&
    event.data.type === "CLOSE"
  ) {
    closeHlsDownloaderPanel();
    return;
  }

  if (
    dashPanel &&
    event.source === dashPanel.contentWindow &&
    event.data &&
    event.data.source === "MEDIA_DOWNLOADER_DASH" &&
    event.data.type === "CLOSE"
  ) {
    closeDashDownloaderPanel();
  }
});

loadMediaDownloaderUiState();

installSpaNavigationHooks();

scheduleMediaDownloaderScan(100);
scheduleMediaDownloaderScan(800);
scheduleMediaDownloaderScan(1800);

const observer = new MutationObserver(() => {
  handlePossibleSpaNavigation();
  scheduleMediaDownloaderScan(350);
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

setInterval(() => {
  handlePossibleSpaNavigation();
  scheduleMediaDownloaderScan(300);
}, 3000);
