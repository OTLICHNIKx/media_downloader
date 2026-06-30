// sanitizeFilename — идентична во всех файлах расширения (background, content, popup, hls).
// Вынесена сюда как единый источник правды для ES-потребителей.
// content.js дублирует (classic-скрипты не могут import — см. C1).

export function sanitizeFilename(filename) {
  return filename
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}
