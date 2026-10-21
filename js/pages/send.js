import { resolveApiBase } from "../core/config.js";
import { LynkApi, LimitExceededError } from "../core/api.js";
import { encryptWithIvPrefix } from "../core/crypto.js";
import { encryptedSize, maxTotalSize, validateSelection } from "../core/tiers.js";
import { buildSendLink } from "../core/link_builder.js";
import { parseReceiverQrLink } from "../core/link_parser.js";
import { isP2pSupported, sendViaP2p } from "../core/p2p_session.js";
import { scanReceiverQr } from "../core/qr_scanner.js";
import { wrapKey } from "../core/key_wrap.js";
import { HistoryStore } from "../core/history_store.js";

const els = {
  tierLabel: document.getElementById("tier-label"),
  fileInput: document.getElementById("file-input"),
  dropZone: document.getElementById("drop-zone"),
  fileList: document.getElementById("file-list"),
  pickStatus: document.getElementById("pick-status"),
  p2pButton: document.getElementById("send-p2p-button"),
  cloudButton: document.getElementById("send-cloud-button"),
  progressCard: document.getElementById("progress-card"),
  progressTitle: document.getElementById("progress-title"),
  progressFill: document.getElementById("progress-fill"),
  progressLabel: document.getElementById("progress-label"),
  resultCard: document.getElementById("result-card"),
  qrHolder: document.getElementById("qr-holder"),
  copyButton: document.getElementById("copy-button"),
  extendButton: document.getElementById("extend-button"),
  resultStatus: document.getElementById("result-status"),
};

const MODE = "cloud";
const historyStore = new HistoryStore();
let selectedFiles = [];
let currentTransferId = null;
let currentSenderSecret = null;

// The share link, kept in memory only.
//
// The link carries the AES key and the access token, so it is never written
// into the page: this page loads a third-party ad script, and anything in
// the DOM can be read by it. The QR code is the only rendering of the link
// the page produces, and the copy button hands the link straight to the
// clipboard.
let currentLink = null;
let currentAccessToken = null;
let pendingPair = null;
let cancelScan = null;

function recordSend(status) {
  historyStore.add({
    id: currentTransferId ?? "p2p",
    type: "sent",
    fileNames: selectedFiles.map((f) => f.name),
    totalSize: selectedFiles.reduce((sum, f) => sum + f.size, 0),
    timestamp: Date.now(),
    status,
  });
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileBadge(name) {
  const ext = (name.split(".").pop() || "").toUpperCase();
  return ext.length > 0 && ext.length <= 4 ? ext : "FILE";
}

function setProgress(fraction, label) {
  const pct = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
  els.progressFill.style.width = `${pct}%`;
  if (label) els.progressLabel.textContent = label;
}

function generateKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function removeFile(index) {
  selectedFiles.splice(index, 1);
  refreshPickState();
}

function renderFileList() {
  els.fileList.innerHTML = "";
  let totalEncrypted = 0;

  selectedFiles.forEach((file, index) => {
    const encSize = encryptedSize(file.size);
    totalEncrypted += encSize;

    const item = document.createElement("li");
    item.className = "file-item";

    const badge = getFileBadge(file.name);
    item.innerHTML = `
      <div class="file-info">
        <span class="file-type-badge">${badge}</span>
        <span class="file-name" title="${file.name}">${file.name}</span>
      </div>
      <div class="file-meta-group">
        <span class="file-size-tag">${formatBytes(file.size)}</span>
        <button class="file-remove-btn" title="Remove file" data-index="${index}" aria-label="Remove ${file.name}">Remove</button>
      </div>
    `;

    const removeBtn = item.querySelector(".file-remove-btn");
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeFile(index);
    });

    els.fileList.appendChild(item);
  });

  return totalEncrypted;
}

function refreshPickState() {
  const totalEncrypted = renderFileList();
  const validation = validateSelection(selectedFiles, MODE, false);

  if (selectedFiles.length === 0) {
    els.pickStatus.textContent = `Free tier allows up to ${maxTotalSize("cloud", false) / (1024 * 1024)} MB total.`;
    els.pickStatus.className = "status-pill";
    els.p2pButton.classList.add("hidden");
    els.cloudButton.classList.add("hidden");
  } else if (!validation.ok) {
    els.pickStatus.textContent = validation.reason;
    els.pickStatus.className = "status-pill status-error";
    els.p2pButton.classList.add("hidden");
    els.cloudButton.classList.add("hidden");
  } else {
    els.pickStatus.textContent = `${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} (${formatBytes(totalEncrypted)} encrypted) selected.`;
    els.pickStatus.className = "status-pill status-success";
    els.p2pButton.classList.toggle("hidden", !isP2pSupported());
    els.cloudButton.classList.remove("hidden");
  }
}

async function encryptAll(key) {
  const encrypted = [];
  for (let i = 0; i < selectedFiles.length; i++) {
    const file = selectedFiles[i];
    els.progressTitle.textContent = "Encrypting files...";
    setProgress((i / selectedFiles.length) * 0.25, `Encrypting ${file.name}...`);
    const plain = new Uint8Array(await file.arrayBuffer());
    encrypted.push({
      name: file.name,
      blob: await encryptWithIvPrefix(plain, key),
    });
  }
  return encrypted;
}

/// Creates the server-side transfer and remembers its credentials.
///
/// The P2P flow needs this *before* it starts: the receiver reads the
/// transfer metadata before it connects, and the signaling server refuses
/// rooms whose id it does not know. Creating the transfer up front also puts
/// the access token into the share link, which the metadata call requires.
async function createTransferSession(encrypted) {
  const api = new LynkApi({ baseUrl: resolveApiBase() });
  const created = await api.createTransfer(
    encrypted.map((f) => ({ name: f.name, size: f.blob.length, type: "application/octet-stream" })),
  );
  currentTransferId = created.transferId;
  currentSenderSecret = created.senderSecret;
  currentAccessToken = created.accessToken;
  return created;
}

/// Uploads the encrypted bytes to the transfer's presigned URLs.
///
/// `created` may be a transfer that was created earlier (the P2P fallback
/// reuses it) so the link the receiver already has stays valid.
async function uploadEncrypted(encrypted, key, created = null) {
  document.getElementById("pick-card").classList.add("hidden");
  els.progressCard.classList.remove("hidden");
  els.resultCard.classList.add("hidden");

  const api = new LynkApi({ baseUrl: resolveApiBase() });
  els.progressTitle.textContent = "Uploading to Cloud Storage...";
  const session = created ?? (await createTransferSession(encrypted));

  for (let i = 0; i < session.files.length; i++) {
    const target = session.files[i];
    setProgress(0.25 + (i / session.files.length) * 0.7, `Uploading ${target.fileName}...`);
    await fetch(target.uploadUrl, {
      method: "PUT",
      body: encrypted[i].blob,
      headers: { "Content-Type": "application/octet-stream" },
    });
    await api.completeFile(session.transferId, target.fileId, currentSenderSecret);
  }
  setProgress(1, "Upload complete");

  if (pendingPair) {
    await deliverToPairedPhone(encrypted, key);
  }
  recordSend("completed (cloud)");
  showResult(session.transferId, key, session.expiresIn);
}

async function deliverToPairedPhone(encrypted, key) {
  try {
    const api = new LynkApi({ baseUrl: resolveApiBase() });
    const wrappedKey = await wrapKey({
      aesKey: key,
      accessToken: currentAccessToken,
      receiverPublicKeyB64: pendingPair.publicKeyB64,
      sessionId: pendingPair.sessionId,
    });
    await api.attachTransfer(pendingPair.sessionId, currentTransferId, wrappedKey);
    pendingPair = null;
    document.getElementById("pair-state").textContent = "";
  } catch {
    document.getElementById("pair-state").textContent =
      "Pairing failed — use the link instead.";
  }
}

async function sendCloud() {
  try {
    const key = generateKey();
    const encrypted = await encryptAll(key);
    await uploadEncrypted(encrypted, key);
  } catch (err) {
    els.progressTitle.textContent = "Something went wrong";
    els.progressLabel.textContent =
      err instanceof LimitExceededError
        ? err.message
        : "Upload failed — check your connection and try again.";
  }
}

async function sendP2P() {
  try {
    const key = generateKey();
    const encrypted = await encryptAll(key);

    // The P2P session is a real server-side transfer: the receiver fetches
    // the transfer metadata before it opens the signaling room, and the
    // signaling server only accepts rooms whose id it knows. The link also
    // carries the access token, which the metadata call requires.
    const created = await createTransferSession(encrypted);

    showResult(
      created.transferId,
      key,
      created.expiresIn,
      "Waiting for receiver to connect...",
    );
    setResultStatus("Waiting for receiver — keep this tab open.", "warn");

    const delivered = await sendViaP2p({
      apiBase: resolveApiBase(),
      sessionId: created.transferId,
      files: encrypted,
      onStatus: (event) => {
        if (event === "p2p-sending") setResultStatus("Direct P2P streaming in progress...", "success");
        if (typeof event === "string" && event.startsWith("p2p-failed")) {
          setResultStatus("Direct connection failed — switching to Cloud Session...", "warn");
        }
      },
    });

    if (delivered) {
      clearInterval(window.__lynkCountdown);
      recordSend("completed (p2p)");
      setResultStatus("Delivered directly. Receiver received all files.", "success");
      return;
    }

    // Direct delivery failed: fall back to the cloud, but complete the SAME
    // transfer, so the link the receiver already has keeps working.
    await uploadEncrypted(encrypted, key, created);
  } catch (err) {
    els.progressTitle.textContent = "Something went wrong";
    els.progressLabel.textContent = err?.message ?? "Transfer failed.";
  }
}

function showResult(transferId, key, expiresIn, statusOverride) {
  document.getElementById("pick-card").classList.add("hidden");
  els.progressCard.classList.add("hidden");
  els.resultCard.classList.remove("hidden");

  const base =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? window.location.origin
      : "https://lynkshare.app";
  const link = buildSendLink(base, transferId, key, currentAccessToken);

  if (typeof window.qrcode === "function") {
    const qr = window.qrcode(0, "M");
    qr.addData(link);
    qr.make();
    els.qrHolder.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0 });
  } else {
    els.qrHolder.innerHTML = `<p class="text-muted" style="color:#000; padding:10px;">QR generator unavailable</p>`;
  }

  // Kept out of the DOM on purpose: see `currentLink`.
  currentLink = link;

  if (statusOverride) {
    setResultStatus(statusOverride);
    return;
  }

  let remaining = expiresIn ?? 600;
  const tick = () => {
    const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
    const ss = String(remaining % 60).padStart(2, "0");
    setResultStatus(`Session active — expires in ${mm}:${ss}`);
  };
  tick();
  clearInterval(window.__lynkCountdown);
  window.__lynkCountdown = setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) {
      clearInterval(window.__lynkCountdown);
      setResultStatus("Session expired.", "error");
      return;
    }
    tick();
  }, 1000);
}

function setResultStatus(message, tone) {
  els.resultStatus.textContent = message;
  els.resultStatus.className = `status-pill${tone ? ` status-${tone}` : ""}`;
}

els.tierLabel.textContent = `${maxTotalSize("cloud", false) / (1024 * 1024)} MB`;

els.fileInput.addEventListener("change", () => {
  const newFiles = Array.from(els.fileInput.files ?? []);
  selectedFiles = [...selectedFiles, ...newFiles];
  els.fileInput.value = "";
  refreshPickState();
});

// Drag and drop events
els.dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  els.dropZone.classList.add("drag-active");
});

els.dropZone.addEventListener("dragenter", (e) => {
  e.preventDefault();
  els.dropZone.classList.add("drag-active");
});

els.dropZone.addEventListener("dragleave", (e) => {
  e.preventDefault();
  els.dropZone.classList.remove("drag-active");
});

els.dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  els.dropZone.classList.remove("drag-active");
  const dropped = Array.from(e.dataTransfer?.files ?? []);
  selectedFiles = [...selectedFiles, ...dropped];
  refreshPickState();
});

els.p2pButton.addEventListener("click", () => sendP2P());
els.cloudButton.addEventListener("click", () => sendCloud());

document.getElementById("scan-pair-button").addEventListener("click", async () => {
  if (!selectedFiles.length) {
    els.pickStatus.textContent = "Select files first before pairing.";
    els.pickStatus.className = "status-pill status-warn";
    return;
  }
  const scannerCard = document.getElementById("scanner-card");
  const video = document.getElementById("camera-preview");
  const scanStatus = document.getElementById("scan-status");
  scannerCard.classList.remove("hidden");
  scanStatus.textContent = "Starting camera...";

  try {
    const link = await scanReceiverQr(video, {
      onCancel: (cleanup) => {
        cancelScan = cleanup;
      },
    });
    scannerCard.classList.add("hidden");
    cancelScan = null;

    const parsed = parseReceiverQrLink(new URL(link));
    if (!parsed.sessionId || !parsed.publicKeyB64) {
      scanStatus.textContent = "";
      document.getElementById("pair-state").textContent =
        "QR code was not a valid Lynk receiver code.";
      return;
    }
    pendingPair = parsed;
    document.getElementById("pair-state").textContent =
      "Paired with phone — select Cloud Session to send.";
  } catch (err) {
    scannerCard.classList.add("hidden");
    cancelScan = null;
    scanStatus.textContent = `Camera unavailable: ${err?.message ?? "permission denied"}`;
  }
});

document.getElementById("scan-cancel-button").addEventListener("click", () => {
  cancelScan?.();
  cancelScan = null;
  document.getElementById("scanner-card").classList.add("hidden");
});

els.copyButton.addEventListener("click", async () => {
  if (!currentLink) return;
  try {
    await navigator.clipboard.writeText(currentLink);
    const origText = els.copyButton.textContent;
    els.copyButton.textContent = "Copied";
    setResultStatus("Link copied to clipboard.", "success");
    setTimeout(() => {
      els.copyButton.textContent = origText;
    }, 2500);
  } catch {
    // The link is never in the DOM, so it cannot be selected by hand. A
    // prompt shows it to the user without putting it back on the page.
    window.prompt("Copy this link:", currentLink);
    setResultStatus("Copy the link from the box above.", "warn");
  }
});

els.extendButton.addEventListener("click", async () => {
  if (!currentTransferId) return;
  els.extendButton.disabled = true;
  try {
    const api = new LynkApi({ baseUrl: resolveApiBase() });
    const result = await api.extendTransfer(currentTransferId, currentSenderSecret);
    setResultStatus(`Session extended — ${Math.round(result.expiresIn / 60)} minutes remaining.`, "success");
  } catch {
    setResultStatus("Could not extend session.", "error");
  } finally {
    els.extendButton.disabled = false;
  }
});

refreshPickState();
