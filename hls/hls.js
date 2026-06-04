const sourceUrlElement = document.getElementById("sourceUrl");
const statusElement = document.getElementById("status");
const detailsElement = document.getElementById("details");
const progressBarElement = document.getElementById("progressBar");
const closeButtonElement = document.getElementById("closeButton");

const params = new URLSearchParams(window.location.search);
const initialPlaylistUrl = params.get("url");
const initialFilename = params.get("filename") || "media.m3u8";
const isEmbedMode = params.get("embed") === "1";

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

async function fetchText(url) {
  const response = await fetch(url, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(`Не удалось загрузить playlist: HTTP ${response.status}`);
  }

  return response.text();
}

async function fetchArrayBuffer(url) {
  const response = await fetch(url, {
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(`Не удалось загрузить сегмент: HTTP ${response.status}`);
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

async function start() {
  if (!initialPlaylistUrl) {
    setStatus("Ошибка: HLS URL не передан.");
    return;
  }

  sourceUrlElement.textContent = initialPlaylistUrl;

  try {
    setStatus("Загружаю HLS playlist...");
    setProgress(4);

    let playlistUrl = initialPlaylistUrl;
    let playlistText = await fetchText(playlistUrl);

    const variants = parseMasterPlaylist(playlistText, playlistUrl);

    if (variants.length > 0) {
      const bestVariant = variants[0];

      setDetails(
        `Найден master playlist.\n` +
        `Выбран лучший вариант:\n` +
        `Bandwidth: ${bestVariant.bandwidth || "unknown"}\n` +
        `Resolution: ${bestVariant.resolution}\n` +
        `Codecs: ${bestVariant.codecs}`
      );

      playlistUrl = bestVariant.url;
      setStatus("Загружаю лучший media playlist...");
      setProgress(8);

      playlistText = await fetchText(playlistUrl);
    }

    const encryptionInfo = getUnsupportedEncryptionInfo(playlistText);

    if (encryptionInfo.encrypted) {
      throw new Error(
        `Поток использует шифрование ${encryptionInfo.method}. ` +
        `В этой версии обработка зашифрованных HLS-потоков не поддерживается.`
      );
    }

    const isLiveLikePlaylist = !playlistText.includes("#EXT-X-ENDLIST");
    const initMapUrl = parseMapUrl(playlistText, playlistUrl);
    const segmentUrls = parseSegmentUrls(playlistText, playlistUrl);

    if (segmentUrls.length === 0) {
      throw new Error("В playlist не найдено сегментов.");
    }

    const outputInfo = getOutputInfo(segmentUrls, Boolean(initMapUrl));
    const outputFilename = replaceFileExtension(initialFilename, outputInfo.extension);

    setDetails(
      `${detailsElement.textContent ? `${detailsElement.textContent}\n\n` : ""}` +
      `Сегментов: ${segmentUrls.length}\n` +
      `Init segment: ${initMapUrl ? "есть" : "нет"}\n` +
      `Тип результата: ${outputInfo.extension}\n` +
      `Имя файла: ${outputFilename}` +
      `${isLiveLikePlaylist ? "\n\nПохоже на live/динамический playlist. Будет сохранён текущий набор сегментов." : ""}`
    );

    const buffers = [];

    if (initMapUrl) {
      setStatus("Загружаю init segment...");
      buffers.push(await fetchArrayBuffer(initMapUrl));
    }

    for (let index = 0; index < segmentUrls.length; index += 1) {
      const segmentUrl = segmentUrls[index];

      setStatus(`Загружаю сегмент ${index + 1} из ${segmentUrls.length}...`);
      setProgress(10 + ((index + 1) / segmentUrls.length) * 80);

      const buffer = await fetchArrayBuffer(segmentUrl);
      buffers.push(buffer);
    }

    setStatus("Собираю файл...");
    setProgress(95);

    const blob = new Blob(buffers, {
      type: outputInfo.mimeType
    });

    await downloadBlob(blob, outputFilename);
  } catch (error) {
    console.error("[HLS Downloader]", error);
    setStatus(`Ошибка: ${error.message}`);
  }
}

start();