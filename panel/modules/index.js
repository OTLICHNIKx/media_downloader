import { getHostFromUrl } from "../../shared/format.js";
import {
  pageInfoElement,
  refreshButtonElement,
  clearDiagnosticsButtonElement,
  filterButtonElements,
  targetTabUrl,
  targetTitle,
  setCurrentFilter
} from "./ui-state.js";
import { renderStreams } from "./streams-render.js";
import { refreshState, clearDiagnostics } from "./media-state.js";

function setFilter(nextFilter) {
  setCurrentFilter(nextFilter);

  filterButtonElements.forEach((button) => {
    button.classList.toggle("active", button.dataset.filter === nextFilter);
  });

  renderStreams();
}

export function initPanel() {
  const host = getHostFromUrl(targetTabUrl);
  const titleText = targetTitle || "Текущая вкладка";

  pageInfoElement.textContent = host
    ? `${titleText} · ${host}`
    : titleText;

  refreshButtonElement.addEventListener("click", () => {
    refreshState({ forceRescan: true });
  });
  clearDiagnosticsButtonElement.addEventListener("click", clearDiagnostics);

  filterButtonElements.forEach((button) => {
    button.addEventListener("click", () => {
      setFilter(button.dataset.filter || "all");
    });
  });

  refreshState({ forceRescan: true });

  setInterval(() => {
    refreshState();
  }, 3000);
}

initPanel();
