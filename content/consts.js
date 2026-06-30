
const TRACK_CAPTURE_ATTRIBUTE = "data-media-downloader-capture-id";
const TRACK_STREAM_URL_ATTRIBUTE = "data-media-downloader-stream-url";
const TRACK_STREAM_TYPE_ATTRIBUTE = "data-media-downloader-stream-type";
const TRACK_BOUND_ATTRIBUTE = "data-media-downloader-track-bound";

const TRACK_TITLE_ATTRIBUTE = "data-media-title";
const TRACK_AUTHOR_ATTRIBUTE = "data-media-author";
const TRACK_ADAPTER_ATTRIBUTE = "data-media-downloader-adapter";

const MEDIA_DOWNLOADER_ICON_CLASS = "media-downloader-icon";
const MEDIA_DOWNLOADER_URL_ATTRIBUTE = "data-media-downloader-url";

let mediaDownloaderScanTimer = null;
let mediaDownloaderLastLocation = window.location.href;
const MEDIA_DOWNLOADER_FALLBACK_ATTRIBUTE = "data-media-downloader-fallback-id";
let mediaDownloaderUiEnabled = true;
let mediaDownloaderLastDiagnosticReportAt = 0;
let mediaDownloaderLastScanSummaryReportAt = 0;
const HLS_PANEL_ID = "media-downloader-hls-panel";
const DASH_PANEL_ID = "media-downloader-dash-panel";

// NOTE: content — это classic-скрипты (MV3 не поддерживает type:module в content_scripts),
// поэтому shared/media-types.js НЕ импортируется здесь. Таблицы дублируются (см. задачу D).
// Источник правды для ES-потребителей — shared/media-types.js.
const AUDIO_EXTENSIONS = [
  "mp3",
  "m4a",
  "aac",
  "ogg",
  "opus",
  "wav",
  "flac"
];

const VIDEO_EXTENSIONS = [
  "mp4",
  "webm",
  "m4v",
  "mov"
];

const STREAM_EXTENSIONS = [
  "m3u8",
  "mpd"
];

const SUPPORTED_EXTENSIONS = [
  ...AUDIO_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...STREAM_EXTENSIONS
];

const ICON_ADDED_ATTRIBUTE = "data-media-downloader-icon-added";
