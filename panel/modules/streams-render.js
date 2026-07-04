import { getStreamFilename } from "../../shared/stream-types.js";
import {
  streamsListElement,
  currentFilter,
  currentStreams
} from "./ui-state.js";
import { formatStreamType, getStreamMetaParts } from "./format.js";

export function getFilteredStreams() {
  if (currentFilter === "all") {
    return currentStreams;
  }

  return currentStreams.filter((stream) => stream.type === currentFilter);
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
        return;
      }

      buttonElement.textContent = "Скачать";
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

function copyStreamUrl(stream, buttonElement) {
  navigator.clipboard.writeText(stream.url).then(() => {
    const oldText = buttonElement.textContent;
    buttonElement.textContent = "Скопировано";

    setTimeout(() => {
      buttonElement.textContent = oldText;
    }, 1000);
  });
}

function createStreamCard(stream) {
  const card = document.createElement("article");
  card.className = "stream-card";

  const content = document.createElement("div");

  const titleRow = document.createElement("div");
  titleRow.className = "stream-title-row";

  const title = document.createElement("div");
  title.className = "stream-type";
  title.textContent = `${formatStreamType(stream)} · .${stream.extension || "?"}`;

  titleRow.appendChild(title);

  if (stream.qualityLabel) {
    const qualityBadge = document.createElement("span");
    qualityBadge.className = "stream-badge";
    qualityBadge.textContent = stream.qualityLabel;
    titleRow.appendChild(qualityBadge);
  }

  const meta = document.createElement("div");
  meta.className = "stream-meta";
  meta.textContent = getStreamMetaParts(stream).join(" · ");

  const url = document.createElement("div");
  url.className = "stream-url";
  url.textContent = stream.url;

  content.appendChild(titleRow);
  content.appendChild(meta);
  content.appendChild(url);

  const actions = document.createElement("div");
  actions.className = "stream-actions";

  const mainActionButton = document.createElement("button");
  mainActionButton.className = "action-button";
  mainActionButton.type = "button";

  if (stream.type === "hls" || stream.type === "dash") {
    mainActionButton.textContent = "Открыть";
    mainActionButton.addEventListener("click", () => {
      openStreamTool(stream);
    });
  } else {
    mainActionButton.textContent = "Скачать";
    mainActionButton.addEventListener("click", () => {
      downloadDirectStream(stream, mainActionButton);
    });
  }

  const copyButton = document.createElement("button");
  copyButton.className = "action-button secondary";
  copyButton.type = "button";
  copyButton.textContent = "URL";
  copyButton.addEventListener("click", () => {
    copyStreamUrl(stream, copyButton);
  });

  actions.appendChild(mainActionButton);
  actions.appendChild(copyButton);

  card.appendChild(content);
  card.appendChild(actions);

  return card;
}

export function renderStreams() {
  const streams = getFilteredStreams();

  streamsListElement.innerHTML = "";

  if (streams.length === 0) {
    streamsListElement.className = "streams-list empty";

    if (currentStreams.length === 0) {
      streamsListElement.textContent =
        "Потоки пока не найдены. Запусти воспроизведение на странице и нажми «Обновить».";
    } else {
      streamsListElement.textContent =
        "В этом фильтре потоков нет.";
    }

    return;
  }

  streamsListElement.className = "streams-list";

  streams.forEach((stream) => {
    streamsListElement.appendChild(createStreamCard(stream));
  });
}
