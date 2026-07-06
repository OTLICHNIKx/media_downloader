function getElementText(element) {
  if (!element) return "";

  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel && ariaLabel.trim()) {
    return cleanMetadataText(ariaLabel);
  }

  const title = element.getAttribute("title");
  if (title && title.trim()) {
    return cleanMetadataText(title);
  }

  return cleanMetadataText(element.textContent || "");
}

function findFirstTextBySelectors(rootElement, selectors) {
  if (!rootElement || !selectors || selectors.length === 0) return "";

  for (const selector of selectors) {
    const element = rootElement.querySelector(selector);

    if (!element) continue;

    const text = getElementText(element);

    if (text) {
      return text;
    }
  }

  return "";
}

function getCurrentSiteMediaAdapter() {
  const host = window.location.hostname.toLowerCase();

  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".localhost")
  ) {
    return {
      name: "test",
      cardSelectors: [
        "[data-media-adapter-card]"
      ],
      titleSelectors: [
        "[data-media-title]",
        "[data-adapter-title]",
        ".media-title",
        "h2",
        "h3"
      ],
      authorSelectors: [
        "[data-media-author]",
        "[data-adapter-author]",
        ".media-author"
      ]
    };
  }

  if (host.includes("soundcloud.com")) {
    return {
      name: "soundcloud",
      cardSelectors: [
        ".soundList__item",
        ".trackItem",
        ".systemPlaylistTrackList__item",
        ".listenDetails__trackList .trackItem",
        ".searchList__item",
        ".sound"
      ],
      titleSelectors: [
        ".soundTitle__title span",
        ".soundTitle__title",
        ".trackItem__trackTitle",
        "a[href*='/tracks/']",
        "a[href*='/sets/']"
      ],
      authorSelectors: [
        ".soundTitle__username",
        ".soundTitle__usernameText",
        ".trackItem__username",
        "a[href*='/user-']"
      ]
    };
  }

  if (host === "vk.com" || host.endsWith(".vk.com") || host === "vk.ru" || host.endsWith(".vk.ru")) {
    return {
      name: "vk",
      cardSelectors: [
        ".audio_row",
        "[class*='audio_row']",
        ".AudioRow",
        "[data-testid*='audio']"
      ],
      titleSelectors: [
        ".audio_row__title_inner",
        ".audio_row__title",
        "[class*='audio_row__title']",
        "[class*='AudioRowTitle']"
      ],
      authorSelectors: [
        ".audio_row__performers",
        ".audio_row__artist",
        "[class*='audio_row__performer']",
        "[class*='AudioRowArtist']"
      ]
    };
  }

  if (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "music.youtube.com"
  ) {
    return {
      name: "youtube",
      cardSelectors: [
        "ytd-video-renderer",
        "ytd-rich-item-renderer",
        "ytd-playlist-video-renderer",
        "ytd-compact-video-renderer",
        "ytd-watch-metadata",
        "ytmusic-responsive-list-item-renderer",
        "ytmusic-player-bar"
      ],
      titleSelectors: [
        "#video-title",
        "h1 yt-formatted-string",
        ".title",
        "yt-formatted-string.title",
        "yt-formatted-string[class*='title']"
      ],
      authorSelectors: [
        "#channel-name a",
        "ytd-channel-name a",
        ".byline",
        ".subtitle",
        "yt-formatted-string[class*='subtitle']"
      ]
    };
  }

  return null;
}

function isAdapterCandidateUseful(candidateElement) {
  if (!candidateElement || !(candidateElement instanceof Element)) {
    return false;
  }

  if (candidateElement.closest(`.${MEDIA_DOWNLOADER_ICON_CLASS}`)) {
    return false;
  }

  const rect = candidateElement.getBoundingClientRect();

  if (rect.width < 120 || rect.height < 36) {
    return false;
  }

  const text = cleanMetadataText(candidateElement.textContent || "");

  return text.length >= 3;
}

function getAdapterMetadata(candidateElement, adapter) {
  const explicitTitle =
    candidateElement.getAttribute(TRACK_TITLE_ATTRIBUTE) ||
    candidateElement.getAttribute("aria-label") ||
    candidateElement.getAttribute("title");

  const explicitAuthor =
    candidateElement.getAttribute(TRACK_AUTHOR_ATTRIBUTE) ||
    candidateElement.getAttribute("data-author") ||
    candidateElement.getAttribute("data-artist");

  const title =
    cleanMetadataText(explicitTitle) ||
    findFirstTextBySelectors(candidateElement, adapter.titleSelectors) ||
    getElementText(candidateElement).slice(0, 120);

  const author =
    cleanMetadataText(explicitAuthor) ||
    findFirstTextBySelectors(candidateElement, adapter.authorSelectors);

  return {
    title: cleanMetadataText(title),
    author: cleanMetadataText(author)
  };
}

function markAdapterTrackCandidate(candidateElement, adapter, metadata) {
  if (!candidateElement || !adapter || !metadata || !metadata.title) {
    return;
  }

  const existingParentTrack = candidateElement.parentElement
    ? candidateElement.parentElement.closest("[data-media-downloader-track]")
    : null;

  if (existingParentTrack) {
    return;
  }

  const existingChildTrack = candidateElement.querySelector("[data-media-downloader-track]");

  if (existingChildTrack) {
    return;
  }

  candidateElement.setAttribute("data-media-downloader-track", "");
  candidateElement.setAttribute(TRACK_ADAPTER_ATTRIBUTE, adapter.name);
  candidateElement.setAttribute(TRACK_TITLE_ATTRIBUTE, metadata.title);

  if (metadata.author) {
    candidateElement.setAttribute(TRACK_AUTHOR_ATTRIBUTE, metadata.author);
  }
}

function applyMediaMetadataAdapters() {
  const adapter = getCurrentSiteMediaAdapter();

  if (!adapter) return;

  const selector = adapter.cardSelectors.join(",");

  const candidates = Array.from(document.querySelectorAll(selector))
    .filter((candidateElement) => isAdapterCandidateUseful(candidateElement))
    .sort((a, b) => {
      const rectA = a.getBoundingClientRect();
      const rectB = b.getBoundingClientRect();

      // Сначала видимые сверху страницы, а не просто самые маленькие элементы.
      return rectA.top - rectB.top;
    })
    .slice(0, adapter.name === "soundcloud" ? 300 : 100);

  candidates.forEach((candidateElement) => {
    const metadata = getAdapterMetadata(candidateElement, adapter);

    if (!metadata.title) return;

    markAdapterTrackCandidate(candidateElement, adapter, metadata);
  });
}
