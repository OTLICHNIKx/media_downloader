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

function getOutputInfo(segmentUrls, hasInitMap) {
  const firstSegmentExtension = getPathnameExtension(segmentUrls[0]);

  if (hasInitMap) {
    return {
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
    return {
      extension: ".mp4",
      mimeType: "video/mp4"
    };
  }

  return {
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

  const outputInfo = getOutputInfo(segmentUrls, Boolean(initMapUrl));
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
    const playlistText = await fetchText(selectedVariant.url);

    preparedDownload = prepareMediaPlaylist(
      selectedVariant.url,
      playlistText,
      selectedVariant,
      selectedIndex
    );

    setDetails(buildPreparedDetails(preparedDownload));
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

    const playlistText = await fetchText(initialPlaylistUrl);
    const variants = parseMasterPlaylist(playlistText, initialPlaylistUrl);

    setControlsVisible(true);

    if (variants.length > 0) {
      loadedMasterVariants = variants;
      renderVariantOptions(loadedMasterVariants);
      await prepareSelectedVariant();
      return;
    }

    loadedMasterVariants = [];
    renderSinglePlaylistOption();

    preparedDownload = prepareMediaPlaylist(initialPlaylistUrl, playlistText);

    setDetails(buildPreparedDetails(preparedDownload));
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