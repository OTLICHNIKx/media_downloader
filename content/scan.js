function getCurrentSiteHost() {
  return window.location.hostname;
}

function applyMediaDownloaderUiState(enabled) {
  document.documentElement.classList.toggle(
    "media-downloader-ui-disabled",
    !enabled
  );
}

function loadMediaDownloaderUiState() {
  const host = getCurrentSiteHost();

  chrome.storage.local.get(
    {
      disabledSites: {}
    },
    (result) => {
      const disabledSites = result.disabledSites || {};
      const isDisabled = Boolean(disabledSites[host]);

      applyMediaDownloaderUiState(!isDisabled);
    }
  );
}

function getLatestHlsStream(callback) {
  chrome.runtime.sendMessage(
    {
      type: "GET_LATEST_HLS_STREAM"
    },
    (response) => {
      if (chrome.runtime.lastError) {
        callback(null);
        return;
      }

      if (!response || !response.ok || !response.stream) {
        callback(null);
        return;
      }

      callback(response.stream);
    }
  );
}

function cleanupBrokenDownloaderMarks() {
  document.querySelectorAll(`[${ICON_ADDED_ATTRIBUTE}]`).forEach((element) => {
    const tagName = element.tagName.toLowerCase();

    if (tagName === "a") {
      const nextElement = element.nextElementSibling;
      const hasIcon =
        nextElement &&
        nextElement.classList &&
        nextElement.classList.contains(MEDIA_DOWNLOADER_ICON_CLASS);

      if (!hasIcon) {
        element.removeAttribute(ICON_ADDED_ATTRIBUTE);
      }

      return;
    }

    if (tagName === "audio") {
      const nextElement = element.nextElementSibling;
      const hasIcon =
        nextElement &&
        nextElement.classList &&
        nextElement.classList.contains(MEDIA_DOWNLOADER_ICON_CLASS) &&
        nextElement.classList.contains("media-downloader-audio-button");

      if (!hasIcon) {
        element.classList.remove("media-downloader-audio-with-button");
        element.removeAttribute(ICON_ADDED_ATTRIBUTE);
      }

      return;
    }

    if (tagName === "video") {
      const parent = element.parentElement;
      const hasIcon =
        parent &&
        parent.querySelector &&
        parent.querySelector(
          `.${MEDIA_DOWNLOADER_ICON_CLASS}.media-downloader-video-button`
        );

      if (!hasIcon) {
        element.removeAttribute(ICON_ADDED_ATTRIBUTE);
      }
    }
  });
}

function reportMediaDownloaderScanSummary(message, data = {}) {
  const now = Date.now();

  if (now - mediaDownloaderLastScanSummaryReportAt < 1500) {
    return;
  }

  mediaDownloaderLastScanSummaryReportAt = now;

  chrome.runtime.sendMessage(
    {
      type: "REPORT_MEDIA_DOWNLOADER_SCAN_SUMMARY",
      message,
      data
    },
    () => {
      if (chrome.runtime.lastError) {
        // background может быть временно недоступен — игнорируем
      }
    }
  );
}

function reportMediaDownloaderDiagnostic(code, message, data = {}, options = {}) {
  const now = Date.now();
  const throttleMs = Number(options.throttleMs || 3000);

  if (throttleMs > 0 && now - mediaDownloaderLastDiagnosticReportAt < throttleMs) {
    return;
  }

  mediaDownloaderLastDiagnosticReportAt = now;

  chrome.runtime.sendMessage(
    {
      type: "REPORT_MEDIA_DOWNLOADER_DIAGNOSTIC",
      code,
      message,
      data
    },
    () => {
      if (chrome.runtime.lastError) {
        // background может быть временно недоступен — игнорируем
      }
    }
  );
}

function hasVisibleBlobMediaElement() {
  return Array.from(document.querySelectorAll("audio, video")).some((mediaElement) => {
    if (!isElementReallyVisible(mediaElement)) return false;

    const currentSrc = normalizeUrl(mediaElement.currentSrc || "");
    const directSrc = normalizeUrl(mediaElement.getAttribute("src") || "");
    const sourceSrc = normalizeUrl(mediaElement.querySelector("source[src]")?.getAttribute("src") || "");

    return [currentSrc, directSrc, sourceSrc].some((value) => String(value || "").startsWith("blob:"));
  });
}

function reportScanDiagnostics(stats, adapter) {
  if (!stats) return;

  const totalDirectFound = Number(stats.inlineLinkMediaFound || 0) + Number(stats.inlineMediaFound || 0);
  const adapterName = adapter?.name || stats.adapter || null;
  const baseData = {
    host: stats.host || window.location.hostname,
    adapter: adapterName,
    adapterCandidates: Number(stats.adapterCandidates || 0),
    visibleMediaElements: Number(stats.visibleMediaElements || 0),
    visibleLinks: Number(stats.visibleLinks || 0),
    directFound: totalDirectFound,
    buttonsOnPage: Number(stats.buttonsOnPage || 0),
    latestHlsChecks: Number(stats.latestHlsChecks || 0),
    pageUrl: window.location.href
  };

  if (adapterName && baseData.adapterCandidates > 0 && totalDirectFound === 0) {
    reportMediaDownloaderDiagnostic(
      "adapter-detected-no-direct-media",
      `Адаптер ${adapterName} найден, но прямые media-элементы не обнаружены.`,
      baseData,
      {
        throttleMs: 1000
      }
    );
  }

  if (adapterName && baseData.adapterCandidates > 0 && baseData.buttonsOnPage === 0) {
    reportMediaDownloaderDiagnostic(
      "adapter-candidates-found-no-buttons",
      `На странице есть кандидаты адаптера ${adapterName}, но inline-кнопки не добавлены.`,
      baseData,
      {
        throttleMs: 1000
      }
    );
  }

  if (baseData.visibleMediaElements > 0 && hasVisibleBlobMediaElement()) {
    reportMediaDownloaderDiagnostic(
      "blob-player-detected",
      "Обнаружен blob/MSE-плеер: прямой media URL может быть недоступен со страницы.",
      baseData,
      {
        throttleMs: 1000
      }
    );
  }

  if (adapterName && totalDirectFound === 0 && baseData.visibleMediaElements > 0) {
    reportMediaDownloaderDiagnostic(
      "site-needs-network-capture",
      `Сайт ${adapterName} показывает media-плеер, но прямой поток нужно ловить через Network/capture.`,
      baseData,
      {
        throttleMs: 1000
      }
    );
  }
}

function cleanupSoundCloudGenericButtons() {
  if (!window.location.hostname.toLowerCase().includes("soundcloud.com")) {
    return;
  }

  // На SoundCloud не должны жить generic audio/video/link-кнопки.
  // Оставляем только кнопки, привязанные к трек-карточкам.
  document
    .querySelectorAll(
      `.${MEDIA_DOWNLOADER_ICON_CLASS}:not(.media-downloader-track-button)`
    )
    .forEach((element) => {
      element.remove();
    });

  document.querySelectorAll(`[${ICON_ADDED_ATTRIBUTE}]`).forEach((element) => {
    element.removeAttribute(ICON_ADDED_ATTRIBUTE);
    element.classList.remove("media-downloader-audio-with-button");
  });
}

function scanAndAddIcons() {
  injectStyles();
  cleanupBrokenDownloaderMarks();

  const adapter = getCurrentSiteMediaAdapter();
  const isSoundCloud = adapter?.name === "soundcloud";

  applyMediaMetadataAdapters();

  if (isSoundCloud) {
    cleanupSoundCloudGenericButtons();
  }

  const stats = {
    host: window.location.hostname,
    adapter: adapter ? adapter.name : null,
    visibleLinks: 0,
    inlineLinkMediaFound: 0,
    visibleMediaElements: 0,
    inlineMediaFound: 0,
    latestHlsChecks: 0,
    adapterCandidates: 0,
    buttonsOnPage: 0
  };

  if (adapter) {
    try {
      stats.adapterCandidates = document.querySelectorAll(
        adapter.cardSelectors.join(",")
      ).length;
    } catch {
      stats.adapterCandidates = 0;
    }
  }

  // SoundCloud streams ловим через capture по клику на трек.
  // Generic a[href]/audio/video renderer на SoundCloud даёт большую белую
  // кнопку в неправильном месте, поэтому для SoundCloud его отключаем.
  if (!isSoundCloud) {
    document.querySelectorAll("a[href]").forEach((linkElement) => {
      if (!isElementReallyVisible(linkElement)) return;

      stats.visibleLinks += 1;

      const mediaItem = buildMediaItem(linkElement.getAttribute("href"), "inline-link");
      if (!mediaItem) return;

      stats.inlineLinkMediaFound += 1;

      addIconNearLink(linkElement, mediaItem);
    });

    document.querySelectorAll("audio, video").forEach((mediaElement) => {
      if (!isElementReallyVisible(mediaElement)) return;

      stats.visibleMediaElements += 1;

      let mediaItem =
        buildMediaItem(mediaElement.currentSrc, "inline-media-current-src") ||
        buildMediaItem(mediaElement.getAttribute("src"), "inline-media-src");

      if (!mediaItem) {
        const sourceElement = mediaElement.querySelector("source[src]");
        if (sourceElement) {
          mediaItem = buildMediaItem(sourceElement.getAttribute("src"), "inline-source");
        }
      }

      if (mediaItem) {
        stats.inlineMediaFound += 1;
        addIconOnMediaElement(mediaElement, mediaItem);
        return;
      }

      if (mediaElement.hasAttribute(ICON_ADDED_ATTRIBUTE)) return;

      const now = Date.now();
      const lastHlsCheckAt = Number(mediaElement.dataset.mediaDownloaderLastHlsCheckAt || 0);

      if (now - lastHlsCheckAt < 2000) return;

      stats.latestHlsChecks += 1;
      mediaElement.dataset.mediaDownloaderLastHlsCheckAt = String(now);

      getLatestHlsStream((stream) => {
        if (!stream || !stream.url) return;
        if (mediaElement.hasAttribute(ICON_ADDED_ATTRIBUTE)) return;
        if (!isElementReallyVisible(mediaElement)) return;

        const hlsItem = buildHlsMediaItem(stream.url, "latest-hls-stream");

        if (!hlsItem) return;

        addIconOnMediaElement(mediaElement, hlsItem);
      });
    });
  }

  stats.buttonsOnPage = document.querySelectorAll(`.${MEDIA_DOWNLOADER_ICON_CLASS}`).length;

  restoreTrackButtonsIfMissing();

  reportScanDiagnostics(stats, adapter);

  const totalDirectFound = stats.inlineLinkMediaFound + stats.inlineMediaFound;

  reportMediaDownloaderScanSummary(
    totalDirectFound > 0
      ? `Текущий скан: прямых media-элементов на странице: ${totalDirectFound}.`
      : "Текущий скан: прямые видимые media-ссылки не найдены. Потоки могут быть найдены через Network/MIME.",
    stats
  );
}

// Bounded debounce (trailing) с max-wait cap.
// Сайты вроде SoundCloud генерируют очень частые DOM-мутации. Обычный debounce
// (clearTimeout + новый таймер) откладывал бы скан бесконечно, пока мутации
// не стихнут — кнопки не появлялись. Здесь вводим max-wait: как только с
// последнего реального скана прошло больше MAX_SCAN_WAIT_MS, запускаем скан
// принудительно, не дожидаясь тишины в DOM.
const MAX_SCAN_WAIT_MS = 1500;

function runScanSafely() {
  try {
    scanAndAddIcons();
  } catch (error) {
    console.warn("[Media Downloader] scan failed:", error);
  } finally {
    mediaDownloaderLastScanRunAt = Date.now();
  }
}

function scheduleMediaDownloaderScan(delay = 250) {
  // Если с последнего скана прошло больше max-wait, форсируем запуск скоро
  // (минимальная задержка, чтобы дать текущей мутации осесть), но не ждём
  // полного delay — иначе при непрерывных мутациях скан бы не запускался.
  const sinceLastScan = Date.now() - mediaDownloaderLastScanRunAt;
  const effectiveDelay = sinceLastScan >= MAX_SCAN_WAIT_MS
    ? Math.min(delay, 50)
    : delay;

  clearTimeout(mediaDownloaderScanTimer);

  mediaDownloaderScanTimer = setTimeout(runScanSafely, effectiveDelay);
}

function resetMediaDownloaderTrackStateForNavigation() {
  // 1. Удаляем все наши кнопки.
  document.querySelectorAll(`.${MEDIA_DOWNLOADER_ICON_CLASS}`).forEach((element) => {
    element.remove();
  });

  // 2. Снимаем отметки "иконка уже добавлена" с media/link элементов.
  document.querySelectorAll(`[${ICON_ADDED_ATTRIBUTE}]`).forEach((element) => {
    element.removeAttribute(ICON_ADDED_ATTRIBUTE);
    element.classList.remove("media-downloader-audio-with-button");
  });

  // 3. ВАЖНО:
  // SoundCloud может переиспользовать DOM-узлы между /all, /tracks, /sets.
  // Поэтому чистим не только кнопки, но и наши track/capture metadata.
  const markedTrackElements = document.querySelectorAll(
    [
      "[data-media-downloader-track]",
      `[${TRACK_CAPTURE_ATTRIBUTE}]`,
      `[${TRACK_BOUND_ATTRIBUTE}]`,
      `[${TRACK_STREAM_URL_ATTRIBUTE}]`,
      `[${TRACK_STREAM_TYPE_ATTRIBUTE}]`,
      `[${TRACK_ADAPTER_ATTRIBUTE}]`
    ].join(",")
  );

  markedTrackElements.forEach((element) => {
    element.removeAttribute("data-media-downloader-track");
    element.removeAttribute(TRACK_CAPTURE_ATTRIBUTE);
    element.removeAttribute(TRACK_STREAM_URL_ATTRIBUTE);
    element.removeAttribute(TRACK_STREAM_TYPE_ATTRIBUTE);
    element.removeAttribute(TRACK_BOUND_ATTRIBUTE);
    element.removeAttribute(TRACK_TITLE_ATTRIBUTE);
    element.removeAttribute(TRACK_AUTHOR_ATTRIBUTE);
    element.removeAttribute(TRACK_ADAPTER_ATTRIBUTE);
    element.removeAttribute("data-media-downloader-capturing");

    delete element.dataset.mediaDownloaderLastCaptureAt;
    delete element.dataset.mediaDownloaderLastHlsCheckAt;
  });

  mediaDownloaderTrackBindings.clear();
  mediaDownloaderCaptureToTrackId.clear();
}

function scheduleMediaDownloaderRescansAfterNavigation() {
  const token = ++mediaDownloaderNavigationScanToken;

  MEDIA_DOWNLOADER_NAVIGATION_RESCAN_DELAYS_MS.forEach((delay) => {
    setTimeout(() => {
      if (token !== mediaDownloaderNavigationScanToken) return;

      runScanSafely();
    }, delay);
  });
}

function handlePossibleSpaNavigation() {
  if (mediaDownloaderLastLocation === window.location.href) {
    return;
  }

  mediaDownloaderLastLocation = window.location.href;

  resetMediaDownloaderTrackStateForNavigation();

  // Сбрасываем точку отсчёта max-wait под новую страницу.
  mediaDownloaderLastScanRunAt = Date.now();

  // SoundCloud рендерит новую вкладку не сразу.
  // Поэтому делаем серию сканов, а не один scan через debounce.
  scheduleMediaDownloaderRescansAfterNavigation();
}

function installSpaNavigationHooks() {
  if (window.__mediaDownloaderSpaNavigationHooksInstalled) return;
  window.__mediaDownloaderSpaNavigationHooksInstalled = true;

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  function afterNavigation() {
    setTimeout(handlePossibleSpaNavigation, 0);
    setTimeout(scheduleMediaDownloaderRescansAfterNavigation, 250);
  }

  history.pushState = function patchedPushState(...args) {
    const result = originalPushState.apply(this, args);
    afterNavigation();
    return result;
  };

  history.replaceState = function patchedReplaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    afterNavigation();
    return result;
  };

  window.addEventListener("popstate", afterNavigation);
  window.addEventListener("hashchange", afterNavigation);

  window.addEventListener("pageshow", () => {
    scheduleMediaDownloaderRescansAfterNavigation();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      scheduleMediaDownloaderRescansAfterNavigation();
    }
  });
}

function collectMediaLinks() {
  const found = new Map();

  function addItem(item) {
    if (!item) return;

    if (!found.has(item.url)) {
      found.set(item.url, item);
    }
  }

  document.querySelectorAll("a[href]").forEach((element) => {
    addItem(buildMediaItem(element.getAttribute("href"), "link"));
  });

  document.querySelectorAll("audio, video").forEach((element) => {
    addItem(buildMediaItem(element.getAttribute("src"), "media-src"));
    addItem(buildMediaItem(element.currentSrc, "media-current-src"));

    element.querySelectorAll("source[src]").forEach((source) => {
      addItem(buildMediaItem(source.getAttribute("src"), "source"));
    });
  });

  try {
    performance.getEntriesByType("resource").forEach((entry) => {
      addItem(buildMediaItem(entry.name, "network-resource"));
    });
  } catch {
    // ignore
  }

  return Array.from(found.values());
}
