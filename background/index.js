import { registerWebRequestListeners } from "./web-request.js";
import { registerTabLifecycleListeners } from "./tab-lifecycle.js";
import { registerMessageRouter } from "./message-router.js";

export function init() {
  registerWebRequestListeners();
  registerTabLifecycleListeners();
  registerMessageRouter();
}
