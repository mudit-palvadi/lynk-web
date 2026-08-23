import { resolveApiBase } from "../core/config.js";
import { LynkApi, LimitExceededError } from "../core/api.js";
import { encryptWithIvPrefix } from "../core/crypto.js";
import { encryptedSize, validateSelection } from "../core/tiers.js";
import { buildSendLink } from "../core/link_builder.js";

const els = {
  tierLabel: document.getElementById("tier-label"),
  fileInput: document.getElementById("file-input"),
  dropZone: document.getElementById("drop-zone"),
  fileList: document.getElementById("file-list"),
  pickStatus: document.getElementById("pick-status"),
  sendButton: document.getElementById("send-button"),
  progressCard: document.getElementById("progress-card"),
  progressTitle: document.getElementById("progress-title"),
  progressFill: document.getElementById("progress-fill"),
  progressLabel: document.getElementById("progress-label"),
  resultCard: document.getElementById("result-card"),
  qrHolder: document.getElementById("qr-holder"),
  linkBox: document.getElementById("link-box"),
  copyButton: document.getElementById("copy-button"),
  extendButton: document.getElementById("extend-button"),
  resultStatus: document.getElementById("result-status"),
};

const MODE = "cloud";
let selectedFiles = [];
let currentTransferId = null;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function renderFileList() {
  els.fileList.innerHTML = "";
  let totalPlain = 0;
  for (const file of selectedFiles) {
    totalPlain += encryptedSize(file.size);
    const item = document.createElement("li");
    item.style.cssText =
      "display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px solid var(--border); font-size:0.92rem;";
    item.innerHTML = `<span>📄 ${file.name}</span><span class="text-muted">${formatBytes(
      encryptedSize(file.size),
    )} enc</span>`;
    els.fileList.appendChild(item);
  }
  return totalPlain;
}

function refreshPickState() {
  const totalEncrypted = renderFileList();
  const validation = validateSelection(selectedFiles, MODE, false);

  if (selectedFiles.length === 0) {
    els.pickStatus.textContent = "Free tier allows up to 20 MB total.";
    els.pickStatus.className = "status-pill";
  } else if (!validation.ok) {
    els.pickStatus.textContent = validation.reason;
    els.pickStatus.className = "status-pill status-error";
  } else {
    els.pickStatus.textContent = `${formatBytes(totalEncrypted)} ready to send.`;
    els.pickStatus.className = "status-pill status-success";
  }

  els.sendButton.classList.toggle("hidden", !validation.ok);
}

async function encryptAndUpload() {
  document.getElementById("pick-card").classList.add("hidden");
  els.progressCard.classList.remove("hidden");
  els.resultCard.classList.add("hidden");

  try {
    const key = generateKey();
    const api = new LynkApi({ baseUrl: resolveApiBase() });

    const encrypted = [];
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      els.progressTitle.textContent = "Encrypting…";
      setProgress(i / selectedFiles.length * 0.2, file.name);
      const plain = new Uint8Array(await file.arrayBuffer());
      encrypted.push({
        name: file.name,
        blob: await encryptWithIvPrefix(plain, key),
      });
    }

    els.progressTitle.textContent = "Uploading…";
    const created = await api.createTransfer(
      encrypted.map((f) => ({ name: f.name, size: f.blob.length, type: "application/octet-stream" })),
    );
    currentTransferId = created.transferId;

    for (let i = 0; i < created.files.length; i++) {
      const target = created.files[i];
      await fetch(target.uploadUrl, {
        method: "PUT",
        body: encrypted[i].blob,
        headers: { "Content-Type": "application/octet-stream" },
      });
      await api.completeFile(created.transferId, target.fileId);
      setProgress(0.2 + ((i + 1) / created.files.length) * 0.75, target.fileName);
    }
    setProgress(1, "Done");

    showResult(created.transferId, key, created.expiresIn);
  } catch (err) {
    els.progressTitle.textContent = "Something went wrong";
    els.progressLabel.textContent =
      err instanceof LimitExceededError
        ? err.message
        : "Upload failed — check your connection and try again.";
  }
}

function showResult(transferId, key, expiresIn) {
  els.progressCard.classList.add("hidden");
  els.resultCard.classList.remove("hidden");

  const base =
    window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
      ? window.location.origin
      : "https://lynkshare.app";
  const link = buildSendLink(base, transferId, key);

  const qr = window.qrcode(0, "M");
  qr.addData(link);
  qr.make();
  els.qrHolder.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0 });

  els.linkBox.textContent = link;

  let remaining = expiresIn ?? 600;
  const tick = () => {
    const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
    const ss = String(remaining % 60).padStart(2, "0");
    setResultStatus(`Session expires in ${mm}:${ss}`);
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

els.tierLabel.textContent = "20 MB";
els.fileInput.addEventListener("change", () => {
  selectedFiles = Array.from(els.fileInput.files ?? []);
  refreshPickState();
});

els.dropZone.addEventListener("dragover", (event) => event.preventDefault());
els.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  selectedFiles = Array.from(event.dataTransfer?.files ?? []);
  refreshPickState();
});

els.sendButton.addEventListener("click", () => encryptAndUpload());

els.copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.linkBox.textContent);
    setResultStatus("Link copied.");
  } catch {
    const range = document.createRange();
    range.selectNodeContents(els.linkBox);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    setResultStatus("Press Ctrl/Cmd+C to copy the selected link.", "error");
  }
});

els.extendButton.addEventListener("click", async () => {
  if (!currentTransferId) return;
  els.extendButton.disabled = true;
  try {
    const api = new LynkApi({ baseUrl: resolveApiBase() });
    const result = await api.extendTransfer(currentTransferId);
    setResultStatus(`Session extended — ${Math.round(result.expiresIn / 60)} minutes remaining.`);
  } catch {
    setResultStatus("Could not extend the session.", "error");
  } finally {
    els.extendButton.disabled = false;
  }
});
