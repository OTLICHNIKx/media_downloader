function setDownloadButtonBusy(buttonElement, titleText) {
  if (!buttonElement) return;

  buttonElement.classList.add("is-busy");
  buttonElement.setAttribute("aria-busy", "true");

  if (titleText) {
    buttonElement.title = titleText;
  }

  // Важно: не меняем textContent, чтобы кнопка не превращалась в текст.
  if (!buttonElement.querySelector(".md-icon-symbol")) {
    buttonElement.innerHTML = getDownloadIconMarkup();
  }
}

function resetDownloadButton(buttonElement, mediaItem) {
  if (!buttonElement) return;

  buttonElement.classList.remove("is-busy");
  buttonElement.removeAttribute("aria-busy");

  if (mediaItem?.filename) {
    buttonElement.title = `Скачать ${mediaItem.filename}`;
  }

  if (!buttonElement.querySelector(".md-icon-symbol")) {
    buttonElement.innerHTML = getDownloadIconMarkup();
  }
}

function downloadMedia(mediaItem, buttonElement) {
  if (!mediaItem) return;

  const isHls =
    mediaItem.extension === "m3u8" ||
    mediaItem.streamType === "hls";

  const isDash =
    mediaItem.extension === "mpd" ||
    mediaItem.streamType === "dash";

  if (isHls) {
    setDownloadButtonBusy(buttonElement, "Открываю HLS загрузчик");

    openHlsDownloaderPanel(mediaItem);

    setTimeout(() => {
      resetDownloadButton(buttonElement, mediaItem);
    }, 900);

    return;
  }

  if (isDash) {
    setDownloadButtonBusy(buttonElement, "Открываю DASH загрузчик");

    openDashDownloaderPanel(mediaItem);

    setTimeout(() => {
      resetDownloadButton(buttonElement, mediaItem);
    }, 900);

    return;
  }

  setDownloadButtonBusy(buttonElement, "Скачивание начато");

  chrome.runtime.sendMessage(
    {
      type: "DOWNLOAD_MEDIA",
      url: mediaItem.url,
      filename: mediaItem.filename
    },
    (response) => {
      if (!response || !response.ok) {
        console.warn("[Media Downloader] Download failed:", response?.error || "Unknown error");

        buttonElement.title = "Ошибка скачивания";

        setTimeout(() => {
          resetDownloadButton(buttonElement, mediaItem);
        }, 1200);

        return;
      }

      setTimeout(() => {
        resetDownloadButton(buttonElement, mediaItem);
      }, 900);
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

    .media-downloader-icon {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      margin-left: 8px !important;
      padding: 3px 5px !important;
      border: 1px solid rgba(15, 159, 110, 0.18) !important;
      border-radius: 12px !important;
      background: rgba(255, 255, 255, 0.92) !important;
      color: #087c55 !important;
      box-shadow: 0 8px 22px rgba(8, 23, 35, 0.12) !important;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif !important;
      font-size: 13px !important;
      font-weight: 800 !important;
      line-height: 1 !important;
      cursor: pointer !important;
      vertical-align: middle !important;
      white-space: nowrap !important;
      transition:
        transform 0.16s ease,
        background 0.16s ease,
        color 0.16s ease,
        border-color 0.16s ease,
        opacity 0.16s ease,
        box-shadow 0.16s ease !important;
      z-index: 20 !important;
    }

    .media-downloader-icon .md-icon-symbol {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 24px !important;
      height: 24px !important;
      min-width: 24px !important;
      border-radius: 9px !important;
      background: rgba(15, 159, 110, 0.12) !important;
    }

    .media-downloader-icon .md-icon-symbol svg {
      width: 19px !important;
      height: 19px !important;
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
      transform: translateY(-1px) !important;
      background: #0f9f6e !important;
      border-color: #0f9f6e !important;
      color: #ffffff !important;
      box-shadow: 0 10px 26px rgba(15, 159, 110, 0.24) !important;
    }

    .media-downloader-icon:hover .md-icon-symbol {
      background: rgba(255, 255, 255, 0.16) !important;
    }

    .media-downloader-icon:hover .md-icon-text {
      opacity: 1 !important;
      max-width: 82px !important;
    }

    .media-downloader-ui-disabled .media-downloader-icon {
      display: none !important;
    }

    [data-media-downloader-track] {
      position: relative;
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
      width: 34px !important;
      height: 34px !important;
      min-width: 34px !important;
      margin: 0 0 0 8px !important;
      padding: 0 !important;
      border: 1px solid rgba(15, 159, 110, 0.20) !important;
      border-radius: 11px !important;
      background: #0f9f6e !important;
      color: #ffffff !important;
      box-shadow: 0 8px 20px rgba(15, 159, 110, 0.22) !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      vertical-align: middle !important;
      flex: 0 0 auto !important;
    }

    .media-downloader-soundcloud-track-button:hover {
      background: #087c55 !important;
      border-color: #087c55 !important;
      color: #ffffff !important;
      padding: 0 !important;
      border-radius: 11px !important;
    }

    .media-downloader-soundcloud-track-button .md-icon-symbol {
      width: 22px !important;
      height: 22px !important;
      min-width: 22px !important;
      background: transparent !important;
      border-radius: 0 !important;
    }

    .media-downloader-soundcloud-track-button .md-icon-symbol svg {
      width: 20px !important;
      height: 20px !important;
    }

    .media-downloader-soundcloud-track-button .md-icon-text,
    .media-downloader-soundcloud-track-button:hover .md-icon-text {
      display: none !important;
      opacity: 0 !important;
      max-width: 0 !important;
    }

    .media-downloader-soundcloud-playlist-row-button {
      position: absolute !important;
      top: 50% !important;
      right: 8px !important;
      transform: translateY(-50%) !important;
      margin: 0 !important;
      width: 30px !important;
      height: 30px !important;
      min-width: 30px !important;
      border-radius: 10px !important;
      opacity: 0.92 !important;
    }

    .media-downloader-soundcloud-playlist-row-button:hover {
      transform: translateY(-50%) scale(1.03) !important;
      opacity: 1 !important;
    }

    .media-downloader-soundcloud-playlist-row-button .md-icon-symbol,
    .media-downloader-soundcloud-playlist-row-button .md-icon-symbol svg {
      width: 18px !important;
      height: 18px !important;
      min-width: 18px !important;
    }
    
        /* Manual final green override for all track/media download buttons */
    .media-downloader-icon,
    .media-downloader-media-button,
    .media-downloader-audio-button,
    .media-downloader-video-button,
    .media-downloader-track-button,
    .media-downloader-soundcloud-track-button,
    .media-downloader-soundcloud-playlist-row-button {
      background: #16a34a !important;
      border-color: #16a34a !important;
      color: #ffffff !important;
      box-shadow: 0 8px 20px rgba(22, 163, 74, 0.34) !important;
      font-family: "Segoe UI Variable", "Segoe UI", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Arial, sans-serif !important;
    }

    .media-downloader-icon:hover,
    .media-downloader-media-button:hover,
    .media-downloader-audio-button:hover,
    .media-downloader-video-button:hover,
    .media-downloader-track-button:hover,
    .media-downloader-soundcloud-track-button:hover,
    .media-downloader-soundcloud-playlist-row-button:hover {
      background: #15803d !important;
      border-color: #15803d !important;
      color: #ffffff !important;
      box-shadow: 0 10px 24px rgba(22, 163, 74, 0.42) !important;
    }

    .media-downloader-icon .md-icon-symbol,
    .media-downloader-media-button .md-icon-symbol,
    .media-downloader-audio-button .md-icon-symbol,
    .media-downloader-video-button .md-icon-symbol,
    .media-downloader-track-button .md-icon-symbol,
    .media-downloader-soundcloud-track-button .md-icon-symbol,
    .media-downloader-soundcloud-playlist-row-button .md-icon-symbol {
      background: transparent !important;
      color: #ffffff !important;
      box-shadow: none !important;
      border: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
    }
    
        .media-downloader-icon {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 0 !important;
    }

    .media-downloader-icon .md-icon-symbol {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: auto !important;
      height: auto !important;
      min-width: 0 !important;
      min-height: 0 !important;
      border-radius: 0 !important;
    }

    .media-downloader-icon svg,
    .media-downloader-icon svg *,
    .media-downloader-media-button svg,
    .media-downloader-media-button svg *,
    .media-downloader-track-button svg,
    .media-downloader-track-button svg * {
      color: #ffffff !important;
      stroke: currentColor !important;
    }

    .media-downloader-soundcloud-track-button,
    .media-downloader-soundcloud-playlist-row-button {
      border-radius: 999px !important;
    }
    
        /* Final fix: remove inner square on hover/focus/active */
    .media-downloader-icon .md-icon-symbol,
    .media-downloader-icon:hover .md-icon-symbol,
    .media-downloader-icon:focus .md-icon-symbol,
    .media-downloader-icon:focus-visible .md-icon-symbol,
    .media-downloader-icon:active .md-icon-symbol,
    .media-downloader-media-button .md-icon-symbol,
    .media-downloader-media-button:hover .md-icon-symbol,
    .media-downloader-media-button:focus .md-icon-symbol,
    .media-downloader-media-button:focus-visible .md-icon-symbol,
    .media-downloader-media-button:active .md-icon-symbol,
    .media-downloader-audio-button .md-icon-symbol,
    .media-downloader-audio-button:hover .md-icon-symbol,
    .media-downloader-audio-button:focus .md-icon-symbol,
    .media-downloader-audio-button:focus-visible .md-icon-symbol,
    .media-downloader-audio-button:active .md-icon-symbol,
    .media-downloader-video-button .md-icon-symbol,
    .media-downloader-video-button:hover .md-icon-symbol,
    .media-downloader-video-button:focus .md-icon-symbol,
    .media-downloader-video-button:focus-visible .md-icon-symbol,
    .media-downloader-video-button:active .md-icon-symbol,
    .media-downloader-track-button .md-icon-symbol,
    .media-downloader-track-button:hover .md-icon-symbol,
    .media-downloader-track-button:focus .md-icon-symbol,
    .media-downloader-track-button:focus-visible .md-icon-symbol,
    .media-downloader-track-button:active .md-icon-symbol,
    .media-downloader-soundcloud-track-button .md-icon-symbol,
    .media-downloader-soundcloud-track-button:hover .md-icon-symbol,
    .media-downloader-soundcloud-track-button:focus .md-icon-symbol,
    .media-downloader-soundcloud-track-button:focus-visible .md-icon-symbol,
    .media-downloader-soundcloud-track-button:active .md-icon-symbol {
      background: transparent !important;
      background-color: transparent !important;
      background-image: none !important;
      box-shadow: none !important;
      border: 0 !important;
      outline: 0 !important;
    }

    .media-downloader-icon:hover,
    .media-downloader-icon:focus,
    .media-downloader-icon:focus-visible,
    .media-downloader-icon:active {
      background: #15803d !important;
      background-color: #15803d !important;
      background-image: none !important;
      border-color: #15803d !important;
      outline: none !important;
    }

    .media-downloader-icon:hover *,
    .media-downloader-icon:focus *,
    .media-downloader-icon:focus-visible *,
    .media-downloader-icon:active * {
      background-color: transparent !important;
      background-image: none !important;
      box-shadow: none !important;
    }

    .media-downloader-icon svg,
    .media-downloader-icon:hover svg,
    .media-downloader-icon:focus svg,
    .media-downloader-icon:active svg {
      background: transparent !important;
      background-color: transparent !important;
      background-image: none !important;
    }
    
        /* Final fix: icon buttons never turn into text while opening/downloading */
    .media-downloader-icon.is-busy,
    .media-downloader-icon.is-busy:hover,
    .media-downloader-media-button.is-busy,
    .media-downloader-media-button.is-busy:hover,
    .media-downloader-track-button.is-busy,
    .media-downloader-track-button.is-busy:hover,
    .media-downloader-soundcloud-track-button.is-busy,
    .media-downloader-soundcloud-track-button.is-busy:hover {
      width: 34px !important;
      min-width: 34px !important;
      height: 34px !important;
      min-height: 34px !important;
      padding: 0 !important;
      overflow: hidden !important;
      background: #16a34a !important;
      border-color: #16a34a !important;
      color: #ffffff !important;
    }

    .media-downloader-icon.is-busy .md-icon-text,
    .media-downloader-icon.is-busy:hover .md-icon-text,
    .media-downloader-media-button.is-busy .md-icon-text,
    .media-downloader-media-button.is-busy:hover .md-icon-text,
    .media-downloader-track-button.is-busy .md-icon-text,
    .media-downloader-track-button.is-busy:hover .md-icon-text,
    .media-downloader-soundcloud-track-button.is-busy .md-icon-text,
    .media-downloader-soundcloud-track-button.is-busy:hover .md-icon-text {
      display: none !important;
      opacity: 0 !important;
      max-width: 0 !important;
    }

    .media-downloader-icon.is-busy .md-icon-symbol,
    .media-downloader-icon.is-busy:hover .md-icon-symbol,
    .media-downloader-media-button.is-busy .md-icon-symbol,
    .media-downloader-media-button.is-busy:hover .md-icon-symbol,
    .media-downloader-track-button.is-busy .md-icon-symbol,
    .media-downloader-track-button.is-busy:hover .md-icon-symbol,
    .media-downloader-soundcloud-track-button.is-busy .md-icon-symbol,
    .media-downloader-soundcloud-track-button.is-busy:hover .md-icon-symbol {
      background: transparent !important;
      box-shadow: none !important;
      border: 0 !important;
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