// HTTP-хелперы для downloader-страниц (hls/dash). Идентичны в обеих копиях.

export function getHttpErrorMessage(status, targetLabel) {
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

export function resolveUrl(baseUrl, maybeRelativeUrl) {
  return new URL(maybeRelativeUrl, baseUrl).href;
}

export async function fetchText(url, options = {}) {
  const targetLabel = options.label || "playlist";
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

  return response.text();
}

export async function fetchArrayBuffer(url, options = {}) {
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
