const sourceUrlElement = document.getElementById("sourceUrl");
const statusElement = document.getElementById("status");
const detailsElement = document.getElementById("details");
const progressBarElement = document.getElementById("progressBar");
const closeButtonElement = document.getElementById("closeButton");
const representationControlsElement = document.getElementById("representationControls");
const representationSelectElement = document.getElementById("representationSelect");
const downloadButtonElement = document.getElementById("downloadButton");
const cancelDownloadButtonElement = document.getElementById("cancelDownloadButton");

const params = new URLSearchParams(window.location.search);
const initialMpdUrl = params.get("url");
const initialFilename = params.get("filename") || "media.mpd";
const isEmbedMode = params.get("embed") === "1";

let audioRepresentations = [];
let selectedRepresentation = null;
let currentDownloadAbortController = null;

if (isEmbedMode) {
  document.body.classList.add("embed-mode");
}

if (closeButtonElement) {
  closeButtonElement.addEventListener("click", () => {
    window.parent.postMessage(
      {
        source: "MEDIA_DOWNLOADER_DASH",
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

function setControlsVisible(visible) {
  representationControlsElement.hidden = !visible;
}

function sanitizeFilename(filename) {
  return filename
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function replaceFileExtension(filename, extension) {
  const cleanName = sanitizeFilename(filename || "media.mpd");
  const withoutQuery = cleanName.split("?")[0].split("#")[0];

  if (withoutQuery.toLowerCase().endsWith(".mpd")) {
    return withoutQuery.replace(/\.mpd$/i, extension);
  }

  if (/\.[a-z0-9]{2,5}$/i.test(withoutQuery)) {
    return withoutQuery.replace(/\.[a-z0-9]{2,5}$/i, extension);
  }

  return `${withoutQuery}${extension}`;
}

function resolveUrl(baseUrl, maybeRelativeUrl) {
  return new URL(maybeRelativeUrl, baseUrl).href;
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

function getHttpErrorMessage(status, targetLabel) {
  if (status === 401) {
    return `Не удалось загрузить ${targetLabel}: HTTP 401. Нужна авторизация или cookies не подошли.`;
  }

  if (status === 403) {
    return `Не удалось загрузить ${targetLabel}: HTTP 403. Сервер запретил доступ. Возможно, ссылка устарела или защищена.`;
  }

  if (status === 404) {
    return `Не удалось загрузить ${targetLabel}: HTTP 404. Файл не найден.`;
  }

  if (status === 410) {
    return `Не удалось загрузить ${targetLabel}: HTTP 410. Ссылка устарела.`;
  }

  if (status === 429) {
    return `Не удалось загрузить ${targetLabel}: HTTP 429. Сервер ограничил количество запросов.`;
  }

  if (status >= 500) {
    return `Не удалось загрузить ${targetLabel}: HTTP ${status}. Ошибка на стороне сервера.`;
  }

  return `Не удалось загрузить ${targetLabel}: HTTP ${status}.`;
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
      `Не удалось выполнить запрос MPD. Возможна сетевая ошибка или CORS. ${error.message}`
    );
  }

  if (!response.ok) {
    throw new Error(getHttpErrorMessage(response.status, "MPD"));
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

function parseIsoDurationToSeconds(value) {
  if (!value) return null;

  const match = value.match(
    /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/
  );

  if (!match) return null;

  const years = Number(match[1] || 0);
  const months = Number(match[2] || 0);
  const days = Number(match[3] || 0);
  const hours = Number(match[4] || 0);
  const minutes = Number(match[5] || 0);
  const seconds = Number(match[6] || 0);

  return (
    years * 365 * 24 * 60 * 60 +
    months * 30 * 24 * 60 * 60 +
    days * 24 * 60 * 60 +
    hours * 60 * 60 +
    minutes * 60 +
    seconds
  );
}

function parseXml(text) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, "application/xml");
  const parserError = xml.querySelector("parsererror");

  if (parserError) {
    throw new Error("MPD не удалось разобрать как XML.");
  }

  return xml;
}

function getChildElements(element, tagName) {
  if (!element) return [];

  return Array.from(element.children).filter((child) => {
    return child.localName === tagName;
  });
}

function getFirstChildElement(element, tagName) {
  return getChildElements(element, tagName)[0] || null;
}

function getFirstChildText(element, tagName) {
  const child = getFirstChildElement(element, tagName);
  return child ? child.textContent.trim() : null;
}

function getInheritedAttribute(elements, attributeName) {
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];

    if (element && element.hasAttribute(attributeName)) {
      return element.getAttribute(attributeName);
    }
  }

  return null;
}

function getInheritedSegmentTemplate(representationElement, adaptationSetElement) {
  return (
    getFirstChildElement(representationElement, "SegmentTemplate") ||
    getFirstChildElement(adaptationSetElement, "SegmentTemplate")
  );
}

function getInheritedSegmentList(representationElement, adaptationSetElement) {
  return (
    getFirstChildElement(representationElement, "SegmentList") ||
    getFirstChildElement(adaptationSetElement, "SegmentList")
  );
}

function getSegmentUrlValue(segmentUrlElement) {
  if (!segmentUrlElement) return null;

  return (
    segmentUrlElement.getAttribute("media") ||
    segmentUrlElement.getAttribute("sourceURL") ||
    null
  );
}

function buildSegmentListData(segmentListElement, baseUrl) {
  if (!segmentListElement) return null;

  const initializationElement = getFirstChildElement(segmentListElement, "Initialization");
  const initializationSourceUrl =
    initializationElement &&
    (
      initializationElement.getAttribute("sourceURL") ||
      initializationElement.getAttribute("sourceUrl")
    );

  const initUrl = initializationSourceUrl
    ? resolveUrl(baseUrl, initializationSourceUrl)
    : null;

  const segmentUrls = getChildElements(segmentListElement, "SegmentURL")
    .map((segmentUrlElement) => {
      const mediaUrl = getSegmentUrlValue(segmentUrlElement);

      if (!mediaUrl) return null;

      return resolveUrl(baseUrl, mediaUrl);
    })
    .filter(Boolean);

  if (segmentUrls.length === 0) {
    throw new Error("SegmentList найден, но внутри нет SegmentURL с media/sourceURL.");
  }

  return {
    initUrl,
    segmentUrls
  };
}

function getCombinedBaseUrl(mpdUrl, mpdElement, periodElement, adaptationSetElement, representationElement) {
  let baseUrl = mpdUrl;

  [
    mpdElement,
    periodElement,
    adaptationSetElement,
    representationElement
  ].forEach((element) => {
    const baseText = getFirstChildText(element, "BaseURL");

    if (baseText) {
      baseUrl = resolveUrl(baseUrl, baseText);
    }
  });

  return baseUrl;
}

function padNumber(value, width) {
  const text = String(value);

  if (!width) return text;

  return text.padStart(Number(width), "0");
}

function applyTemplate(template, representation, number, time) {
  return template
    .replace(/\$RepresentationID\$/g, representation.id || "")
    .replace(/\$Bandwidth\$/g, String(representation.bandwidth || ""))
    .replace(/\$Number(?:%0(\d+)d)?\$/g, (match, width) => {
      return padNumber(number, width);
    })
    .replace(/\$Time\$/g, String(time ?? ""));
}

function buildTimelineEntries(segmentTimelineElement, startNumber, timescale, mediaDurationSeconds) {
  const entries = [];
  const segmentElements = getChildElements(segmentTimelineElement, "S");

  let currentTime = 0;
  let currentNumber = startNumber;

  for (let index = 0; index < segmentElements.length; index += 1) {
    const segmentElement = segmentElements[index];
    const duration = Number(segmentElement.getAttribute("d"));
    const explicitTime = segmentElement.getAttribute("t");
    const repeat = Number(segmentElement.getAttribute("r") || 0);

    if (!duration) {
      throw new Error("SegmentTimeline содержит сегмент без duration d.");
    }

    if (explicitTime !== null) {
      currentTime = Number(explicitTime);
    }

    let repeatCount = repeat;

    if (repeat < 0) {
      if (!mediaDurationSeconds) {
        throw new Error(
          "SegmentTimeline использует r=-1, но в MPD нет mediaPresentationDuration. Такой dynamic DASH пока не поддерживается."
        );
      }

      const totalUnits = mediaDurationSeconds * timescale;
      repeatCount = Math.max(0, Math.ceil((totalUnits - currentTime) / duration) - 1);
    }

    for (let repeatIndex = 0; repeatIndex <= repeatCount; repeatIndex += 1) {
      entries.push({
        number: currentNumber,
        time: currentTime
      });

      currentNumber += 1;
      currentTime += duration;
    }
  }

  return entries;
}

function buildNumberEntries(startNumber, timescale, duration, mediaDurationSeconds) {
  if (!duration) {
    throw new Error(
      "В SegmentTemplate нет duration. DASH без SegmentTimeline и duration пока не поддерживается."
    );
  }

  if (!mediaDurationSeconds) {
    throw new Error(
      "В MPD нет mediaPresentationDuration. Нельзя посчитать количество DASH-сегментов."
    );
  }

  const segmentCount = Math.ceil((mediaDurationSeconds * timescale) / duration);

  return Array.from({ length: segmentCount }, (_, index) => {
    return {
      number: startNumber + index,
      time: null
    };
  });
}

function getOutputInfo(representation) {
  const mimeType = representation.mimeType || "";

  if (mimeType.includes("webm")) {
    return {
      extension: ".webm",
      mimeType: "audio/webm"
    };
  }

  if (mimeType.includes("mpeg")) {
    return {
      extension: ".mp3",
      mimeType: "audio/mpeg"
    };
  }

  return {
    extension: ".m4a",
    mimeType: "audio/mp4"
  };
}

function buildRepresentationLabel(representation, index) {
  const parts = [];

  parts.push(formatBandwidth(representation.bandwidth));

  if (representation.codecs) {
    parts.push(representation.codecs);
  }

  if (representation.mimeType) {
    parts.push(representation.mimeType);
  }

  return `${index + 1}. ${parts.join(" · ")}`;
}

function parseAudioRepresentations(mpdText, mpdUrl) {
  const xml = parseXml(mpdText);
  const mpdElement = xml.documentElement;

  const mediaDurationSeconds =
    parseIsoDurationToSeconds(mpdElement.getAttribute("mediaPresentationDuration")) ||
    null;

  const periods = getChildElements(mpdElement, "Period");
  const result = [];

  periods.forEach((periodElement, periodIndex) => {
    const periodDurationSeconds =
      parseIsoDurationToSeconds(periodElement.getAttribute("duration")) ||
      mediaDurationSeconds;

    const adaptationSets = getChildElements(periodElement, "AdaptationSet");

    adaptationSets.forEach((adaptationSetElement, adaptationIndex) => {
      const contentType = adaptationSetElement.getAttribute("contentType") || "";
      const adaptationMimeType = adaptationSetElement.getAttribute("mimeType") || "";
      const adaptationCodecs = adaptationSetElement.getAttribute("codecs") || "";

      const isAudio =
        contentType === "audio" ||
        adaptationMimeType.startsWith("audio/") ||
        adaptationCodecs.startsWith("mp4a") ||
        adaptationCodecs.startsWith("opus") ||
        adaptationCodecs.startsWith("vorbis");

      if (!isAudio) return;

      const representations = getChildElements(adaptationSetElement, "Representation");

      representations.forEach((representationElement, representationIndex) => {
        const segmentTemplate = getInheritedSegmentTemplate(
          representationElement,
          adaptationSetElement
        );

        const segmentList = getInheritedSegmentList(
          representationElement,
          adaptationSetElement
        );

        if (!segmentTemplate && !segmentList) {
          return;
        }

        const id =
          representationElement.getAttribute("id") ||
          `audio-${periodIndex}-${adaptationIndex}-${representationIndex}`;

        const bandwidth = Number(
          representationElement.getAttribute("bandwidth") ||
          adaptationSetElement.getAttribute("bandwidth") ||
          0
        );

        const codecs = getInheritedAttribute(
          [mpdElement, periodElement, adaptationSetElement, representationElement],
          "codecs"
        );

        const mimeType = getInheritedAttribute(
          [mpdElement, periodElement, adaptationSetElement, representationElement],
          "mimeType"
        );

        const representation = {
          id,
          bandwidth,
          codecs,
          mimeType,
          periodIndex,
          adaptationIndex,
          representationIndex
        };

        const baseUrl = getCombinedBaseUrl(
          mpdUrl,
          mpdElement,
          periodElement,
          adaptationSetElement,
          representationElement
        );

        let initUrl = null;
        let segmentUrls = [];
        let segmentSource = "unknown";

        if (segmentTemplate) {
          const initializationTemplate = segmentTemplate.getAttribute("initialization");
          const mediaTemplate = segmentTemplate.getAttribute("media");
          const startNumber = Number(segmentTemplate.getAttribute("startNumber") || 1);
          const timescale = Number(segmentTemplate.getAttribute("timescale") || 1);
          const duration = Number(segmentTemplate.getAttribute("duration") || 0);
          const segmentTimeline = getFirstChildElement(segmentTemplate, "SegmentTimeline");

          if (!mediaTemplate) {
            return;
          }

          const entries = segmentTimeline
            ? buildTimelineEntries(segmentTimeline, startNumber, timescale, periodDurationSeconds)
            : buildNumberEntries(startNumber, timescale, duration, periodDurationSeconds);

          initUrl = initializationTemplate
            ? resolveUrl(
                baseUrl,
                applyTemplate(initializationTemplate, representation, startNumber, null)
              )
            : null;

          segmentUrls = entries.map((entry) => {
            return resolveUrl(
              baseUrl,
              applyTemplate(mediaTemplate, representation, entry.number, entry.time)
            );
          });

          segmentSource = segmentTimeline ? "SegmentTemplate + SegmentTimeline" : "SegmentTemplate";
        } else if (segmentList) {
          const segmentListData = buildSegmentListData(segmentList, baseUrl);

          initUrl = segmentListData.initUrl;
          segmentUrls = segmentListData.segmentUrls;
          segmentSource = "SegmentList";
        }

        result.push({
          ...representation,
          initUrl,
          segmentUrls,
          segmentCount: segmentUrls.length,
          segmentSource,
          outputInfo: getOutputInfo(representation)
        });
      });
    });
  });

  result.sort((a, b) => b.bandwidth - a.bandwidth);

  return result;
}

function renderRepresentationOptions(representations) {
  representationSelectElement.innerHTML = representations
    .map((representation, index) => {
      return `<option value="${index}">${buildRepresentationLabel(representation, index)}</option>`;
    })
    .join("");
}

function getSelectedRepresentationIndex() {
  const selectedIndex = Number(representationSelectElement.value);

  if (Number.isNaN(selectedIndex)) {
    return 0;
  }

  return selectedIndex;
}

function setDownloadUiState(isDownloading) {
  downloadButtonElement.disabled = isDownloading || !selectedRepresentation;
  representationSelectElement.disabled = isDownloading;

  cancelDownloadButtonElement.hidden = !isDownloading;
}

function renderRepresentationDetails(representation, progressInfo = null) {
  const outputFilename = replaceFileExtension(
    initialFilename,
    representation.outputInfo.extension
  );

  const lines = [
    `Representation: ${representation.id}`,
    `Bandwidth: ${formatBandwidth(representation.bandwidth)}`,
    `Codecs: ${representation.codecs || "unknown"}`,
    `MIME: ${representation.mimeType || "unknown"}`,
    `Схема сегментов: ${representation.segmentSource || "unknown"}`,
    `Init segment: ${representation.initUrl ? "есть" : "нет"}`,
    `Сегментов: ${representation.segmentCount}`,
    `Тип результата: ${representation.outputInfo.extension}`,
    `Имя файла: ${outputFilename}`
  ];

  if (progressInfo) {
    lines.push("");
    lines.push(`Загружено сегментов: ${progressInfo.downloadedSegments} из ${representation.segmentCount}`);
    lines.push(`Загружено данных: ${formatBytes(progressInfo.downloadedBytes)}`);
  }

  lines.push("");
  lines.push(
    "Ограничение: сейчас поддерживается только audio-only DASH через SegmentTemplate или SegmentList. " +
    "Видео+аудио без muxing пока не собираются."
  );

  setDetails(lines.join("\n"));
}

function selectCurrentRepresentation() {
  const selectedIndex = getSelectedRepresentationIndex();

  selectedRepresentation = audioRepresentations[selectedIndex] || null;

  if (!selectedRepresentation) {
    setStatus("Ошибка: выбранное audio representation не найдено.");
    setDownloadUiState(false);
    return;
  }

  renderRepresentationDetails(selectedRepresentation);
  setStatus("Готово к скачиванию. Нажми «Скачать выбранное».");
  setProgress(0);
  setDownloadUiState(false);
}

async function downloadBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);

  chrome.downloads.download(
    {
      url: objectUrl,
      filename,
      saveAs: true
    },
    () => {
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

async function startSelectedDownload() {
  if (!selectedRepresentation || currentDownloadAbortController) return;

  const abortController = new AbortController();
  currentDownloadAbortController = abortController;

  const buffers = [];
  let downloadedBytes = 0;
  let downloadedSegments = 0;

  const outputFilename = replaceFileExtension(
    initialFilename,
    selectedRepresentation.outputInfo.extension
  );

  setDownloadUiState(true);
  setProgress(3);

  try {
    if (selectedRepresentation.initUrl) {
      setStatus("Загружаю init segment...");

      const initBuffer = await fetchArrayBuffer(selectedRepresentation.initUrl, {
        signal: abortController.signal,
        label: "init segment"
      });

      buffers.push(initBuffer);
      downloadedBytes += initBuffer.byteLength;

      renderRepresentationDetails(selectedRepresentation, {
        downloadedSegments,
        downloadedBytes
      });
    }

    for (let index = 0; index < selectedRepresentation.segmentUrls.length; index += 1) {
      const segmentUrl = selectedRepresentation.segmentUrls[index];

      setStatus(`Загружаю сегмент ${index + 1} из ${selectedRepresentation.segmentUrls.length}...`);
      setProgress(8 + ((index + 1) / selectedRepresentation.segmentUrls.length) * 84);

      const buffer = await fetchArrayBuffer(segmentUrl, {
        signal: abortController.signal,
        label: `сегмент ${index + 1}`
      });

      buffers.push(buffer);
      downloadedSegments += 1;
      downloadedBytes += buffer.byteLength;

      renderRepresentationDetails(selectedRepresentation, {
        downloadedSegments,
        downloadedBytes
      });
    }

    setStatus("Собираю audio файл...");
    setProgress(95);

    const blob = new Blob(buffers, {
      type: selectedRepresentation.outputInfo.mimeType
    });

    setDetails(
      `${detailsElement.textContent}\n\nИтоговый размер: ${formatBytes(blob.size)}`
    );

    await downloadBlob(blob, outputFilename);
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("Скачивание отменено.");
      setProgress(0);
      return;
    }

    console.error("[DASH Downloader]", error);
    setStatus(`Ошибка: ${error.message}`);
  } finally {
    currentDownloadAbortController = null;
    setDownloadUiState(false);
  }
}

async function initializeDashDownloader() {
  if (!initialMpdUrl) {
    setStatus("Ошибка: DASH MPD URL не передан.");
    return;
  }

  sourceUrlElement.textContent = initialMpdUrl;
  setControlsVisible(false);
  setDownloadUiState(false);

  try {
    setStatus("Загружаю DASH MPD...");
    setProgress(5);

    const mpdText = await fetchText(initialMpdUrl);

    setStatus("Разбираю MPD...");
    setProgress(15);

    audioRepresentations = parseAudioRepresentations(mpdText, initialMpdUrl);

    if (audioRepresentations.length === 0) {
      setStatus("В MPD не найдено audio-only representations, которые можно скачать.");
      setDetails(
        "Сейчас поддерживается только audio AdaptationSet/Representation с SegmentTemplate или SegmentList. " +
        "SegmentBase, DRM и сборка video+audio пока не реализованы."
      );
      setProgress(0);
      return;
    }

    renderRepresentationOptions(audioRepresentations);
    setControlsVisible(true);
    selectCurrentRepresentation();
  } catch (error) {
    console.error("[DASH Downloader]", error);
    setStatus(`Ошибка: ${error.message}`);
    setDetails("");
    setProgress(0);
  }
}

if (representationSelectElement) {
  representationSelectElement.addEventListener("change", () => {
    selectCurrentRepresentation();
  });
}

if (downloadButtonElement) {
  downloadButtonElement.addEventListener("click", () => {
    startSelectedDownload();
  });
}

if (cancelDownloadButtonElement) {
  cancelDownloadButtonElement.addEventListener("click", () => {
    if (currentDownloadAbortController) {
      currentDownloadAbortController.abort();
    }
  });
}

initializeDashDownloader();