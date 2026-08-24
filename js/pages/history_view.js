import { HistoryStore } from "../core/history_store.js";

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

export function renderHistory(container, store = new HistoryStore()) {
  const records = store.list();
  if (records.length === 0) {
    container.innerHTML =
      '<p class="text-muted" style="font-size:0.9rem;">No transfers in this tab session yet.</p>';
    return;
  }
  const items = records
    .map((r) => {
      const arrow = r.type === "sent" ? "⬆️" : "⬇️";
      const names =
        r.fileNames.length > 2
          ? `${escapeHtml(r.fileNames[0])} +${r.fileNames.length - 1} more`
          : escapeHtml(r.fileNames.join(", ")) || "—";
      const when = new Date(r.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `<li style="display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-bottom:1px solid var(--border); font-size:0.92rem;">
        <span>${arrow} ${names}</span>
        <span class="text-muted">${formatBytes(r.totalSize)} · ${when}</span>
      </li>`;
    })
    .join("");
  container.innerHTML = `<ul style="list-style:none; margin-top:12px;">${items}</ul>`;
}
