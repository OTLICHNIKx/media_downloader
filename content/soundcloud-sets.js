// SoundCloud /sets/ pages: добавляет плавающую кнопку "Скачать плейлист".
// Собирает видимые треки из DOM (только отрендеренные — без автоскролла),
// передаёт их в background через START_PLAYLIST_BATCH_DOWNLOAD, который
// открывает playlist-downloader.html для батч-скачивания в MP3 + ZIP.

// Дубликат shared/filename.js — content-скрипты classic, не могут import.
function sanitizeSetsFilename(filename) {
  return filename
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

const SETS_BUTTON_ID = "media-downloader-sets-button";
const SETS_BUTTON_CLASS = "media-downloader-sets-button";
const SETS_STYLES_ID = "media-downloader-sets-styles";
let setsScanTimer = null;
let setsLastLocation = window.location.href;

// Инжектирует стили плавающей кнопки (один раз).
// Скрывается через .media-downloader-ui-disabled, как и инлайн-иконки.
function injectSetsStyles() {
  if (document.getElementById(SETS_STYLES_ID)) return;

  const style = document.createElement("style");
  style.id = SETS_STYLES_ID;

  style.textContent = `
    .media-downloader-sets-button {
      position: fixed !important;
      bottom: 20px !important;
      right: 20px !important;
      z-index: 2147483647 !important;

      display: inline-flex !important;
      align-items: center !important;
      gap: 8px !important;

      padding: 12px 20px !important;
      border: none !important;
      border-radius: 999px !important;
      background: #ff5500 !important;
      color: #ffffff !important;

      font-family: Arial, sans-serif !important;
      font-size: 14px !important;
      font-weight: 700 !important;
      line-height: 1 !important;

      cursor: pointer !important;
      box-shadow: 0 4px 14px rgba(255, 85, 0, 0.4) !important;
      transition: background 0.18s ease, transform 0.12s ease !important;
    }

    .media-downloader-sets-button:hover {
      background: #e64a00 !important;
      transform: translateY(-1px) !important;
    }

    .media-downloader-sets-button:active {
      transform: translateY(0) !important;
    }

    .media-downloader-sets-button:disabled {
      opacity: 0.7 !important;
      cursor: default !important;
      transform: none !important;
    }

    .media-downloader-ui-disabled .media-downloader-sets-button {
      display: none !important;
    }
  `;

  document.documentElement.appendChild(style);
}

// True только на страницах плейлистов SoundCloud (/sets/...).
function isSoundCloudSetsPage() {
  return (
    window.location.hostname.includes("soundcloud.com") &&
    window.location.pathname.includes("/sets/")
  );
}

// Извлекает числовой track id из href.
// SoundCloud использует два формата ссылок на треки:
//   /tracks/123456            — числовой id напрямую
//   /artist/track-slug        — slug, id отсутствует (нужен hydration)
function getTrackIdFromHref(href) {
  if (!href) return null;

  const match = href.match(/\/tracks\/(\d+)/);

  return match && match[1] ? match[1] : null;
}

// Извлекает плейлист-данные из SoundCloud hydration JSON.
// SoundCloud встраивает на странице <script>window.__sc_hydration = [...]</script>
// с информацией о плейлисте и (обрезанным) списком треков.
// Возвращает { playlistId, tracks } или null.
function extractPlaylistFromHydration() {
  try {
    const scripts = document.querySelectorAll("script:not([src])");

    for (const script of scripts) {
      const text = script.textContent || "";

      const match = text.match(
        /window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);/
      );

      if (!match || !match[1]) continue;

      const hydration = JSON.parse(match[1]);

      // Ищем playlist-ресурс.
      for (const item of hydration) {
        const resource = item?.hydratable === "playlist" ? item?.data : null;

        if (!resource || typeof resource.id !== "number") continue;

        const tracks = Array.isArray(resource.tracks)
          ? resource.tracks
              .filter((t) => t && typeof t.id === "number" && t.title)
              .map((t) => ({
                trackId: String(t.id),
                title: cleanSetsText(t.title),
                author: cleanSetsText(t.user?.username || "")
              }))
          : [];

        return {
          playlistId: String(resource.id),
          tracks
        };
      }
    }
  } catch {
    // ignore — фолбэк на DOM
  }

  return null;
}

// Получает полный список треков плейлиста через SoundCloud API.
// Запрос идёт со страницы (origin: soundcloud.com) — cookies и referer
// подхватываются автоматически. client_id извлекается из страницы.
// Возвращает массив { trackId, title, author } или null при ошибке.
async function fetchFullPlaylistTracks(playlistId) {
  try {
    const clientId = getClientId();
    if (!clientId) return null;

    const url =
      `https://api-v2.soundcloud.com/playlists/${playlistId}` +
      `?client_id=${encodeURIComponent(clientId)}&representation=compact`;

    const response = await fetch(url, { credentials: "include" });

    if (!response.ok) {
      console.warn(
        `[Media Downloader] Sets: API /playlists HTTP ${response.status}`
      );
      return null;
    }

    const data = await response.json();

    if (!data || !Array.isArray(data.tracks)) return null;

    return data.tracks
      .filter((t) => t && typeof t.id === "number" && t.title)
      .map((t) => ({
        trackId: String(t.id),
        title: cleanSetsText(t.title),
        author: cleanSetsText(t.user?.username || "")
      }));
  } catch {
    return null;
  }
}

// Извлекает SoundCloud client_id со страницы.
// Пробует несколько источников: inline-скрипты, hydration, performance entries.
// Возвращает строку client_id или null.
function extractClientIdFromPage() {
  try {
    // Способ 1: прямой паттерн в инлайн-скриптах.
    const scripts = document.querySelectorAll("script:not([src])");

    for (const script of scripts) {
      const text = script.textContent || "";

      // client_id: "..."  или  client_id:"..."
      const idMatch = text.match(/client_id["':\s]+["']([a-zA-Z0-9]{20,40})["']/);
      if (idMatch && idMatch[1]) return idMatch[1];
    }

    // Способ 2: JSON-форма в инлайн-скриптах.
    for (const script of scripts) {
      const text = script.textContent || "";
      const match = text.match(/"client_id"\s*:\s*"([a-zA-Z0-9]{20,40})"/);
      if (match && match[1]) return match[1];
    }

    // Способ 3: performance entries — SoundCloud при загрузке страницы делает
    // запросы к api-v2.soundcloud.com с client_id в query string. Это самый
    // надёжный способ: используем реальный client_id, которым SoundCloud
    // пользуется сам.
    const entries = performance.getEntriesByType("resource");

    for (const entry of entries) {
      const name = entry.name || "";
      if (!name.includes("soundcloud.com")) continue;

      const match = name.match(/client_id=([a-zA-Z0-9]{20,40})/);
      if (match && match[1]) return match[1];
    }

    // Способ 4: через скрапинг внешних JS-бандлов SoundCloud (async, тут sync-фолбэк).
    // Этот способ не сработает синхронно — оставляем как комментарий.
  } catch {
    // ignore
  }

  return null;
}

// Кэш client_id: извлекаем один раз, переиспользуем.
let cachedClientId = null;

function getClientId() {
  if (cachedClientId) return cachedClientId;

  cachedClientId = extractClientIdFromPage();

  if (cachedClientId) {
    console.log("[Media Downloader] Sets: client_id извлечён");
  } else {
    console.warn("[Media Downloader] Sets: client_id НЕ найден");
  }

  return cachedClientId;
}

// Очищает текст от типового мусора SoundCloud (play-кнопки, whitespace).
function cleanSetsText(text) {
  if (!text) return "";

  return text
    .replace(/\s+/g, " ")
    .trim();
}

// Пытается достать заголовок трека из карточки.
function extractTrackTitle(cardElement, trackLink) {
  // Сначала явные селекторы SoundCloud внутри карточки.
  const titleEl =
    cardElement.querySelector(".trackItem__trackTitle") ||
    cardElement.querySelector(".soundTitle__title span") ||
    cardElement.querySelector(".soundTitle__title");

  if (titleEl && titleEl.textContent) {
    const text = cleanSetsText(titleEl.textContent);

    if (text) return text;
  }

  // Фолбэк: текст самой ссылки (часто содержит название трека).
  if (trackLink && trackLink.textContent) {
    const text = cleanSetsText(trackLink.textContent);

    if (text && text.length >= 2) return text;
  }

  return null;
}

// Пытается достать автора трека из карточки.
function extractTrackAuthor(cardElement) {
  const authorEl =
    cardElement.querySelector(".soundTitle__username") ||
    cardElement.querySelector(".soundTitle__usernameText") ||
    cardElement.querySelector(".trackItem__username");

  if (authorEl && authorEl.textContent) {
    const text = cleanSetsText(authorEl.textContent);

    if (text) return text;
  }

  // Фолбэк: ссылка на пользователя в карточке.
  const userLink = cardElement.querySelector("a[href*='/user-']");

  if (userLink && userLink.textContent) {
    const text = cleanSetsText(userLink.textContent);

    if (text) return text;
  }

  return null;
}

// Находит подходящую карточку-контейнер для ссылки на трек.
// Идём вверх по предкам, пока не встретим типичный SoundCloud-контейнер трека.
function findTrackContainer(linkElement) {
  return linkElement.closest(
    ".soundList__item, .trackItem, .sound__body, article, li"
  );
}

// Собирает уникальные треки со страницы /sets/.
// Приоритет:
//   1. SoundCloud API /playlists/{id} (полный список, требует client_id)
//   2. Hydration data (может быть обрезана до первых N треков)
//   3. DOM-ссылки /tracks/NNN (фолбэк)
// Возвращает массив { trackId, title, author }.
async function collectVisiblePlaylistTracks() {
  // 1. Hydration data — извлекаем playlistId и tracks (может быть обрезана).
  const playlistInfo = extractPlaylistFromHydration();

  // 2. Пробуем получить полный список через API (нужен playlistId + client_id).
  if (playlistInfo && playlistInfo.playlistId) {
    const apiTracks = await fetchFullPlaylistTracks(playlistInfo.playlistId);

    if (apiTracks && apiTracks.length > 0) {
      console.log(
        `[Media Downloader] Sets: API дал ${apiTracks.length} трек(ов)`
      );
      return apiTracks;
    }
  }

  // 3. Hydration tracks (обрезанные, но лучшие что есть без API).
  if (playlistInfo && playlistInfo.tracks.length > 0) {
    console.log(
      `[Media Downloader] Sets: hydration дал ${playlistInfo.tracks.length} трек(ов)`
    );
    return playlistInfo.tracks;
  }

  // 4. Фолбэк: ссылки /tracks/NNN в DOM.
  const trackLinks = document.querySelectorAll("a[href*='/tracks/']");
  const seen = new Set();
  const tracks = [];

  trackLinks.forEach((link) => {
    const href = link.getAttribute("href") || "";
    const trackId = getTrackIdFromHref(href);

    // Пропускаем дубликаты по trackId и ссылки без числового id.
    if (!trackId || seen.has(trackId)) return;

    // Только видимые ссылки (виртуализация SoundCloud может держать скрытые).
    const rect = link.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const container = findTrackContainer(link);
    const title = extractTrackTitle(container || link, link);
    const author = extractTrackAuthor(container || link);

    // Без заголовка трек бесполезен в ZIP — пропускаем.
    if (!title) return;

    seen.add(trackId);
    tracks.push({ trackId, title, author: author || "" });
  });

  console.log(
    `[Media Downloader] Sets: DOM-fallback дал ${tracks.length} трек(ов)`
  );

  return tracks;
}

// Извлекает название плейлиста из шапки SoundCloud sets-страницы.
function extractPlaylistTitle() {
  const headerEl =
    document.querySelector("h1.soundTitle__title") ||
    document.querySelector("h1") ||
    document.querySelector("[data-media-title]");

  if (headerEl && headerEl.textContent) {
    const text = cleanSetsText(headerEl.textContent);

    if (text) return text;
  }

  // Фолбэк: последний сегмент pathname.
  const segments = window.location.pathname.split("/").filter(Boolean);

  return segments[segments.length - 1] || "playlist";
}

function createSetsButton(trackCount) {
  const button = document.getElementById(SETS_BUTTON_ID);

  if (button) {
    button.textContent = `Скачать плейлист (${trackCount})`;
    return button;
  }

  const newButton = document.createElement("button");
  newButton.id = SETS_BUTTON_ID;
  newButton.className = SETS_BUTTON_CLASS;
  newButton.type = "button";
  newButton.textContent = `Скачать плейлист (${trackCount})`;
  newButton.title = "Скачать все треки плейлиста в MP3 и упаковать в ZIP";

  newButton.addEventListener("click", async () => {
    newButton.disabled = true;
    newButton.textContent = "Собираю треки...";

    try {
      const tracks = await collectVisiblePlaylistTracks();
      const playlistTitle = extractPlaylistTitle();
      const clientId = getClientId();
 
      if (!clientId) {
        newButton.disabled = false;
        newButton.textContent = "client_id не найден";
        setTimeout(() => {
          newButton.textContent = `Скачать плейлист (${tracks.length || 0})`;
        }, 2500);
        return;
      }
 
      if (tracks.length === 0) {

        newButton.textContent = "Треки не найдены";
        setTimeout(() => {
          newButton.disabled = false;
          newButton.textContent = "Скачать плейлист";
        }, 2000);
        return;
      }

      newButton.textContent = `Открываю загрузчик (${tracks.length})...`;

      chrome.runtime.sendMessage(
        {
          type: "START_PLAYLIST_BATCH_DOWNLOAD",
          tracks,
          playlistTitle,
          clientId
        },
        (response) => {
          if (chrome.runtime.lastError || !response || !response.ok) {
            newButton.disabled = false;
            newButton.textContent = `Скачать плейлист (${tracks.length})`;
            return;
          }

          // Вкладка playlist-downloader открыта background'ом —
          // кнопку можно скрыть.
          newButton.textContent = "Загрузчик открыт в новой вкладке ✓";
        }
      );
    } catch (error) {
      newButton.disabled = false;
      newButton.textContent = "Ошибка сбора треков";
      setTimeout(() => {
        newButton.textContent = "Скачать плейлист";
      }, 2000);
    }
  });

  document.body.appendChild(newButton);
  return newButton;
}

function removeSetsButton() {
  const button = document.getElementById(SETS_BUTTON_ID);

  if (button) {
    button.remove();
  }
}

// Сканирует DOM, обновляет/создаёт/скрывает кнопку.
// Для счётчика используем только синхронные источники (hydration/DOM).
// Полный список через API достаётся при клике — это медленный запрос.
function refreshSetsButton() {
  if (!isSoundCloudSetsPage()) {
    removeSetsButton();
    return;
  }

  // Быстрый синхронный подсчёт для отображения на кнопке.
  // priority: hydration > DOM links count
  const playlistInfo = extractPlaylistFromHydration();
  const hydrationCount = playlistInfo && playlistInfo.tracks.length > 0
    ? playlistInfo.tracks.length
    : 0;

  if (hydrationCount > 0) {
    createSetsButton(hydrationCount);
    return;
  }

  // Hydration ещё не загружен (SPA-навигация) — показываем "..." пока ждём.
  // Кнопка появится с корректным числом на следующем scan.
  const domCount = document.querySelectorAll("a[href*='/tracks/']").length;
  if (domCount > 0) {
    createSetsButton(domCount);
    return;
  }

  removeSetsButton();
}

// Debounce-скан: SoundCloud активно мутирует DOM (Ember).
function scheduleSetsScan(delay = 400) {
  clearTimeout(setsScanTimer);
  setsScanTimer = setTimeout(refreshSetsButton, delay);
}

// Слежение за SPA-навигацией: кнопка должна жить только на /sets/.
function handleSetsSpaNavigation() {
  if (setsLastLocation === window.location.href) return;

  setsLastLocation = window.location.href;
  refreshSetsButton();
}

// Стартовая инициализация + наблюдатели.
function initSoundCloudSetsButton() {
  injectSetsStyles();
  refreshSetsButton();

  // MutationObserver — реагируем на ре-рендер карточек Ember'ом.
  const observer = new MutationObserver(() => {
    handleSetsSpaNavigation();
    scheduleSetsScan(400);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // Periodic fallback — на случай если MutationObserver пропустил.
  // Каждые 3с перепроверяем, не появилось ли больше треков.
  setInterval(() => {
    handleSetsSpaNavigation();
    scheduleSetsScan(800);
  }, 3000);

  // После SPA-навигации hydration может загружаться задержанно —
  // делаем несколько re-scan'ов с нарастающим интервалом.
  const MAX_RESCANS_AFTER_NAV = 5;
  const RESCAN_BASE_DELAY = 500;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSoundCloudSetsButton);
} else {
  initSoundCloudSetsButton();
}
