function closeHlsDownloaderPanel() {
  const existingPanel = document.getElementById(HLS_PANEL_ID);

  if (existingPanel) {
    existingPanel.remove();
  }
}

// Определяет «сайт-источник» по текущему домену. Используется панелью
// HLS, чтобы применить дефолты под конкретный сайт (например, авто-MP3
// и автостарт на SoundCloud). null — сайт без специальных дефолтов.
function getSiteNameForDownloader() {
  const host = window.location.hostname.toLowerCase();

  if (host.includes("soundcloud.com")) {
    return "soundcloud";
  }

  return null;
}

function openHlsDownloaderPanel(mediaItem) {
  if (!mediaItem || !mediaItem.url) return;

  closeHlsDownloaderPanel();
  closeDashDownloaderPanel();

  const fallbackParam = mediaItem.soundCloudFallbackPlaylistId
    ? `&fallbackPlaylistId=${encodeURIComponent(mediaItem.soundCloudFallbackPlaylistId)}`
    : "";

  const site = getSiteNameForDownloader();
  const siteParam = site ? `&site=${encodeURIComponent(site)}` : "";

  const panelUrl =
    chrome.runtime.getURL("hls/hls.html") +
    `?url=${encodeURIComponent(mediaItem.url)}` +
    `&filename=${encodeURIComponent(mediaItem.filename || "media.m3u8")}` +
    fallbackParam +
    siteParam +
    `&embed=1`;

  const iframe = document.createElement("iframe");

  iframe.id = HLS_PANEL_ID;
  iframe.src = panelUrl;
  iframe.allow = "downloads";
  iframe.style.position = "fixed";
  iframe.style.right = "18px";
  iframe.style.bottom = "18px";
  iframe.style.width = "440px";
  iframe.style.height = "430px";
  iframe.style.border = "none";
  iframe.style.borderRadius = "16px";
  iframe.style.background = "#ffffff";
  iframe.style.boxShadow = "0 12px 40px rgba(0, 0, 0, 0.25)";
  iframe.style.zIndex = "2147483646";
  iframe.style.overflow = "hidden";

  document.documentElement.appendChild(iframe);
}

function closeDashDownloaderPanel() {
  const existingPanel = document.getElementById(DASH_PANEL_ID);

  if (existingPanel) {
    existingPanel.remove();
  }
}

function openDashDownloaderPanel(mediaItem) {
  if (!mediaItem || !mediaItem.url) return;

  closeHlsDownloaderPanel();
  closeDashDownloaderPanel();

  const panelUrl =
    chrome.runtime.getURL("dash/dash.html") +
    `?url=${encodeURIComponent(mediaItem.url)}` +
    `&filename=${encodeURIComponent(mediaItem.filename || "media.mpd")}` +
    `&embed=1`;

  const iframe = document.createElement("iframe");

  iframe.id = DASH_PANEL_ID;
  iframe.src = panelUrl;
  iframe.allow = "downloads";
  iframe.style.position = "fixed";
  iframe.style.right = "18px";
  iframe.style.bottom = "18px";
  iframe.style.width = "440px";
  iframe.style.height = "430px";
  iframe.style.border = "none";
  iframe.style.borderRadius = "16px";
  iframe.style.background = "#ffffff";
  iframe.style.boxShadow = "0 12px 40px rgba(0, 0, 0, 0.25)";
  iframe.style.zIndex = "2147483646";
  iframe.style.overflow = "hidden";

  document.documentElement.appendChild(iframe);
}
