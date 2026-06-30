// Канонические extension-таблицы для media-классификации.
// Источник правды для background и ES-потребителей (popup/panel/hls).
// Внимание: background использует имя STREAM_EXTENSIONS для набора «все 13»,
// а content.js — для набора «только m3u8+mpd» (2 шт). Поэтому здесь экспортируем
// канонические имена; потребители мапят их под свои локальные имена.

export const AUDIO_EXTENSIONS = [
  "mp3",
  "m4a",
  "aac",
  "ogg",
  "opus",
  "wav",
  "flac"
];

export const VIDEO_EXTENSIONS = [
  "mp4",
  "webm",
  "m4v",
  "mov"
];

export const MANIFEST_EXTENSIONS = [
  "m3u8",
  "mpd"
];

// Все поддерживаемые extension'ы (m3u8+mpd+audio+video) — 13 шт.
// В background называется STREAM_EXTENSIONS, в content — SUPPORTED_EXTENSIONS.
export const ALL_MEDIA_EXTENSIONS = [
  ...MANIFEST_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...VIDEO_EXTENSIONS
];

// Только manifest-форматы (m3u8, mpd) — 2 шт.
// В content.js называется STREAM_EXTENSIONS.
export const MANIFEST_ONLY_EXTENSIONS = MANIFEST_EXTENSIONS;
