import { parseSendLink } from "../core/link_parser.js";
import { resolveApiBase } from "../core/config.js";
import { LynkApi, TransferNotFoundError } from "../core/api.js";
import { decryptWithIvPrefix } from "../core/crypto.js";

const els = {
  pasteSection: document.getElementById("paste-section"),
  pasteInput: document.getElementById("paste-input"),
  pasteButton: document.getElementById("paste-button"),
  status: document.getElementById("status"),
  transferCard: document.getElementById("transfer-card"),
  fileName: document.getElementById("file-name"),
  fileMeta: document.getElementById("file-meta"),
  progressTrack: document.getElementById("progress-track"),
  progressFill: document.getElementById("progress-fill"),
  progressLabel: document.getElementById("progress-label"),
  downloadButton: document.getElementById("download-button"),
};

const state = {
  transferId: "",
  aesKey: "",
  metadata: null,
};

function setStatus(message, tone = "muted") {
  els.status.textContent = message;
  const modifier = tone === "muted" ? "" : ` status-${tone}`;
  els.status.className = `status-pill${modifier}`;
}

function showTransferCard() {
  els.pasteSection.classList.add("hidden");
  els.transferCard.classList.remove("hidden");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setProgress(fraction, label) {
  const pct = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
  els.progressFill.style.width = `${pct}%`;
  els.progressLabel.textContent = label ?? `${pct}%`;
}

async function loadTransfer() {
  showTransferCard();
  setStatus("Fetching transfer details…");

  try {
    const api = new LynkApi({ baseUrl: resolveApiBase() });
    state.metadata = await api.getTransferMetadata(state.transferId);
  } catch (err) {
    if (err instanceof TransferNotFoundError) {
      setStatus("Transfer not found or expired. Ask the sender for a fresh QR code.", "error");
    } else {
      setStatus("Could not reach the Lynk server. Check your connection.", "error");
    }
    return;
  }

  const files = state.metadata.files ?? [];
  const names = files.map((f) => f.file_name).join(", ");
  els.fileName.textContent = files.length === 1 ? files[0].file_name : `${files.length} files`;
  els.fileMeta.textContent =
    files.length === 1
      ? formatBytes(files[0].file_size)
      : `${names} — ${formatBytes(state.metadata.total_size)} total`;

  setStatus("Ready to download.");
  els.downloadButton.classList.remove("hidden");
}

async function streamWithProgress(response, onProgress) {
  const total = Number(response.headers.get("content-length")) || 0;
  if (!response.body || !total) {
    return new Uint8Array(await response.arrayBuffer());
  }
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received / total, received);
  }
  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function saveBlob(bytes, fileName) {
  const blob = new Blob([bytes]);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function startDownload() {
  els.downloadButton.disabled = true;
  setStatus("Downloading and decrypting…");
  setProgress(0);

  try {
    const api = new LynkApi({ baseUrl: resolveApiBase() });
    const downloads = await api.getDownloadUrls(state.transferId);
    if (downloads.length === 0) throw new Error("no downloadable files");

    let completed = 0;
    for (const file of downloads) {
      const response = await fetch(file.downloadUrl);
      if (!response.ok) throw new Error(`download failed (${response.status})`);

      const packed = await streamWithProgress(response, (fraction, bytes) => {
        const overall = (completed + Math.min(fraction, 1)) / downloads.length;
        setProgress(overall * 0.9, `${formatBytes(bytes)} of ${file.fileName}`);
      });

      setStatus("Decrypting…");
      const plaintext = await decryptWithIvPrefix(packed, state.aesKey);
      saveBlob(plaintext, file.fileName);
      completed += 1;
    }

    setProgress(1, "Done");
    setStatus("Saved! Check your browser downloads.", "success");
  } catch {
    setStatus("Download failed. The link may have expired — request a fresh one.", "error");
    setProgress(0, "");
  } finally {
    els.downloadButton.disabled = false;
  }
}

function adoptLink(url) {
  const parsed = parseSendLink(url);
  state.transferId = parsed.transferId;
  state.aesKey = parsed.aesKey;

  if (!state.transferId) {
    setStatus("Paste a full Lynk link (it looks like https://lynkshare.app/send/…#key).", "error");
    return;
  }
  if (!state.aesKey) {
    setStatus("This link is missing its decryption key (#fragment). Use the original QR link.", "error");
    return;
  }

  const clean = new URL(window.location.href);
  clean.pathname = `/send/${encodeURIComponent(state.transferId)}`;
  clean.hash = `#${state.aesKey}`;
  clean.searchParams.delete("url");
  window.history.replaceState(null, "", clean);

  loadTransfer();
}

els.downloadButton.addEventListener("click", () => startDownload());

els.pasteButton.addEventListener("click", () => {
  const raw = els.pasteInput.value.trim();
  if (!raw) return;
  try {
    adoptLink(new URL(raw));
  } catch {
    setStatus("That does not look like a valid link.", "error");
  }
});

els.pasteInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") els.pasteButton.click();
});

const direct = parseSendLink(new URL(window.location.href));
if (direct.transferId && direct.aesKey) {
  state.transferId = direct.transferId;
  state.aesKey = direct.aesKey;
  loadTransfer();
} else if (direct.transferId && !direct.aesKey) {
  setStatus("This link is missing its decryption key (#fragment). Use the original QR link.", "error");
}
