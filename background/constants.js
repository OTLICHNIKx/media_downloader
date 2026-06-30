import {
  AUDIO_EXTENSIONS,
  VIDEO_EXTENSIONS,
  MANIFEST_EXTENSIONS,
  ALL_MEDIA_EXTENSIONS
} from "../shared/media-types.js";

export const MAX_STREAMS_PER_TAB = 50;
export const MAX_DIAGNOSTICS_PER_TAB = 30;

// Локальные имена сохранены, чтобы не трогать импортёров (url-classify.js).
// Источник правды — shared/media-types.js.
export const AUDIO_STREAM_EXTENSIONS = AUDIO_EXTENSIONS;
export const VIDEO_STREAM_EXTENSIONS = VIDEO_EXTENSIONS;
export const MANIFEST_STREAM_EXTENSIONS = MANIFEST_EXTENSIONS;
export const STREAM_EXTENSIONS = ALL_MEDIA_EXTENSIONS;

export const MEDIA_MIME_RULES = [
  {
    includes: ["application/vnd.apple.mpegurl", "application/x-mpegurl", "audio/mpegurl", "audio/x-mpegurl"],
    type: "hls",
    extension: "m3u8"
  },
  {
    includes: ["application/dash+xml"],
    type: "dash",
    extension: "mpd"
  },
  {
    includes: ["audio/mpeg", "audio/mp3"],
    type: "audio",
    extension: "mp3"
  },
  {
    includes: ["audio/mp4", "audio/x-m4a"],
    type: "audio",
    extension: "m4a"
  },
  {
    includes: ["audio/aac"],
    type: "audio",
    extension: "aac"
  },
  {
    includes: ["audio/ogg", "application/ogg"],
    type: "audio",
    extension: "ogg"
  },
  {
    includes: ["audio/opus"],
    type: "audio",
    extension: "opus"
  },
  {
    includes: ["audio/wav", "audio/x-wav", "audio/wave"],
    type: "audio",
    extension: "wav"
  },
  {
    includes: ["audio/flac"],
    type: "audio",
    extension: "flac"
  },
  {
    includes: ["video/mp4"],
    type: "video",
    extension: "mp4"
  },
  {
    includes: ["video/webm"],
    type: "video",
    extension: "webm"
  }
];
