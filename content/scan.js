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

function scanAndAddIcons() {
  injectStyles();
  cleanupBrokenDownloaderMarks();

  const adapter = getCurrentSiteMediaAdapter();
  applyMediaMetadataAdapters();

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

  stats.buttonsOnPage = document.querySelectorAll(`.${MEDIA_DOWNLOADER_ICON_CLASS}`).length;

  reportScanDiagnostics(stats, adapter);

  const totalDirectFound = stats.inlineLinkMediaFound + stats.inlineMediaFound;

  reportMediaDownloaderScanSummary(
    totalDirectFound > 0
      ? `Текущий скан: прямых media-элементов на странице: ${totalDirectFound}.`
      : "Текущий скан: прямые видимые media-ссылки не найдены. Потоки могут быть найдены через Network/MIME.",
    stats
  );
}

function scheduleMediaDownloaderScan(delay = 250) {
  clearTimeout(mediaDownloaderScanTimer);

  mediaDownloaderScanTimer = setTimeout(() => {
    try {
      scanAndAddIcons();
    } catch (error) {
      console.warn("[Media Downloader] scan failed:", error);
    }
  }, delay);
}

function handlePossibleSpaNavigation() {
  if (mediaDownloaderLastLocation === window.location.href) {
    return;
  }

  mediaDownloaderLastLocation = window.location.href;

  document.querySelectorAll(`[${ICON_ADDED_ATTRIBUTE}]`).forEach((element) => {
    element.removeAttribute(ICON_ADDED_ATTRIBUTE);
  });

  document.querySelectorAll(`.${MEDIA_DOWNLOADER_ICON_CLASS}`).forEach((element) => {
    element.remove();
  });

  scheduleMediaDownloaderScan(400);
  scheduleMediaDownloaderScan(1200);
}

function installSpaNavigationHooks() {
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function patchedPushState(...args) {
    const result = originalPushState.apply(this, args);

    setTimeout(handlePossibleSpaNavigation, 0);
    setTimeout(() => scheduleMediaDownloaderScan(600), 600);

    return result;
  };

  history.replaceState = function patchedReplaceState(...args) {
    const result = originalReplaceState.apply(this, args);

    setTimeout(handlePossibleSpaNavigation, 0);
    setTimeout(() => scheduleMediaDownloaderScan(600), 600);

    return result;
  };

  window.addEventListener("popstate", () => {
    handlePossibleSpaNavigation();
    scheduleMediaDownloaderScan(600);
  });

  window.addEventListener("hashchange", () => {
    handlePossibleSpaNavigation();
    scheduleMediaDownloaderScan(600);
  });

  window.addEventListener("pageshow", () => {
    scheduleMediaDownloaderScan(300);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      scheduleMediaDownloaderScan(300);
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
