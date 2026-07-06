// Точка входа playlist-downloader.html.
// Читает batchId из URL → получает tracks из background → рендерит UI →
// запускает runBatchDownload с callbacks, обновляющими DOM.

import { runBatchDownload, buildZipBlob } from "./batch-download.js";

const titleElement = document.getElementById("title");
const descriptionElement = document.getElementById("description");
const overallStatusElement = document.getElementById("overall-status");
const overallCounterElement = document.getElementById("overall-counter");
const overallBarElement = document.getElementById("overall-bar");
const controlsElement = document.getElementById("controls");
const cancelButton = document.getElementById("cancel-button");
const downloadZipButton = document.getElementById("download-zip-button");
const trackListElement = document.getElementById("track-list");

const params = new URLSearchParams(window.location.search);
const batchId = params.get("batchId");

const abortController = new AbortController();

function getChromeStorageLocal(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      const error = chrome.runtime.lastError;

      if (error) {
        reject(new Error(error.message));
        return;
      }

      resolve(result || {});
    });
  });
}

function removeChromeStorageLocal(key) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(key, () => {
      resolve();
    });
  });
}

async function getStoredPlaylistBatch(batchId) {
  const storageKey = `playlistBatch:${batchId}`;
  const result = await getChromeStorageLocal(storageKey);
  const batch = result[storageKey];

  if (!batch || !Array.isArray(batch.tracks)) {
    return null;
  }

  await removeChromeStorageLocal(storageKey);

  return {
    ok: true,
    tracks: batch.tracks,
    playlistTitle: batch.playlistTitle || "playlist",
    playlistAuthor: batch.playlistAuthor || "",
    clientId: batch.clientId || null
  };
}

let completedCount = 0;
let failedCount = 0;
let totalTracks = 0;
let lastResults = [];

function setOverallProgress(done, total) {
  const percent = total > 0 ? (done / total) * 100 : 0;
  overallBarElement.style.width = `${percent}%`;
  overallCounterElement.textContent = `${done} / ${total}`;
}

function setOverallStatus(text) {
  overallStatusElement.textContent = text;
}

function renderTrackList(tracks) {
  trackListElement.innerHTML = "";

  tracks.forEach((track, index) => {
    const number = String(index + 1).padStart(2, "0");
    const authorPart = track.author ? `${track.author} - ` : "";

    const item = document.createElement("li");
    item.className = "track-item";
    item.dataset.index = String(index);
    item.innerHTML = `
      <span class="track-number">${number}</span>
      <div class="track-info">
        <div class="track-title">${escapeHtml(authorPart + track.title)}</div>
        <div class="track-status" data-role="status">Ожидание</div>
      </div>
      <div class="track-mini-bar">
        <div class="track-mini-fill" data-role="fill"></div>
      </div>
    `;

    trackListElement.appendChild(item);
  });
}

function getTrackItem(index) {
  return trackListElement.querySelector(
    `.track-item[data-index="${index}"]`
  );
}

function setTrackStatus(index, text, modifier = "") {
  const item = getTrackItem(index);

  if (!item) return;

  const statusEl = item.querySelector('[data-role="status"]');
  statusEl.textContent = text;
  statusEl.className = "track-status" + (modifier ? ` ${modifier}` : "");
}

function setTrackFill(index, percent, modifier = "") {
  const item = getTrackItem(index);

  if (!item) return;

  const fillEl = item.querySelector('[data-role="fill"]');
  fillEl.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  fillEl.className = "track-mini-fill" + (modifier ? ` ${modifier}` : "");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function updateOverallDuringRun() {
  const processed = completedCount + failedCount;

  if (abortController.signal.aborted) {
    setOverallStatus(
      `Отменено. Готово: ${completedCount}, ошибок: ${failedCount}`
    );
    return;
  }

  if (processed >= totalTracks) {
    setOverallStatus(
      `Завершено. Успешно: ${completedCount}, ошибок: ${failedCount}`
    );
    return;
  }

  setOverallStatus(
    `Скачивание... Успешно: ${completedCount}, ошибок: ${failedCount}`
  );
}

async function downloadZip(results, playlistTitle) {
  setOverallStatus("Упаковка ZIP...");

  try {
    const zipBlob = buildZipBlob(results, playlistTitle);
    const objectUrl = URL.createObjectURL(zipBlob);
    const zipName = `${sanitizeZipName(playlistTitle)}.zip`;

    chrome.downloads.download(
      {
        url: objectUrl,
        filename: zipName,
        saveAs: true
      },
      () => {
        if (chrome.runtime.lastError) {
          setOverallStatus(
            `Ошибка сохранения ZIP: ${chrome.runtime.lastError.message}`
          );
          URL.revokeObjectURL(objectUrl);
          return;
        }

        setOverallStatus(
          `ZIP (${results.length} треков) — скачивание запущено.`
        );
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      }
    );
  } catch (error) {
    setOverallStatus(`Ошибка упаковки ZIP: ${error.message}`);
  }
}

function sanitizeZipName(name) {
  return (name || "playlist")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "playlist";
}

function showDownloadZipButton(results, playlistTitle) {
  downloadZipButton.classList.remove("hidden");
  downloadZipButton.textContent = `Скачать ZIP (${results.length} из ${totalTracks})`;
  downloadZipButton.onclick = () => {
    downloadZip(results, playlistTitle);
  };
}

function showCancelButton(show) {
  if (show) {
    cancelButton.classList.remove("hidden");
  } else {
    cancelButton.classList.add("hidden");
  }
}

cancelButton.addEventListener("click", () => {
  abortController.abort();
  cancelButton.disabled = true;
  cancelButton.textContent = "Отмена...";
});

async function init() {
  if (!batchId) {
    setOverallStatus("Ошибка: batchId не передан.");
    return;
  }

  setOverallStatus("Получение списка треков...");

  chrome.runtime.sendMessage(
    {
      type: "GET_PLAYLIST_BATCH",
      batchId
    },
    async (response) => {
      let resolvedResponse = response;

    if (chrome.runtime.lastError || !response || !response.ok) {
      try {
        resolvedResponse = await getStoredPlaylistBatch(batchId);
      } catch (error) {
        resolvedResponse = null;
      }

      if (!resolvedResponse || !resolvedResponse.ok) {
        setOverallStatus(
          `Ошибка: ${response?.error || chrome.runtime.lastError?.message || "не удалось получить батч"}`
        );
        return;
      }
    }

    const { tracks, playlistTitle, playlistAuthor, clientId } = resolvedResponse;
    const zipTitle = playlistAuthor
      ? `${playlistAuthor} - ${playlistTitle}`
      : playlistTitle;

      totalTracks = tracks.length;
      titleElement.textContent = playlistTitle;
      descriptionElement.textContent = `${tracks.length} треков. Каждый трек скачивается как HLS, конвертируется в MP3 и упаковывается в ZIP.`;
      setOverallProgress(0, totalTracks);
      renderTrackList(tracks);

      controlsElement.classList.remove("hidden");
      showCancelButton(true);

      try {
        const results = await runBatchDownload(tracks, {
          clientId,
          onTrackStart(index) {
            setTrackStatus(index, "Загрузка...");
            setTrackFill(index, 5);
          },

          onStage(index, stage, statusText, progress = null) {
            if (statusText) {
              const modifier = stage === "transcode" ? "transcoding" : "";
              setTrackStatus(index, statusText, modifier);
            }

            if (stage === "segments" && progress) {
              const percent = progress.total > 0
                ? 10 + (progress.done / progress.total) * 70
                : 10;
              setTrackFill(index, percent);
            } else if (stage === "transcode") {
              setTrackFill(index, 85);
            } else if (stage === "playlist") {
              setTrackFill(index, 8);
            }
          },

          onTrackDone(index) {
            completedCount += 1;
            setTrackStatus(index, "Готово ✓", "done");
            setTrackFill(index, 100, "done");
            setOverallProgress(completedCount + failedCount, totalTracks);
            updateOverallDuringRun();
          },

          onTrackError(index, message) {
            failedCount += 1;
            setTrackStatus(index, `Ошибка: ${message}`, "error");
            setTrackFill(index, 100, "error");
            setOverallProgress(completedCount + failedCount, totalTracks);
            updateOverallDuringRun();
          },

          signal: abortController.signal
        });
        lastResults = results;

        showCancelButton(false);

        // Если все треки скачались — сразу предлагаем ZIP.
        // Если часть упала — показываем кнопку ручного скачивания.
        showDownloadZipButton(results, zipTitle);

        // Автоскачивание ZIP если все успешно.
        if (results.length === totalTracks && !abortController.signal.aborted) {
          downloadZip(results, zipTitle);
        }
      } catch (error) {
        showCancelButton(false);
        setOverallStatus(`Фатальная ошибка: ${error.message}`);

        // Даже при фатальной ошибке могли быть скачаны некоторые треки.
        if (lastResults.length > 0) {
          showDownloadZipButton(lastResults, zipTitle);
        }
      }
    }
  );
}

init();
