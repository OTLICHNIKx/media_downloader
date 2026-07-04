import { getStreamFilename } from "../../shared/stream-types.js";
import {
  streamsListElement,
  streamsCounterElement,
  filterButtonElements,
  currentFilter,
  currentStreams,
  setStatus
} from "./ui-state.js";
import { formatStreamType, getStreamMetaParts } from "./format.js";

export function getFilteredStreams(streams) {
  if (currentFilter === "all") {
    return streams;
  }

  if (currentFilter === "stream") {
    return streams.filter((stream) => stream.type === "hls" || stream.type === "dash");
  }

  return streams.filter((stream) => stream.type === currentFilter);
}

export function updateFilterButtons() {
  filterButtonElements.forEach((button) => {
    button.classList.toggle("active", button.dataset.streamFilter === currentFilter);
  });
}

export function setStreamsCounter(totalCount, visibleCount) {
  if (!streamsCounterElement) return;

  if (currentFilter === "all") {
    streamsCounterElement.textContent = String(totalCount);
    return;
  }

  streamsCounterElement.textContent = `${visibleCount}/${totalCount}`;
}

function downloadDirectStream(stream, buttonElement) {
  buttonElement.disabled = true;
  buttonElement.textContent = "Старт...";

  chrome.runtime.sendMessage(
    {
      type: "DOWNLOAD_MEDIA",
      url: stream.url,
      filename: getStreamFilename(stream)
    },
    (response) => {
      buttonElement.disabled = false;

      if (!response || !response.ok) {
        buttonElement.textContent = "Ошибка";
        setStatus(response?.error || "Не удалось начать скачивание.");
        return;
      }

      buttonElement.textContent = "Скачать";
      setStatus("Скачивание запущено.");
    }
  );
}

function openStreamTool(stream) {
  const filename = getStreamFilename(stream);

  if (stream.type === "hls") {
    const params = new URLSearchParams({
      url: stream.url,
      filename
    });

    const isSoundCloudAudioHls =
      String(stream.url || "").includes("soundcloud") &&
      (String(stream.extension || "").toLowerCase() === "m3u8" ||
        String(stream.qualityLabel || "").toLowerCase().includes("kbps") ||
        String(stream.contentType || "").toLowerCase().includes("audio/"));

    if (isSoundCloudAudioHls) {
      params.set("outputMode", "mp3");
      params.set("site", "soundcloud");
    }

    chrome.tabs.create({
      url: `${chrome.runtime.getURL("hls/hls.html")}?${params.toString()}`
    });

    return;
  }

  if (stream.type === "dash") {
    chrome.tabs.create({
      url:
        chrome.runtime.getURL("dash/dash.html") +
        `?url=${encodeURIComponent(stream.url)}` +
        `&filename=${encodeURIComponent(filename)}`
    });
  }
}

function createStreamElement(stream) {
  const item = document.createElement("div");
  item.className = "stream-item";

  const main = document.createElement("div");
  main.className = "stream-main";

  const title = document.createElement("div");
  title.className = "stream-title";
  title.textContent = `${formatStreamType(stream)} · .${stream.extension || "?"}`;

  const meta = document.createElement("div");
  meta.className = "stream-meta";

  const parts = getStreamMetaParts(stream);
  meta.textContent = parts.join(" · ");

  const url = document.createElement("div");
  url.className = "stream-url";
  url.textContent = stream.url;

  main.appendChild(title);
  main.appendChild(meta);
  main.appendChild(url);

  const actionButton = document.createElement("button");
  actionButton.className = "stream-action";
  actionButton.type = "button";

  if (stream.type === "hls" || stream.type === "dash") {
    actionButton.textContent = "Открыть";
    actionButton.addEventListener("click", () => {
      openStreamTool(stream);
    });
  } else {
    actionButton.textContent = "Скачать";
    actionButton.addEventListener("click", () => {
      downloadDirectStream(stream, actionButton);
    });
  }

  item.appendChild(main);
  item.appendChild(actionButton);

  return item;
}

export function renderStreams(streams = currentStreams) {
  streamsListElement.innerHTML = "";

  const allStreams = Array.isArray(streams) ? streams : [];
  const filteredStreams = getFilteredStreams(allStreams);

  setStreamsCounter(allStreams.length, filteredStreams.length);
  updateFilterButtons();

  if (allStreams.length === 0) {
    streamsListElement.className = "list-box empty";
    streamsListElement.textContent =
      "Пока ничего не найдено. Нажми Rescan или запусти воспроизведение на странице.";
    return;
  }

  if (filteredStreams.length === 0) {
    streamsListElement.className = "list-box empty";
    streamsListElement.textContent = "В этом фильтре потоков нет.";
    return;
  }

  streamsListElement.className = "list-box";

  filteredStreams.forEach((stream) => {
    streamsListElement.appendChild(createStreamElement(stream));
  });
}
