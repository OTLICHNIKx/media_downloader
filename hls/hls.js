const sourceUrlElement = document.getElementById("sourceUrl");
const statusElement = document.getElementById("status");
const detailsElement = document.getElementById("details");
const progressBarElement = document.getElementById("progressBar");
const closeButtonElement = document.getElementById("closeButton");
const qualityControlsElement = document.getElementById("qualityControls");
const variantSelectElement = document.getElementById("variantSelect");
const downloadButtonElement = document.getElementById("downloadButton");
const cancelDownloadButtonElement = document.getElementById("cancelDownloadButton");

const params = new URLSearchParams(window.location.search);
const initialFallbackPlaylistId = params.get("fallbackPlaylistId") || "";
const initialPlaylistUrl = params.get("url");
const initialFilename = params.get("filename") || "media.m3u8";
const isEmbedMode = params.get("embed") === "1";

let loadedMasterVariants = [];
let preparedDownload = null;
let currentDownloadAbortController = null;

function setControlsVisible(visible) {
  if (qualityControlsElement) {
    qualityControlsElement.hidden = !visible;
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function formatBandwidth(bitsPerSecond) {
  if (!bitsPerSecond) return "bitrate unknown";

  if (bitsPerSecond >= 1_000_000) {
    return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`;
  }

  if (bitsPerSecond >= 1_000) {
    return `${Math.round(bitsPerSecond / 1_000)} Kbps`;
  }

  return `${bitsPerSecond} bps`;
}

function buildVariantLabel(variant, index) {
  const parts = [];

  if (variant.resolution && variant.resolution !== "unknown") {
    parts.push(variant.resolution);
  }

  parts.push(formatBandwidth(variant.bandwidth));

  if (variant.codecs && variant.codecs !== "unknown") {
    parts.push(variant.codecs);
  }

  return `${index + 1}. ${parts.join(" · ")}`;
}

function getHttpErrorMessage(status, targetLabel) {
  if (status === 401) {
    return `Не удалось загрузить ${targetLabel}: HTTP 401. Нужна авторизация или cookies не подошли.`;
  }

  if (status === 403) {
    return `Не удалось загрузить ${targetLabel}: HTTP 403. Сервер запретил доступ. Часто это бывает из-за истёкшей ссылки, referer/cookie-защиты или запрета скачивания.`;
  }

  if (status === 404) {
    return `Не удалось загрузить ${targetLabel}: HTTP 404. Файл или сегмент не найден.`;
  }

  if (status === 410) {
    return `Не удалось загрузить ${targetLabel}: HTTP 410. Ссылка на сегмент устарела.`;
  }

  if (status === 429) {
    return `Не удалось загрузить ${targetLabel}: HTTP 429. Сервер ограничил количество запросов.`;
  }

  if (status >= 500) {
    return `Не удалось загрузить ${targetLabel}: HTTP ${status}. Ошибка на стороне сервера.`;
  }

  return `Не удалось загрузить ${targetLabel}: HTTP ${status}.`;
}

if (isEmbedMode) {
  document.body.classList.add("embed-mode");
}

if (closeButtonElement) {
  closeButtonElement.addEventListener("click", () => {
    window.parent.postMessage(
      {
        source: "MEDIA_DOWNLOADER_HLS",
        type: "CLOSE"
      },
      "*"
    );
  });
}

function setStatus(text) {
  statusElement.textContent = text;
}

function setDetails(text) {
  detailsElement.textContent = text;
}

function setProgress(percent) {
  const safePercent = Math.max(0, Math.min(100, percent));
  progressBarElement.style.width = `${safePercent}%`;
}

function sanitizeFilename(filename) {
  return filename
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceFileExtension(filename, extension) {
  const cleanName = sanitizeFilename(filename || "media.m3u8");
  const withoutQuery = cleanName.split("?")[0].split("#")[0];

  if (withoutQuery.toLowerCase().endsWith(".m3u8")) {
    return withoutQuery.replace(/\.m3u8$/i, extension);
  }

  if (/\.[a-z0-9]{2,5}$/i.test(withoutQuery)) {
    return withoutQuery.replace(/\.[a-z0-9]{2,5}$/i, extension);
  }

  return `${withoutQuery}${extension}`;
}

function resolveUrl(baseUrl, maybeRelativeUrl) {
  return new URL(maybeRelativeUrl, baseUrl).href;
}

function parseAttributeList(attributeText) {
  const result = {};
  const parts = [];

  let current = "";
  let insideQuotes = false;

  for (const char of attributeText) {
    if (char === '"') {
      insideQuotes = !insideQuotes;
      current += char;
      continue;
    }

    if (char === "," && !insideQuotes) {
      parts.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current) {
    parts.push(current);
  }

  parts.forEach((part) => {
    const index = part.indexOf("=");
    if (index === -1) return;

    const key = part.slice(0, index).trim();
    let value = part.slice(index + 1).trim();

    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  });

  return result;
}

async function fetchText(url, options = {}) {
  let response;

  try {
    response = await fetch(url, {
      credentials: "include",
      signal: options.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }

    throw new Error(
      `Не удалось выполнить запрос playlist. Возможна сетевая ошибка или CORS. ${error.message}`
    );
  }

  if (!response.ok) {
    throw new Error(getHttpErrorMessage(response.status, "playlist"));
  }

  return response.text();
}

function isAuthLikePlaylistError(error) {
  const message = String(error?.message || "");

  return (
    message.includes("HTTP 401") ||
    message.includes("HTTP 403")
  );
}

function getSoundCloudFallbackPlaylist(fallbackPlaylistId) {
  return new Promise((resolve, reject) => {
    if (!fallbackPlaylistId) {
      reject(new Error("SoundCloud fallback playlist id не передан."));
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: "GET_SOUNDCLOUD_FALLBACK_PLAYLIST",
        fallbackPlaylistId
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        if (!response || !response.ok) {
          reject(new Error(response?.error || "SoundCloud fallback playlist недоступен."));
          return;
        }

        resolve(response);
      }
    );
  });
}

async function fetchHlsPlaylistResourceWithFallback(url, options = {}) {
  try {
    return await fetchHlsPlaylistResource(url, options);
  } catch (error) {
    if (!initialFallbackPlaylistId || !isAuthLikePlaylistError(error)) {
      throw error;
    }

    const fallback = await getSoundCloudFallbackPlaylist(initialFallbackPlaylistId);

    return {
      playlistUrl: fallback.playlistUrl,
      playlistText: fallback.playlistText,
      resolvedFrom: url,
      isFallback: true,
      fallback
    };
  }
}

function buildFallbackDetails(resource) {
  if (!resource?.isFallback || !resource.fallback) {
    return "";
  }

  const lines = [
    "SoundCloud fallback: включён",
    `Источник: ${resource.fallback.source}`,
    `Качество: ${resource.fallback.qualityLabel || "unknown"}`,
    `Поймано сегментов: ${resource.fallback.segmentCount}`,
    ""
  ];

  if (resource.fallback.warning) {
    lines.push(resource.fallback.warning);
    lines.push("");
  }

  return lines.join("\n");
}

function isLikelyHlsPlaylistText(text) {
  const cleanText = String(text || "").trim();

  return (
    cleanText.startsWith("#EXTM3U") ||
    cleanText.includes("#EXT-X-STREAM-INF") ||
    cleanText.includes("#EXTINF")
  );
}

function collectJsonStringCandidates(value, path = "", result = []) {
  if (typeof value === "string") {
    result.push({
      value,
      path
    });

    return result;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectJsonStringCandidates(item, `${path}[${index}]`, result);
    });

    return result;
  }

  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      collectJsonStringCandidates(item, path ? `${path}.${key}` : key, result);
    });
  }

  return result;
}

function scoreHlsPlaylistCandidate(candidate) {
  const value = String(candidate.value || "").toLowerCase();
  const path = String(candidate.path || "").toLowerCase();

  let score = 0;

  if (path === "url") score += 50;
  if (path.includes("hls")) score += 40;
  if (path.includes("aac")) score += 20;
  if (path.includes("playlist")) score += 20;
  if (path.includes("stream")) score += 10;

  if (value.includes(".m3u8")) score += 100;
  if (value.includes("/playlist")) score += 40;
  if (value.includes("/hls")) score += 30;
  if (value.startsWith("http://") || value.startsWith("https://")) score += 20;

  return score;
}

function extractHlsPlaylistUrlFromJsonText(text, baseUrl) {
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }

  const candidates = collectJsonStringCandidates(data)
    .filter((candidate) => {
      const value = String(candidate.value || "").toLowerCase();

      return (
        value.startsWith("http://") ||
        value.startsWith("https://") ||
        value.includes(".m3u8") ||
        value.includes("/playlist") ||
        value.includes("/hls")
      );
    })
    .map((candidate) => {
      return {
        ...candidate,
        score: scoreHlsPlaylistCandidate(candidate)
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return null;
  }

  try {
    return resolveUrl(baseUrl, candidates[0].value);
  } catch {
    return null;
  }
}

async function fetchHlsPlaylistResource(url, options = {}) {
  const firstText = await fetchText(url, options);

  if (isLikelyHlsPlaylistText(firstText)) {
    return {
      playlistUrl: url,
      playlistText: firstText,
      resolvedFrom: null
    };
  }

  const resolvedPlaylistUrl = extractHlsPlaylistUrlFromJsonText(firstText, url);

  if (!resolvedPlaylistUrl) {
    throw new Error(
      "URL не вернул HLS playlist и не содержит JSON-поля с HLS playlist URL."
    );
  }

  const playlistText = await fetchText(resolvedPlaylistUrl, options);

  if (!isLikelyHlsPlaylistText(playlistText)) {
    throw new Error(
      "Развернутый URL получен, но его ответ не похож на HLS playlist."
    );
  }

  return {
    playlistUrl: resolvedPlaylistUrl,
    playlistText,
    resolvedFrom: url
  };
}

function buildPlaylistSourceDetails(resource) {
  if (!resource || !resource.resolvedFrom) {
    return "";
  }

  return [
    `API endpoint: ${resource.resolvedFrom}`,
    `Resolved playlist: ${resource.playlistUrl}`,
    ""
  ].join("\n");
}

async function fetchArrayBuffer(url, options = {}) {
  const targetLabel = options.label || "сегмент";
  let response;

  try {
    response = await fetch(url, {
      credentials: "include",
      signal: options.signal
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw error;
    }

    throw new Error(
      `Не удалось выполнить запрос ${targetLabel}. Возможна сетевая ошибка или CORS. ${error.message}`
    );
  }

  if (!response.ok) {
    throw new Error(getHttpErrorMessage(response.status, targetLabel));
  }

  return response.arrayBuffer();
}

function parseMasterPlaylist(text, baseUrl) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const variants = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line.startsWith("#EXT-X-STREAM-INF")) {
      continue;
    }

    const attributesText = line.includes(":") ? line.slice(line.indexOf(":") + 1) : "";
    const attributes = parseAttributeList(attributesText);

    let nextLine = null;

    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      if (!lines[nextIndex].startsWith("#")) {
        nextLine = lines[nextIndex];
        break;
      }
    }

    if (!nextLine) continue;

    variants.push({
      url: resolveUrl(baseUrl, nextLine),
      bandwidth: Number(attributes.BANDWIDTH || 0),
      resolution: attributes.RESOLUTION || "unknown",
      codecs: attributes.CODECS || "unknown"
    });
  }

  variants.sort((a, b) => b.bandwidth - a.bandwidth);

  return variants;
}

function getUnsupportedEncryptionInfo(text) {
  const keyLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("#EXT-X-KEY"));

  for (const line of keyLines) {
    const attributesText = line.includes(":") ? line.slice(line.indexOf(":") + 1) : "";
    const attributes = parseAttributeList(attributesText);
    const method = attributes.METHOD || "UNKNOWN";

    if (method !== "NONE") {
      return {
        encrypted: true,
        method
      };
    }
  }

  return {
    encrypted: false,
    method: null
  };
}

function parseMapUrl(text, baseUrl) {
  const mapLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("#EXT-X-MAP"));

  if (!mapLine) return null;

  const attributesText = mapLine.includes(":") ? mapLine.slice(mapLine.indexOf(":") + 1) : "";
  const attributes = parseAttributeList(attributesText);

  if (!attributes.URI) return null;

  return resolveUrl(baseUrl, attributes.URI);
}

function parseSegmentUrls(text, baseUrl) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .map((line) => resolveUrl(baseUrl, line));
}

function getPathnameExtension(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();

    if (pathname.endsWith(".aac")) return ".aac";
    if (pathname.endsWith(".mp3")) return ".mp3";
    if (pathname.endsWith(".m4s")) return ".mp4";
    if (pathname.endsWith(".mp4")) return ".mp4";
    if (pathname.endsWith(".ts")) return ".ts";

    return null;
  } catch {
    return null;
  }
}

function isAudioOnlyVariant(variant) {
  if (!variant) {
    return false;
  }

  const codecs = String(variant.codecs || "").toLowerCase();
  const resolution = String(variant.resolution || "").toLowerCase();

  if (resolution && resolution !== "unknown") {
    return false;
  }

  if (!codecs || codecs === "unknown") {
    return false;
  }

  const hasAudioCodec = /(mp4a|aac|ac-3|ec-3|opus|vorbis|flac|alac|mp3)/.test(codecs);
  const hasVideoCodec = /(avc|hev1|hvc1|vp09|vp9|av01|theora|h264|h265)/.test(codecs);

  return hasAudioCodec && !hasVideoCodec;
}

function isLikelySoundCloudAudioHls(segmentUrls, playlistText = "", playlistUrl = "") {
  const sample = [
    playlistUrl,
    playlistText,
    ...segmentUrls.slice(0, 5)
  ]
    .join("\n")
    .toLowerCase();

  return (
    sample.includes("soundcloud") &&
    (
      sample.includes("/aac_") ||
      sample.includes("aac_160k") ||
      sample.includes("mp4a") ||
      sample.includes("audio/mp4")
    )
  );
}

function isLikelyAudioOnlyHlsOutput(segmentUrls, hasInitMap, variant = null, playlistText = "", playlistUrl = "") {
  if (isAudioOnlyVariant(variant)) {
    return true;
  }

  if (isLikelySoundCloudAudioHls(segmentUrls, playlistText, playlistUrl)) {
    return true;
  }

  const sample = [
    playlistUrl,
    playlistText,
    ...segmentUrls.slice(0, 5)
  ]
    .join("\n")
    .toLowerCase();

  if (
    hasInitMap &&
    (
      sample.includes("codecs=\"mp4a") ||
      sample.includes("codecs=mp4a") ||
      sample.includes("audio/mp4") ||
      sample.includes("/aac_")
    )
  ) {
    return true;
  }

  return false;
}

function getOutputInfo(segmentUrls, hasInitMap, variant = null, playlistText = "", playlistUrl = "") {
  const firstSegmentExtension = getPathnameExtension(segmentUrls[0]);

  const audioOnlyOutput = isLikelyAudioOnlyHlsOutput(
    segmentUrls,
    hasInitMap,
    variant,
    playlistText,
    playlistUrl
  );

  if (hasInitMap) {
    return audioOnlyOutput
      ? {
          extension: ".m4a",
          mimeType: "audio/mp4"
        }
      : {
          extension: ".mp4",
          mimeType: "video/mp4"
        };
  }

  if (firstSegmentExtension === ".aac") {
    return {
      extension: ".aac",
      mimeType: "audio/aac"
    };
  }

  if (firstSegmentExtension === ".mp3") {
    return {
      extension: ".mp3",
      mimeType: "audio/mpeg"
    };
  }

  if (firstSegmentExtension === ".mp4") {
    return audioOnlyOutput
      ? {
          extension: ".m4a",
          mimeType: "audio/mp4"
        }
      : {
          extension: ".mp4",
          mimeType: "video/mp4"
        };
  }

  return audioOnlyOutput
    ? {
        extension: ".m4a",
        mimeType: "audio/mp4"
      }
    : {
        extension: ".ts",
        mimeType: "video/mp2t"
      };
}

async function downloadBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);

  chrome.downloads.download(
    {
      url: objectUrl,
      filename,
      saveAs: true
    },
    (downloadId) => {
      if (chrome.runtime.lastError) {
        setStatus(`Ошибка сохранения: ${chrome.runtime.lastError.message}`);
        URL.revokeObjectURL(objectUrl);
        return;
      }

      setStatus("Файл собран. Скачивание запущено.");
      setProgress(100);

      setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 60_000);
    }
  );
}

function buildPreparedDetails(prepared, progressInfo = null) {
  const lines = [];

  if (prepared.variant) {
    lines.push("Найден master playlist.");
    lines.push(`Выбран вариант: ${buildVariantLabel(prepared.variant, prepared.variantIndex)}`);
    lines.push(`Media playlist: ${prepared.playlistUrl}`);
    lines.push("");
  }

  lines.push(`Сегментов: ${prepared.segmentUrls.length}`);
  lines.push(`Init segment: ${prepared.initMapUrl ? "есть" : "нет"}`);
  lines.push(`Тип результата: ${prepared.outputInfo.extension}`);
  lines.push(`Имя файла: ${prepared.outputFilename}`);
  lines.push("Размер: будет известен во время загрузки");

  if (prepared.isLiveLikePlaylist) {
    lines.push("");
    lines.push(
      "Внимание: playlist похож на live/динамический поток, потому что в нём нет #EXT-X-ENDLIST. " +
      "Будет сохранён только текущий набор сегментов."
    );
  }

  if (progressInfo) {
    lines.push("");
    lines.push(`Загружено сегментов: ${progressInfo.downloadedSegments} из ${prepared.segmentUrls.length}`);
    lines.push(`Загружено данных: ${formatBytes(progressInfo.downloadedBytes)}`);
  }

  return lines.join("\n");
}

function prepareMediaPlaylist(playlistUrl, playlistText, variant = null, variantIndex = null) {
  const encryptionInfo = getUnsupportedEncryptionInfo(playlistText);

  if (encryptionInfo.encrypted) {
    throw new Error(
      `Поток использует шифрование ${encryptionInfo.method}. ` +
      "В этой версии обработка зашифрованных HLS-потоков не поддерживается."
    );
  }

  const initMapUrl = parseMapUrl(playlistText, playlistUrl);
  const segmentUrls = parseSegmentUrls(playlistText, playlistUrl);

  if (segmentUrls.length === 0) {
    throw new Error("В playlist не найдено сегментов.");
  }

  const outputInfo = getOutputInfo(
    segmentUrls,
    Boolean(initMapUrl),
    variant,
    playlistText,
    playlistUrl
  );
  const outputFilename = replaceFileExtension(initialFilename, outputInfo.extension);

  return {
    playlistUrl,
    playlistText,
    variant,
    variantIndex,
    initMapUrl,
    segmentUrls,
    outputInfo,
    outputFilename,
    isLiveLikePlaylist: !playlistText.includes("#EXT-X-ENDLIST")
  };
}

function renderVariantOptions(variants) {
  if (!variantSelectElement) return;

  variantSelectElement.disabled = false;
  variantSelectElement.innerHTML = variants
    .map((variant, index) => {
      return `<option value="${index}">${buildVariantLabel(variant, index)}</option>`;
    })
    .join("");
}

function renderSinglePlaylistOption() {
  if (!variantSelectElement) return;

  variantSelectElement.innerHTML = `<option value="single">Исходный media playlist</option>`;
  variantSelectElement.disabled = true;
}

function getSelectedVariantIndex() {
  if (!variantSelectElement) return 0;

  const selectedIndex = Number(variantSelectElement.value);

  if (Number.isNaN(selectedIndex)) {
    return 0;
  }

  return selectedIndex;
}

function setDownloadUiState(isDownloading) {
  if (downloadButtonElement) {
    downloadButtonElement.disabled = isDownloading || !preparedDownload;
  }

  if (variantSelectElement) {
    variantSelectElement.disabled = isDownloading || loadedMasterVariants.length === 0;
  }

  if (cancelDownloadButtonElement) {
    cancelDownloadButtonElement.hidden = !isDownloading;
  }
}

async function prepareSelectedVariant() {
  if (loadedMasterVariants.length === 0) return;

  const selectedIndex = getSelectedVariantIndex();
  const selectedVariant = loadedMasterVariants[selectedIndex];

  if (!selectedVariant) {
    setStatus("Ошибка: выбранный вариант HLS не найден.");
    return;
  }

  preparedDownload = null;
  setDownloadUiState(false);
  setStatus("Загружаю выбранный media playlist...");
  setProgress(8);

  try {
    const playlistResource = await fetchHlsPlaylistResource(selectedVariant.url);

    preparedDownload = prepareMediaPlaylist(
      playlistResource.playlistUrl,
      playlistResource.playlistText,
      selectedVariant,
      selectedIndex
    );

    setDetails(
      buildPlaylistSourceDetails(playlistResource) +
      buildFallbackDetails(playlistResource) +
      buildPreparedDetails(preparedDownload)
    );

    setStatus("Готово к скачиванию. Выбери качество и нажми «Скачать выбранное».");
    setProgress(0);
    setDownloadUiState(false);
  } catch (error) {
    console.error("[HLS Downloader] prepare variant failed", error);
    setStatus(`Ошибка: ${error.message}`);
    setDetails("");
    setProgress(0);
  }
}

function renderDownloadProgress(prepared, downloadedSegments, downloadedBytes) {
  setDetails(
    buildPreparedDetails(prepared, {
      downloadedSegments,
      downloadedBytes
    })
  );
}

async function startPreparedDownload() {
  if (!preparedDownload || currentDownloadAbortController) return;

  const abortController = new AbortController();
  currentDownloadAbortController = abortController;

  const buffers = [];
  let downloadedBytes = 0;
  let downloadedSegments = 0;

  setDownloadUiState(true);
  setProgress(3);

  try {
    if (preparedDownload.initMapUrl) {
      setStatus("Загружаю init segment...");

      const initBuffer = await fetchArrayBuffer(preparedDownload.initMapUrl, {
        signal: abortController.signal,
        label: "init segment"
      });

      buffers.push(initBuffer);
      downloadedBytes += initBuffer.byteLength;
      renderDownloadProgress(preparedDownload, downloadedSegments, downloadedBytes);
    }

    for (let index = 0; index < preparedDownload.segmentUrls.length; index += 1) {
      const segmentUrl = preparedDownload.segmentUrls[index];

      setStatus(`Загружаю сегмент ${index + 1} из ${preparedDownload.segmentUrls.length}...`);
      setProgress(10 + ((index + 1) / preparedDownload.segmentUrls.length) * 80);

      const buffer = await fetchArrayBuffer(segmentUrl, {
        signal: abortController.signal,
        label: `сегмент ${index + 1}`
      });

      buffers.push(buffer);
      downloadedSegments += 1;
      downloadedBytes += buffer.byteLength;
      renderDownloadProgress(preparedDownload, downloadedSegments, downloadedBytes);
    }

    setStatus("Собираю файл...");
    setProgress(95);

    const blob = new Blob(buffers, {
      type: preparedDownload.outputInfo.mimeType
    });

    setDetails(
      `${buildPreparedDetails(preparedDownload, {
        downloadedSegments,
        downloadedBytes: blob.size
      })}\n\nИтоговый размер: ${formatBytes(blob.size)}`
    );

    await downloadBlob(blob, preparedDownload.outputFilename);
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("Скачивание отменено.");
      setProgress(0);
      return;
    }

    console.error("[HLS Downloader]", error);
    setStatus(`Ошибка: ${error.message}`);
  } finally {
    currentDownloadAbortController = null;
    setDownloadUiState(false);
  }
}

async function initializeHlsDownloader() {
  if (!initialPlaylistUrl) {
    setStatus("Ошибка: HLS URL не передан.");
    return;
  }

  sourceUrlElement.textContent = initialPlaylistUrl;
  setControlsVisible(false);

  try {
    setStatus("Загружаю HLS playlist...");
    setProgress(4);

    const playlistResource = await fetchHlsPlaylistResourceWithFallback(initialPlaylistUrl);

    sourceUrlElement.textContent = playlistResource.resolvedFrom
      ? `${playlistResource.resolvedFrom}\n→ ${playlistResource.playlistUrl}`
      : playlistResource.playlistUrl;

    const variants = parseMasterPlaylist(
      playlistResource.playlistText,
      playlistResource.playlistUrl
    );

    setControlsVisible(true);

    if (variants.length > 0) {
      loadedMasterVariants = variants;
      renderVariantOptions(loadedMasterVariants);
      await prepareSelectedVariant();
      return;
    }

    loadedMasterVariants = [];
    renderSinglePlaylistOption();

    preparedDownload = prepareMediaPlaylist(
      playlistResource.playlistUrl,
      playlistResource.playlistText
    );

    setDetails(
      buildPlaylistSourceDetails(playlistResource) +
      buildFallbackDetails(playlistResource) +
      buildPreparedDetails(preparedDownload)
    );

    setStatus("Готово к скачиванию. Нажми «Скачать выбранное».");
    setProgress(0);
    setDownloadUiState(false);
  } catch (error) {
    console.error("[HLS Downloader]", error);
    setControlsVisible(false);
    setStatus(`Ошибка: ${error.message}`);
    setProgress(0);
  }
}

if (variantSelectElement) {
  variantSelectElement.addEventListener("change", () => {
    prepareSelectedVariant();
  });
}

if (downloadButtonElement) {
  downloadButtonElement.addEventListener("click", () => {
    startPreparedDownload();
  });
}

if (cancelDownloadButtonElement) {
  cancelDownloadButtonElement.addEventListener("click", () => {
    if (currentDownloadAbortController) {
      currentDownloadAbortController.abort();
    }
  });
}

initializeHlsDownloader();