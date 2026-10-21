// Landing page wiring.
//
// This lives in its own file rather than inline in index.html so the page can
// be served under a strict Content-Security-Policy: an inline module would
// need `unsafe-inline` in `script-src`, which would also allow any injected
// inline script to run.
import { renderHistory } from "/js/pages/history_view.js";
import { HistoryStore } from "/js/core/history_store.js";

const container = document.getElementById("history-list");
const store = new HistoryStore();
renderHistory(container, store);

document.getElementById("history-clear").addEventListener("click", () => {
  store.clear();
  renderHistory(container, store);
});
