export const streamsByTabId = {};
export const activeCapturesByTabId = {};
export const capturedStreamsByTabId = {};
export const diagnosticsByTabId = {};
export const diagnosticSignaturesByTabId = {};
export const scanSummariesByTabId = {};
export const soundCloudFragmentGroupsByTabId = {};
export const soundCloudFallbackPlaylistsById = {};
export const soundCloudResolvedByTabId = {};
export const soundCloudResolveInFlightByTabId = {};
// Обратный индекс: tabId -> { [playlistUrl]: trackId }.
// playback.media-streaming.../UUID/playlist.m3u8 не содержит track id, но он
// становится известен в момент резолва из API endpoint (soundcloud:tracks:NNN).
// Позволяет матчить playback-URL на ожидаемый трек в capture.
export const soundCloudTrackIdByPlaylistUrlByTabId = {};

// Ожидающие батчи плейлистов: batchId -> { tracks, playlistTitle, createdAt }.
// Content-script на /sets/ странице шлёт START_PLAYLIST_BATCH_DOWNLOAD → background
// сохраняет батч и открывает playlist-downloader.html?batchId=..., который забирает
// батч через GET_PLAYLIST_BATCH. TTL-очистка — в message-router.js.
export const pendingPlaylistBatches = {};
