import { MAX_DIAGNOSTICS_PER_TAB } from "./constants.js";
import { diagnosticsByTabId, diagnosticSignaturesByTabId } from "./state.js";

export function shouldIgnoreCaptureResponseDiagnostic(details, contentType = "") {
  if (!details || !details.url) {
    return true;
  }

  const lowerUrl = String(details.url).toLowerCase();
  const lowerType = String(contentType || "").toLowerCase();
  const requestType = String(details.type || "").toLowerCase();

  if (["ping", "csp_report", "font", "image"].includes(requestType)) {
    return true;
  }

  if (
    lowerUrl.includes("analytics") ||
    lowerUrl.includes("collect?") ||
    lowerUrl.includes("pixel") ||
    lowerUrl.includes("telemetry") ||
    lowerUrl.includes("tsub/") ||
    lowerUrl.includes("/connect/session")
  ) {
    return true;
  }

  if (
    lowerType.startsWith("application/json") ||
    lowerType.startsWith("text/plain") ||
    lowerType.startsWith("text/html") ||
    lowerType.startsWith("text/event-stream")
  ) {
    return true;
  }

  return false;
}

export function getDiagnosticSignature(code, message, data = {}) {
  const stableData = {
    host: data.host || null,
    adapter: data.adapter || null,
    visibleLinks: data.visibleLinks ?? null,
    inlineLinkMediaFound: data.inlineLinkMediaFound ?? null,
    visibleMediaElements: data.visibleMediaElements ?? null,
    inlineMediaFound: data.inlineMediaFound ?? null,
    latestHlsChecks: data.latestHlsChecks ?? null,
    adapterCandidates: data.adapterCandidates ?? null,
    buttonsOnPage: data.buttonsOnPage ?? null,
    url: data.url || null,
    contentType: data.contentType || null,
    requestType: data.requestType || null,
    statusCode: data.statusCode || null
  };

  return JSON.stringify({
    code,
    message,
    data: stableData
  });
}

export function rememberDiagnostic(tabId, code, message, data = {}) {
  if (typeof tabId !== "number" || tabId < 0) return;

  if (!diagnosticsByTabId[tabId]) {
    diagnosticsByTabId[tabId] = [];
  }

  if (!diagnosticSignaturesByTabId[tabId]) {
    diagnosticSignaturesByTabId[tabId] = new Set();
  }

  const signature = getDiagnosticSignature(code, message, data);

  if (diagnosticSignaturesByTabId[tabId].has(signature)) {
    return;
  }

  diagnosticSignaturesByTabId[tabId].add(signature);

  const diagnostics = diagnosticsByTabId[tabId];

  const diagnostic = {
    code,
    message,
    data,
    createdAt: Date.now()
  };

  diagnostics.unshift(diagnostic);

  if (diagnostics.length > MAX_DIAGNOSTICS_PER_TAB) {
    diagnostics.length = MAX_DIAGNOSTICS_PER_TAB;
  }

  console.log("[Media Downloader] Diagnostic:", diagnostic);
}
