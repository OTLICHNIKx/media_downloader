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

    // Fallback: Ember может ре-рендернуть карточку до того, как background
    // ответил. Оригинальный DOM-узел с captureId выброшен — ищем новую
    // карточку по trackId из персистентной привязки captureId → trackId.
    const resolvedTrackElement = trackElement || (() => {
      const savedTrackId = mediaDownloaderCaptureToTrackId.get(captureId);
      if (!savedTrackId) return null;
      return findTrackElementByTrackId(savedTrackId);
    })();

    if (!resolvedTrackElement) {
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
          adapter: resolvedTrackElement.getAttribute(TRACK_ADAPTER_ATTRIBUTE) || null,
          trackTitle: getTrackTitle(resolvedTrackElement),
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

    const enrichedMediaItem = enrichMediaItemWithTrackMetadata(mediaItem, resolvedTrackElement);

    addIconOnTrackElement(resolvedTrackElement, enrichedMediaItem);

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

// Оповещаем background, что content-script перезагружен.
// При F5 tabId остаётся тем же, но все per-tab state в background
// (capture, streams, resolved URL) устарел — очистим.
chrome.runtime.sendMessage({ type: "CONTENT_SCRIPT_READY" }, () => {
  if (chrome.runtime.lastError) {
    // background может быть временно недоступен — игнорируем
  }
});

installSpaNavigationHooks();

// Стартовая точка отсчёта max-wait: считаем, что «скан» только что
// завершился, чтобы первый запланированный скан шёл со своей нормальной
// задержкой, а не форсировался по cap.
mediaDownloaderLastScanRunAt = Date.now();

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
