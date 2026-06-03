
const scanButton = document.getElementById("scanButton");
const statusElement = document.getElementById("status");
const mediaListElement = document.getElementById("mediaList");

function setStatus(text) {
  statusElement.textContent = text;
}

function clearMediaList() {
  mediaListElement.innerHTML = "";
}

function renderMediaList(mediaItems) {
  clearMediaList();

  if (!mediaItems.length) {
    setStatus("На странице не найдено прямых ссылок на mp3, mp4 или wav.");
    return;
  }

  setStatus(`Найдено файлов: ${mediaItems.length}`);

  mediaItems.forEach((item) => {
    const container = document.createElement("article");
    container.className = "media-item";

    const title = document.createElement("div");
    title.className = "media-title";
    title.textContent = item.filename;

    const meta = document.createElement("div");
    meta.className = "media-meta";
    meta.textContent = `Формат: ${item.extension.toUpperCase()} | Качество: ${item.quality}`;

    const button = document.createElement("button");
    button.className = "download-button";
    button.textContent = "Скачать";

    button.addEventListener("click", () => {
      chrome.runtime.sendMessage(
        {
          type: "DOWNLOAD_MEDIA",
          url: item.url,
          filename: item.filename
        },
        (response) => {
          if (!response || !response.ok) {
            const error = response?.error || "Неизвестная ошибка скачивания";
            setStatus(`Ошибка: ${error}`);
            return;
          }

          setStatus("Скачивание запущено.");
        }
      );
    });

    container.appendChild(title);
    container.appendChild(meta);
    container.appendChild(button);

    mediaListElement.appendChild(container);
  });
}

async function getCurrentTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tabs[0];
}

scanButton.addEventListener("click", async () => {
  clearMediaList();
  setStatus("Сканирую страницу...");

  try {
    const tab = await getCurrentTab();

    chrome.tabs.sendMessage(
      tab.id,
      {
        type: "SCAN_MEDIA"
      },
      (response) => {
        if (chrome.runtime.lastError) {
          setStatus("Не удалось просканировать страницу. Обнови вкладку и попробуй снова.");
          return;
        }

        if (!response || !response.ok) {
          setStatus("Не удалось получить список медиа.");
          return;
        }

        renderMediaList(response.media);
      }
    );
  } catch (error) {
    setStatus(`Ошибка: ${error.message}`);
  }
});