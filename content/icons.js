function downloadMedia(mediaItem, buttonElement) {
  if (!mediaItem) return;

  const isHls =
    mediaItem.extension === "m3u8" ||
    mediaItem.streamType === "hls";

  const isDash =
    mediaItem.extension === "mpd" ||
    mediaItem.streamType === "dash";

  if (isHls) {
    buttonElement.textContent = "Открываю HLS...";

    openHlsDownloaderPanel(mediaItem);

    setTimeout(() => {
      buttonElement.innerHTML = getDownloadIconMarkup();
    }, 1200);

    return;
  }

  if (isDash) {
    buttonElement.textContent = "Открываю DASH...";

    openDashDownloaderPanel(mediaItem);

    setTimeout(() => {
      buttonElement.innerHTML = getDownloadIconMarkup();
    }, 1200);

    return;
  }

  chrome.runtime.sendMessage(
    {
      type: "DOWNLOAD_MEDIA",
      url: mediaItem.url,
      filename: mediaItem.filename
    },
    (response) => {
      if (!response || !response.ok) {
        console.warn("[Media Downloader] Download failed:", response?.error || "Unknown error");

        buttonElement.textContent = "Ошибка";

        setTimeout(() => {
          buttonElement.innerHTML = getDownloadIconMarkup();
        }, 1200);

        return;
      }

      buttonElement.textContent = "Скачивается...";

      setTimeout(() => {
        buttonElement.innerHTML = getDownloadIconMarkup();
      }, 1200);
    }
  );
}

function getDownloadIconMarkup() {
  return `
    <span class="md-icon-symbol" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <path
          d="M12 3v11m0 0 4.5-4.5M12 14 7.5 9.5M5 19h14"
          stroke="currentColor"
          stroke-width="2.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </span>
    <span class="md-icon-text">Скачать</span>
  `;
}

function createDownloadIcon(mediaItem) {
  const button = document.createElement("button");

  button.type = "button";
  button.className = "media-downloader-icon";
  button.title = `Скачать ${mediaItem.filename}`;
  button.innerHTML = getDownloadIconMarkup();

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();

    downloadMedia(mediaItem, button);
  });

  return button;
}

function injectStyles() {
  if (document.getElementById("media-downloader-styles")) return;

  const style = document.createElement("style");
  style.id = "media-downloader-styles";

  style.textContent = `

    .media-downloader-media-wrapper {
      position: relative !important;
    }

    .media-downloader-video-wrapper {
      display: inline-block !important;
      line-height: 0 !important;
      max-width: max-content !important;
      vertical-align: top !important;
    }

    .media-downloader-video-button {
      position: absolute !important;
      top: 10px !important;
      right: 10px !important;
      margin-left: 0 !important;

      opacity: 0 !important;
      pointer-events: none !important;
    }

    .media-downloader-video-wrapper:hover .media-downloader-video-button {
      opacity: 1 !important;
      pointer-events: auto !important;
    }

    audio.media-downloader-audio-with-button {
      display: inline-block !important;
      width: calc(100% - 52px) !important;
      max-width: 560px !important;
      vertical-align: middle !important;
    }

    .media-downloader-audio-button {
      position: static !important;
      display: inline-flex !important;
      margin-top: 0 !important;
      margin-left: 8px !important;
      vertical-align: middle !important;
      opacity: 1 !important;
      pointer-events: auto !important;
    }

    .media-downloader-video-button .md-icon-symbol,
    .media-downloader-audio-button .md-icon-symbol {
      background: rgba(255, 255, 255, 0.85) !important;
    }

    .media-downloader-icon {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;

      margin-left: 8px !important;
      padding: 2px 4px !important;

      border: none !important;
      background: transparent !important;
      color: #0f8f52 !important;

      font-family: Arial, sans-serif !important;
      font-size: 14px !important;
      font-weight: 700 !important;
      line-height: 1 !important;

      cursor: pointer !important;
      vertical-align: middle !important;
      white-space: nowrap !important;

      transition:
        background 0.18s ease,
        color 0.18s ease,
        padding 0.18s ease,
        border-radius 0.18s ease,
        opacity 0.18s ease !important;

      z-index: 20 !important;
    }

    .media-downloader-icon .md-icon-symbol {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;

      width: 24px !important;
      height: 24px !important;
      min-width: 24px !important;

      background: rgba(31, 157, 85, 0.12) !important;
      border-radius: 8px !important;
    }

    .media-downloader-icon .md-icon-symbol svg {
      width: 20px !important;
      height: 20px !important;
      display: block !important;
    }

    .media-downloader-icon .md-icon-text {
      display: inline-block !important;
      opacity: 0 !important;
      max-width: 0 !important;
      overflow: hidden !important;
      transition: opacity 0.15s ease, max-width 0.15s ease !important;
    }

    .media-downloader-icon:hover {
      background: #1f9d55 !important;
      color: #ffffff !important;
      padding: 5px 7px !important;
      border-radius: 999px !important;
    }

    .media-downloader-icon:hover .md-icon-symbol {
      background: transparent !important;
    }

    .media-downloader-icon:hover .md-icon-text {
      opacity: 1 !important;
      max-width: 80px !important;
    }

    .media-downloader-ui-disabled .media-downloader-icon {
      display: none !important;
    }

    [data-media-downloader-track] {
      position: relative;
    }

    [data-media-downloader-capturing="true"] {
      outline: 1px dashed rgba(31, 157, 85, 0.35);
      outline-offset: 3px;
    }

    .media-downloader-track-button {
  position: absolute !important;
  top: 10px !important;
  right: 10px !important;
  margin-left: 0 !important;
  z-index: 30 !important;
}

    .media-downloader-soundcloud-track-button {
      position: static !important;
      top: auto !important;
      right: auto !important;
    
      width: 40px !important;
      height: 40px !important;
      min-width: 40px !important;
    
      margin: 0 0 0 8px !important;
      padding: 0 !important;
    
      border: none !important;
      border-radius: 4px !important;
      background: #333333 !important;
      color: #ffffff !important;
    
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
    
      vertical-align: top !important;
      flex: 0 0 auto !important;
    }
    
    .media-downloader-soundcloud-track-button:hover {
      background: #ff5500 !important;
      color: #ffffff !important;
      padding: 0 !important;
      border-radius: 4px !important;
    }
    
    .media-downloader-soundcloud-track-button .md-icon-symbol {
      width: 24px !important;
      height: 24px !important;
      min-width: 24px !important;
      background: transparent !important;
      border-radius: 0 !important;
    }
    
    .media-downloader-soundcloud-track-button .md-icon-symbol svg {
      width: 21px !important;
      height: 21px !important;
    }
    
    .media-downloader-soundcloud-track-button .md-icon-text,
    .media-downloader-soundcloud-track-button:hover .md-icon-text {
      display: none !important;
      opacity: 0 !important;
      max-width: 0 !important;
    }
  `;

  document.documentElement.appendChild(style);
}

function addIconAfterAudioElement(audioElement, mediaItem) {
  if (!audioElement || !audioElement.parentNode) return;

  audioElement.classList.add("media-downloader-audio-with-button");

  const nextElement = audioElement.nextElementSibling;
  const existingIcon =
    nextElement &&
    nextElement.classList &&
    nextElement.classList.contains(MEDIA_DOWNLOADER_ICON_CLASS) &&
    nextElement.classList.contains("media-downloader-audio-button")
      ? nextElement
      : null;

  if (
    audioElement.hasAttribute(ICON_ADDED_ATTRIBUTE) &&
    existingIcon &&
    existingIcon.getAttribute(MEDIA_DOWNLOADER_URL_ATTRIBUTE) === mediaItem.url
  ) {
    return;
  }

  if (existingIcon) {
    existingIcon.remove();
  }

  const icon = createDownloadIcon(mediaItem);

  icon.classList.add("media-downloader-media-button", "media-downloader-audio-button");
  icon.setAttribute(MEDIA_DOWNLOADER_URL_ATTRIBUTE, mediaItem.url);

  audioElement.insertAdjacentElement("afterend", icon);
  audioElement.setAttribute(ICON_ADDED_ATTRIBUTE, "true");
}

function addIconNearLink(linkElement, mediaItem) {
  const nextElement = linkElement.nextElementSibling;
  const existingIcon =
    nextElement && nextElement.classList && nextElement.classList.contains(MEDIA_DOWNLOADER_ICON_CLASS)
      ? nextElement
      : null;

  if (
    linkElement.hasAttribute(ICON_ADDED_ATTRIBUTE) &&
    existingIcon &&
    existingIcon.getAttribute(MEDIA_DOWNLOADER_URL_ATTRIBUTE) === mediaItem.url
  ) {
    return;
  }

  if (existingIcon) {
    existingIcon.remove();
  }

  const icon = createDownloadIcon(mediaItem);
  icon.setAttribute(MEDIA_DOWNLOADER_URL_ATTRIBUTE, mediaItem.url);

  linkElement.insertAdjacentElement("afterend", icon);
  linkElement.setAttribute(ICON_ADDED_ATTRIBUTE, "true");
}

function wrapMediaElementIfNeeded(mediaElement) {
  if (!mediaElement || !mediaElement.parentNode) return null;

  const parent = mediaElement.parentElement;

  if (
    parent &&
    parent.classList &&
    parent.classList.contains("media-downloader-media-wrapper")
  ) {
    return parent;
  }

  const wrapper = document.createElement("span");
  wrapper.className = "media-downloader-media-wrapper media-downloader-video-wrapper";

  mediaElement.parentNode.insertBefore(wrapper, mediaElement);
  wrapper.appendChild(mediaElement);

  return wrapper;
}

function addIconOnMediaElement(mediaElement, mediaItem) {
  if (!mediaElement || !mediaItem) return;

  const tagName = mediaElement.tagName.toLowerCase();

  if (tagName === "audio") {
    addIconAfterAudioElement(mediaElement, mediaItem);
    return;
  }

  if (tagName !== "video") {
    return;
  }

  const wrapper = wrapMediaElementIfNeeded(mediaElement);

  if (!wrapper) return;

  const existingIcon = wrapper.querySelector(
    `.${MEDIA_DOWNLOADER_ICON_CLASS}.media-downloader-video-button`
  );

  if (
    mediaElement.hasAttribute(ICON_ADDED_ATTRIBUTE) &&
    existingIcon &&
    existingIcon.getAttribute(MEDIA_DOWNLOADER_URL_ATTRIBUTE) === mediaItem.url
  ) {
    return;
  }

  if (existingIcon) {
    existingIcon.remove();
  }

  const icon = createDownloadIcon(mediaItem);

  icon.classList.add("media-downloader-media-button", "media-downloader-video-button");
  icon.setAttribute(MEDIA_DOWNLOADER_URL_ATTRIBUTE, mediaItem.url);

  wrapper.appendChild(icon);
  mediaElement.setAttribute(ICON_ADDED_ATTRIBUTE, "true");
}

function isElementReallyVisible(element) {
  if (!element) return false;

  const style = window.getComputedStyle(element);

  if (style.display === "none") return false;
  if (style.visibility === "hidden") return false;
  if (style.opacity === "0") return false;

  const rect = element.getBoundingClientRect();

  if (element.tagName.toLowerCase() === "a") {
    return rect.width > 0 && rect.height > 0;
  }

  return rect.width > 60 && rect.height > 30;
}
