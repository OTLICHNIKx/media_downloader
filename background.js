// использование API для скачиваний браузера

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "DOWNLOAD_MEDIA") {
    return;
  }

  chrome.downloads.download(
    {
      url: message.url,
      filename: message.filename || undefined,
      saveAs: true
    },
    (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({
          ok: false,
          error: chrome.runtime.lastError.message
        });
        return;
      }

      sendResponse({
        ok: true,
        downloadId
      });
    }
  );

  return true;
});