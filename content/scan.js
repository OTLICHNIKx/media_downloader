function getCurrentSiteHost() {
  return window.location.hostname;
}

function deactivateMediaDownloaderOnPage() {
  /*
   * Сначала удаляем все созданные расширением кнопки.
   */
  document
    .querySelectorAll(
      [
        `.${MEDIA_DOWNLOADER_ICON_CLASS}`,
        ".media-downloader-sets-button",
        ".media-downloader-inline-sets-button",
        ".media-downloader-inline-sets-slot"
      ].join(",")
    )
    .forEach((element) => {
      element.remove();
    });

  /*
   * Закрываем встроенные панели.
   */
  document
    .getElementById(HLS_PANEL_ID)
    ?.remove();

  document
    .getElementById(DASH_PANEL_ID)
    ?.remove();

  /*
   * Возвращаем video/audio из созданных нами обёрток.
   * Это особенно важно для Twitch.
   */
  document
    .querySelectorAll(
      ".media-downloader-media-wrapper"
    )
    .forEach((wrapper) => {
      const mediaElement =
        wrapper.querySelector(
          ":scope > video, :scope > audio"
        );

      if (
        !mediaElement ||
        !wrapper.parentNode
      ) {
        return;
      }

      wrapper.parentNode.insertBefore(
        mediaElement,
        wrapper
      );

      wrapper.remove();
    });

  document
    .querySelectorAll(
      ".media-downloader-audio-with-button"
    )
    .forEach((element) => {
      element.classList.remove(
        "media-downloader-audio-with-button"
      );
    });

  /*
   * Удаляем служебные атрибуты,
   * но не трогаем обычные атрибуты сайта.
   */
  document
    .querySelectorAll(
      [
        "[data-media-downloader-track]",
        `[${ICON_ADDED_ATTRIBUTE}]`,
        `[${TRACK_CAPTURE_ATTRIBUTE}]`,
        `[${TRACK_STREAM_URL_ATTRIBUTE}]`,
        `[${TRACK_STREAM_TYPE_ATTRIBUTE}]`,
        `[${TRACK_BOUND_ATTRIBUTE}]`,
        `[${TRACK_ADAPTER_ATTRIBUTE}]`,
        `[${TRACK_PERMALINK_ATTRIBUTE}]`
      ].join(",")
    )
    .forEach((element) => {
      element.removeAttribute(
        "data-media-downloader-track"
      );

      element.removeAttribute(
        ICON_ADDED_ATTRIBUTE
      );

      element.removeAttribute(
        TRACK_CAPTURE_ATTRIBUTE
      );

      element.removeAttribute(
        TRACK_STREAM_URL_ATTRIBUTE
      );

      element.removeAttribute(
        TRACK_STREAM_TYPE_ATTRIBUTE
      );

      element.removeAttribute(
        TRACK_BOUND_ATTRIBUTE
      );

      element.removeAttribute(
        TRACK_ADAPTER_ATTRIBUTE
      );

      element.removeAttribute(
        TRACK_PERMALINK_ATTRIBUTE
      );

      element.removeAttribute(
        "data-media-downloader-capturing"
      );

      delete element.dataset
        .mediaDownloaderLastCaptureAt;

      delete element.dataset
        .mediaDownloaderLastHlsCheckAt;
    });

  mediaDownloaderCaptureToTrackId.clear();
}

function applyMediaDownloaderUiState(enabled) {
  mediaDownloaderUiEnabled =
    Boolean(enabled);

  document.documentElement.classList.toggle(
    "media-downloader-ui-disabled",
    !mediaDownloaderUiEnabled
  );

  if (!mediaDownloaderUiEnabled) {
    deactivateMediaDownloaderOnPage();
    return;
  }

  /*
   * После ручного включения сразу запускаем скан.
   */
  if (
    typeof scheduleMediaDownloaderScan ===
    "function"
  ) {
    scheduleMediaDownloaderScan(50);
  }

  if (
    typeof scheduleSetsScan ===
    "function"
  ) {
    scheduleSetsScan(100);
  }
}

function loadMediaDownloaderUiState() {
  const host = getCurrentSiteHost();

  /*
   * Скрываем кнопки сразу, ещё до чтения chrome.storage.
   * Это предотвращает краткое появление кнопок при загрузке страницы.
   */
  applyMediaDownloaderUiState(false);

  chrome.storage.local.get(
    {
      disabledSites: {}
    },
    (result) => {
      const disabledSites = result.disabledSites || {};

      /*
       * Новая логика:
       *
       * undefined — сайт ещё не настроен, кнопки скрыты;
       * true      — кнопки скрыты;
       * false     — пользователь явно разрешил кнопки.
       */
      const isDisabled = disabledSites[host] !== false;

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

function cleanupMediaDownloaderOnBlockedSoundCloudPage() {
  document
    .querySelectorAll(
      [
        `.${MEDIA_DOWNLOADER_ICON_CLASS}`,
        ".media-downloader-inline-sets-button",
        ".media-downloader-inline-sets-slot",
        ".media-downloader-sets-button"
      ].join(",")
    )
    .forEach((element) => {
      element.remove();
    });

  document
    .querySelectorAll("[data-media-downloader-track]")
    .forEach((element) => {
      element.removeAttribute("data-media-downloader-track");
      element.removeAttribute(TRACK_CAPTURE_ATTRIBUTE);
      element.removeAttribute(TRACK_STREAM_URL_ATTRIBUTE);
      element.removeAttribute(TRACK_STREAM_TYPE_ATTRIBUTE);
      element.removeAttribute(TRACK_BOUND_ATTRIBUTE);
      element.removeAttribute(TRACK_ADAPTER_ATTRIBUTE);
      element.removeAttribute(TRACK_PERMALINK_ATTRIBUTE);
      element.removeAttribute("data-media-downloader-capturing");

      delete element.dataset.mediaDownloaderLastCaptureAt;
      delete element.dataset.mediaDownloaderLastHlsCheckAt;
    });
}

function scanAndAddIcons() {

  if (!mediaDownloaderUiEnabled) {
    return;
  }

  injectStyles();
  cleanupBrokenDownloaderMarks();

  if (isSoundCloudDiscoverPage()) {
    cleanupMediaDownloaderOnBlockedSoundCloudPage();
    return;
  }

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

function isMediaDownloaderSoundCloudPage() {
  return window.location.hostname.toLowerCase().includes("soundcloud.com");
}

function resetMediaDownloaderTrackStateForNavigation(options = {}) {
  const preserveTrackBindings = Boolean(options.preserveTrackBindings);

  // 1. Удаляем все наши кнопки из DOM.
  document.querySelectorAll(`.${MEDIA_DOWNLOADER_ICON_CLASS}`).forEach((element) => {
    element.remove();
  });

  // 2. Снимаем отметки "иконка уже добавлена" с media/link элементов.
  document.querySelectorAll(`[${ICON_ADDED_ATTRIBUTE}]`).forEach((element) => {
    element.removeAttribute(ICON_ADDED_ATTRIBUTE);
    element.classList.remove("media-downloader-audio-with-button");
  });

  // 3. SoundCloud/Ember переиспользует DOM-узлы между переходами.
  // Поэтому чистим DOM-атрибуты, но НЕ обязательно чистим память binding'ов.
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

  // ВАЖНО:
  // Для SoundCloud bindings надо сохранять между SPA-ре-рендерами.
  // Иначе при возврате на ту же страницу кнопка исчезает, потому что
  // поток уже был пойман раньше, но привязку trackKey -> mediaItem мы стерли.
  if (!preserveTrackBindings) {
    mediaDownloaderTrackBindings.clear();
  }

  // captureId всегда одноразовый, его можно чистить.
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

function handlePossibleSpaNavigation(options = {}) {
  const forceRescan = Boolean(options.forceRescan);
  const locationChanged = mediaDownloaderLastLocation !== window.location.href;

  // SoundCloud иногда делает повторный SPA-render той же самой страницы:
  // URL не изменился, но DOM уже пересобран и наши кнопки могли исчезнуть.
  // В таком случае не делаем reset, а просто запускаем серию сканов.
  if (!locationChanged) {
    if (forceRescan) {
      scheduleMediaDownloaderRescansAfterNavigation();
    }

    return;
  }

  mediaDownloaderLastLocation = window.location.href;

  resetMediaDownloaderTrackStateForNavigation({
    preserveTrackBindings: isMediaDownloaderSoundCloudPage()
  });

  // Сбрасываем точку отсчёта max-wait под новую страницу.
  mediaDownloaderLastScanRunAt = Date.now();

  scheduleMediaDownloaderRescansAfterNavigation();
}

function installSpaNavigationHooks() {
  if (window.__mediaDownloaderSpaNavigationHooksInstalled) return;
  window.__mediaDownloaderSpaNavigationHooksInstalled = true;

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  function afterHistoryNavigation() {
    // Даже если URL тот же самый, SoundCloud мог пересобрать outlet.
    // Поэтому forceRescan=true запускает повторные сканы без жесткого reset.
    setTimeout(() => {
      handlePossibleSpaNavigation({ forceRescan: true });
    }, 0);

    setTimeout(() => {
      scheduleMediaDownloaderRescansAfterNavigation();
    }, 250);
  }

  history.pushState = function patchedPushState(...args) {
    const result = originalPushState.apply(this, args);
    afterHistoryNavigation();
    return result;
  };

  history.replaceState = function patchedReplaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    afterHistoryNavigation();
    return result;
  };

  window.addEventListener("popstate", afterHistoryNavigation);
  window.addEventListener("hashchange", afterHistoryNavigation);

  window.addEventListener("pageshow", () => {
    handlePossibleSpaNavigation({ forceRescan: true });
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      handlePossibleSpaNavigation({ forceRescan: true });
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
