import { parseSendLink, parseReceiverQrLink } from "../core/link_parser.js";
import { resolveApiBase } from "../core/config.js";
import { LynkApi, TransferNotFoundError } from "../core/api.js";
import { decryptWithIvPrefix } from "../core/crypto.js";
import {
  generateReceiverKeyPair,
  unwrapDelivery,
} from "../core/key_wrap.js";
import { isP2pSupported, receiveViaP2p } from "../core/p2p_session.js";
import { HistoryStore } from "../core/history_store.js";

const historyStore = new HistoryStore();

function recordReceive(transferId, fileNames, totalSize, status) {
  historyStore.add({
    id: transferId,
    type: "received",
    fileNames,
    totalSize,
    timestamp: Date.now(),
    status,
  });
}

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
  accessToken: "",
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
    state.metadata = await api.getTransferMetadata(state.transferId, state.accessToken);
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

  if (isP2pSupported() && (await tryP2pReceive())) {
    return;
  }
  await downloadViaCloud();
}

function tryP2pReceive() {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    setStatus("Waiting for the sender's direct connection…");
    setProgress(0, "");

    receiveViaP2p({
      apiBase: resolveApiBase(),
      transferId: state.transferId,
      aesKey: state.aesKey,
      onStatus: (event, info) => {
        if (settled) {
          if (event === "p2p-progress") {
            const fraction = info.expected ? info.received / info.expected : 0;
            setProgress(fraction * 0.9);
          }
          if (event === "p2p-failed") {
            setStatus("Direct transfer failed. The link may have expired — request a fresh one.", "error");
          }
          return;
        }
        if (event === "p2p-header") {
          els.fileName.textContent = info.name;
          els.fileMeta.textContent = formatBytes(info.size);
        }
        if (typeof event === "string" && event.startsWith("p2p-failed")) {
          settle(false);
        }
      },
      onFileSaved: (plaintext, name) => {
        saveBlob(plaintext, name);
        recordReceive(state.transferId, [name], plaintext.length, "completed (p2p)");
        setProgress(1, "Done");
        setStatus("Saved! Check your browser downloads.", "success");
        els.downloadButton.disabled = false;
        settle(true);
      },
    });
  });
}

async function downloadViaCloud() {
  els.downloadButton.disabled = true;
  setStatus("Downloading and decrypting…");
  setProgress(0);

  try {
    const api = new LynkApi({ baseUrl: resolveApiBase() });
    const downloads = await api.getDownloadUrls(state.transferId, state.accessToken);
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
    recordReceive(
      state.transferId,
      downloads.map((f) => f.fileName),
      downloads.reduce((sum, f) => sum + (state.metadata?.files?.find((x) => x.fileId === f.fileId)?.fileSize ?? 0), 0),
      "completed (cloud)",
    );
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
  state.accessToken = parsed.accessToken;

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
  clean.hash = state.accessToken
    ? `#${state.aesKey}&a=${state.accessToken}`
    : `#${state.aesKey}`;
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
  state.accessToken = direct.accessToken;
  loadTransfer();
} else if (direct.transferId && !direct.aesKey) {
  setStatus("This link is missing its decryption key (#fragment). Use the original QR link.", "error");
}

async function startPairing() {
  const pairButton = document.getElementById("pair-button");
  const qrHolder = document.getElementById("pair-qr-holder");
  pairButton.disabled = true;
  setStatus("Creating a pairing session…");

  try {
    if (typeof crypto.subtle === "undefined") throw new Error("no webcrypto");
    await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);

    const api = new LynkApi({ baseUrl: resolveApiBase() });
    const session = await api.createReceiverSession();
    const receiver = await generateReceiverKeyPair();

    const base =
      window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
        ? window.location.origin
        : "https://lynkshare.app";
    const qrLink = `${base}/receive/${session.sessionId}#pk=${receiver.publicKeyB64}`;

    const qr = window.qrcode(0, "M");
    qr.addData(qrLink);
    qr.make();
    qrHolder.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0 });
    qrHolder.classList.remove("hidden");
    setStatus("Scan this QR from the Lynk app on your phone.");

    state.pairing = {
      sessionId: session.sessionId,
      privateKeySeed: receiver.privateKeySeed,
    };
    pollAttached(api, pairButton);
  } catch (err) {
    if (typeof window.qrcode !== "function") {
      setStatus("QR generator failed to load — please refresh the page.", "error");
    } else if (typeof crypto.subtle === "undefined" || (typeof window !== "undefined" && !window.isSecureContext)) {
      setStatus("Pairing requires a secure HTTPS connection — paste the link instead.", "error");
    } else {
      setStatus(`Pairing unavailable (${err?.message ?? "unsupported"}) — paste the link instead.`, "error");
    }
    pairButton.disabled = false;
  }
}

function pollAttached(api, pairButton) {
  let elapsed = 0;
  clearInterval(window.__lynkPoll);
  window.__lynkPoll = setInterval(async () => {
    elapsed += 2;
    if (!state.pairing) {
      clearInterval(window.__lynkPoll);
      return;
    }
    if (elapsed > 600) {
      clearInterval(window.__lynkPoll);
      setStatus("Pairing window expired — start again.", "error");
      pairButton.disabled = false;
      return;
    }
    try {
      const session = await api.getReceiverSession(state.pairing.sessionId);
      if (session.status === "attached" && session.wrappedKey && session.transferId) {
        clearInterval(window.__lynkPoll);
        const delivery = await unwrapDelivery({
          wrappedBase64: session.wrappedKey,
          privateKeySeed: state.pairing.privateKeySeed,
          sessionId: state.pairing.sessionId,
        });
        state.transferId = session.transferId;
        state.aesKey = delivery.aesKey;
        state.accessToken = delivery.accessToken;
        state.pairing = null;
        document.getElementById("paste-section").classList.add("hidden");
        loadTransfer();
      }
    } catch {}
  }, 2000);
}

document.getElementById("pair-button").addEventListener("click", () => startPairing());

const incomingReceiverQr = parseReceiverQrLink(new URL(window.location.href));
if (incomingReceiverQr.publicKeyB64) {
  document.getElementById("paste-section").classList.add("hidden");
}
