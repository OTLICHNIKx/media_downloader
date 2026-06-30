export const pageInfoElement = document.getElementById("pageInfo");
export const refreshButtonElement = document.getElementById("refreshButton");
export const clearDiagnosticsButtonElement = document.getElementById("clearDiagnosticsButton");
export const streamsListElement = document.getElementById("streamsList");
export const diagnosticsListElement = document.getElementById("diagnosticsList");
export const totalCountElement = document.getElementById("totalCount");
export const audioCountElement = document.getElementById("audioCount");
export const videoCountElement = document.getElementById("videoCount");
export const hlsCountElement = document.getElementById("hlsCount");
export const dashCountElement = document.getElementById("dashCount");
export const filterButtonElements = Array.from(document.querySelectorAll(".filter-button"));

export const params = new URLSearchParams(window.location.search);
export const targetTabId = Number(params.get("tabId"));
export const targetTabUrl = params.get("tabUrl") || "";
export const targetTitle = params.get("title") || "";

export let currentFilter = "all";
export let currentStreams = [];
export let currentDiagnostics = [];
export let currentScanSummary = null;

export function setCurrentFilter(filter) {
  currentFilter = filter;
}

export function setCurrentStreams(streams) {
  currentStreams = streams;
}

export function setCurrentDiagnostics(diagnostics) {
  currentDiagnostics = diagnostics;
}

export function setCurrentScanSummary(scanSummary) {
  currentScanSummary = scanSummary;
}
