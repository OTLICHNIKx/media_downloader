import {
  diagnosticsListElement,
  currentDiagnostics,
  currentScanSummary
} from "./ui-state.js";
import { getScanSummaryParts, getDiagnosticMetaParts } from "./format.js";

export function renderDiagnostics() {
  diagnosticsListElement.innerHTML = "";

  const hasScanSummary = Boolean(currentScanSummary);
  const hasDiagnostics = currentDiagnostics && currentDiagnostics.length > 0;

  if (!hasScanSummary && !hasDiagnostics) {
    diagnosticsListElement.className = "diagnostics-list empty";
    diagnosticsListElement.textContent = "Диагностики пока нет.";
    return;
  }

  diagnosticsListElement.className = "diagnostics-list";

  if (hasScanSummary) {
    const card = document.createElement("div");
    card.className = "diagnostic-card";

    const title = document.createElement("div");
    title.className = "diagnostic-title";
    title.textContent = currentScanSummary.message || "Текущий скан страницы";

    const meta = document.createElement("div");
    meta.className = "diagnostic-meta";
    meta.textContent = getScanSummaryParts(currentScanSummary).join(" · ");

    card.appendChild(title);
    card.appendChild(meta);

    diagnosticsListElement.appendChild(card);
  }

  currentDiagnostics.slice(0, 20).forEach((diagnostic) => {
    const card = document.createElement("div");
    card.className = "diagnostic-card";

    const title = document.createElement("div");
    title.className = "diagnostic-title";
    title.textContent = diagnostic.message || diagnostic.code || "diagnostic";

    const meta = document.createElement("div");
    meta.className = "diagnostic-meta";
    meta.textContent = getDiagnosticMetaParts(diagnostic).join(" · ");

    card.appendChild(title);
    card.appendChild(meta);

    const diagnosticUrl = diagnostic?.data?.url || diagnostic?.data?.lastObservedUrl;

    if (diagnosticUrl) {
      const extra = document.createElement("div");
      extra.className = "diagnostic-meta";
      extra.textContent = diagnosticUrl;
      card.appendChild(extra);
    }

    diagnosticsListElement.appendChild(card);
  });
}
