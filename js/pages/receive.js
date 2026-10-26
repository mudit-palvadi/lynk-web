import { parseSendLink, parseReceiverQrLink } from "../core/link_parser.js";
import {
  clearStashedLink,
  peekStashedLink,
  stashLink,
} from "../core/link_vault.js";
import { safeFileName } from "../core/file_names.js";
import { resolveApiBase } from "../core/config.js";
import { ApiError, LynkApi, TransferNotFoundError } from "../core/api.js";
import { decryptWithIvPrefix } from "../core/crypto.js";
import {
  generateReceiverKeyPair,
  unwrapDelivery,
} from "../core/key_wrap.js";
import { isP2pSupported, receiveViaP2p } from "../core/p2p_session.js";
import { acquireReceiverOwnership } from "../core/receiver_ownership.js";
import { HistoryStore } from "../core/history_store.js";
import {
  isNotReadyError,
  TransferStillUploadingError,
  waitForTransferReady,
} from "../core/ready_wait.js";

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
  receiveSection: document.getElementById("receive-section"),
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
  // "cloud", "p2p", or "" while unknown (a plain link).
  mode: "",
};

function setStatus(message, tone = "muted") {
  els.status.textContent = message;
  const modifier = tone === "muted" ? "" : ` status-${tone}`;
  els.status.className = `status-pill${modifier}`;
}

function showTransferCard() {
  els.receiveSection.classList.add("hidden");
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
  state.cancelDirect?.();
  showTransferCard();
  setStatus("Fetching transfer details…");

  try {
    const api = new LynkApi({ baseUrl: resolveApiBase() });
    state.metadata = await api.getTransferMetadata(state.transferId, state.accessToken);
  } catch (err) {
    if (err instanceof TransferNotFoundError) {
      setStatus("Transfer not found or expired. Ask the sender for a fresh QR code.", "error");
    } else {
      setStatus("Could not reach the LynkShare server. Check your connection.", "error");
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

  setStatus(
    state.metadata.status === "ready"
      ? "Ready to download."
      : "The sender is still uploading. Press Download to wait for it.",
  );
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
  // The name came from the sender, so it is reduced to a single safe path
  // segment before the browser is asked to save it.
  anchor.download = safeFileName(fileName);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function startDownload() {
  if (state.downloadActive) return;
  state.downloadActive = true;
  els.downloadButton.disabled = true;
  els.downloadButton.textContent = "Download & Decrypt";
  try {
    // The collected mode is a hint; verified R2 completion takes precedence.
    if (state.metadata?.status !== "ready" && state.mode !== "cloud" && isP2pSupported()) {
      const received = await tryP2pReceive();
      if (received !== false) return; // true: saved; null: cancelled/replaced
    }
    await downloadViaCloud();
  } finally {
    state.downloadActive = false;
  }
}

function tryP2pReceive() {
  return new Promise((resolve) => {
    let settled = false;
    let connected = false;
    let cleanup;
    let timer;
    let ownership;
    let nativeSetup = false;
    let finishing = false;
    let result;
    let started;
    const apiBase = resolveApiBase();
    const transferId = state.transferId;
    const accessToken = state.accessToken;
    const aesKey = state.aesKey;
    const names = [];
    let totalBytes = 0;
    const expectedFiles = Math.max(state.metadata?.total_files ?? state.metadata?.files?.length ?? 1, 1);
    const finish = () => {
      if (!settled || nativeSetup || finishing) return;
      finishing = true;
      // Await native cleanup before returning ownership to another tab. Also
      // handle native setup that invokes a failure callback synchronously.
      let cleaned;
      try { cleaned = cleanup?.(); } catch { /* Still release ownership. */ }
      Promise.resolve(cleaned).catch(() => {}).then(() => ownership?.release())
        .then(() => resolve(result), () => resolve(result));
    };
    const settle = (value) => {
      if (settled) return;
      settled = true;
      result = value;
      clearTimeout(timer);
      if (state.cancelDirect === cancel) state.cancelDirect = null;
      finish();
    };
    const cancel = () => {
      if (settled) return;
      els.downloadButton.disabled = false;
      els.downloadButton.textContent = "Retry";
      setStatus("Direct reception stopped. Press Retry to receive again.");
      settle(null);
    };
    state.cancelDirect = cancel;
    const pollReadiness = async () => {
      if (settled || connected || performance.now() - started >= 30000) return;
      try {
        const api = new LynkApi({ baseUrl: apiBase });
        const metadata = await api.getTransferMetadata(transferId, accessToken);
        // Channel open or cancellation can win while the request is in flight.
        if (settled || connected) return;
        if (metadata.status === "ready") {
          state.metadata = metadata;
          settle(false);
          return;
        }
      } catch {
        // A transient metadata failure does not decide the transport.
      }
      if (!settled && !connected) timer = setTimeout(pollReadiness, 3000);
    };

    setStatus("Checking whether this transfer is open in another tab…");
    setProgress(0, "");

    (async () => {
      const acquired = await acquireReceiverOwnership({ apiBase, transferId });
      if (settled) {
        // A cancellation/pagehide may win before the browser grants the lock.
        if (acquired.status === "acquired") await acquired.release();
        return;
      }
      if (acquired.status === "busy") {
        setStatus("This transfer is already receiving in another tab. Finish or close that tab, then press Retry.");
        els.downloadButton.disabled = false;
        els.downloadButton.textContent = "Retry";
        settle(null); // Do not start a duplicate cloud download on contention.
        return;
      }
      if (acquired.status !== "acquired") {
        setStatus("Direct reception is unavailable here. Waiting for the sender's cloud upload…");
        settle(false);
        return;
      }
      ownership = acquired;
      started = performance.now();
      setStatus("Waiting for the sender's direct connection…");
      nativeSetup = true;
      try {
        cleanup = receiveViaP2p({
          apiBase,
          transferId,
          aesKey,
          accessToken,
          onStatus: (event, info) => {
            if (settled) return;
            if (event === "p2p-connected" || event === "p2p-header" || event === "p2p-progress") {
              connected = true;
              clearTimeout(timer);
            }
            if (event === "p2p-progress") {
              const fraction = info.expected ? info.received / info.expected : 0;
              setProgress(fraction * 0.9);
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
            if (settled) return;
            connected = true;
            clearTimeout(timer);
            saveBlob(plaintext, name);
            names.push(name);
            totalBytes += plaintext.length;
            if (names.length < expectedFiles) return;
            recordReceive(transferId, names, totalBytes, "completed (p2p)");
            setProgress(1, "Done");
            setStatus("Saved! Check your browser downloads.", "success");
            els.downloadButton.disabled = false;
            settle(true);
          },
        });
      } finally {
        nativeSetup = false;
        finish();
      }
      if (!settled && !connected) timer = setTimeout(pollReadiness, 3000);
    })().catch(() => settle(false));
  });
}

async function downloadViaCloud() {
  els.downloadButton.disabled = true;
  setStatus("Downloading and decrypting…");
  setProgress(0);

  try {
    const api = new LynkApi({ baseUrl: resolveApiBase() });
    const downloads = await fetchDownloadUrls(api);
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
    // The transfer is done, so the key is not needed any more.
    clearStashedLink();
  } catch (err) {
    setStatus(describeDownloadFailure(err), "error");
    setProgress(0, "");
  } finally {
    els.downloadButton.disabled = false;
  }
}

/**
 * Asks the server for the file links, waiting for the sender when it is not
 * ready yet.
 *
 * The sender shows its QR code before it uploads anything, so a receiver that
 * asks straight away is told the transfer is not ready. That is a temporary
 * state and the wait is the right answer, so the receiver keeps asking until
 * the sender is done.
 */
async function fetchDownloadUrls(api) {
  try {
    return await api.getDownloadUrls(state.transferId, state.accessToken);
  } catch (err) {
    if (!isNotReadyError(err)) throw err;

    setStatus("The sender is still uploading…");
    setProgress(0, "Waiting for the sender");

    const metadata = await waitForTransferReady({
      api,
      transferId: state.transferId,
      accessToken: state.accessToken,
      onWait: () => {
        setStatus("The sender is still uploading…");
        setProgress(0, "Waiting for the sender");
      },
    });
    state.metadata = metadata;

    return api.getDownloadUrls(state.transferId, state.accessToken);
  }
}

/**
 * Says what went wrong without blaming the link for something it is not.
 *
 * A transfer that is not ready yet is a sender that is still working, not an
 * expired link.
 */
function describeDownloadFailure(err) {
  if (err instanceof TransferStillUploadingError || isNotReadyError(err)) {
    return "The sender is still uploading. Wait a moment and try again.";
  }
  if (err instanceof TransferNotFoundError) {
    return "Transfer not found or expired. Ask the sender for a fresh QR code.";
  }
  return "Download failed. Check your connection, or ask the sender for a fresh QR code.";
}

function adoptLink(url) {
  const parsed = parseSendLink(url);
  state.transferId = parsed.transferId;
  state.aesKey = parsed.aesKey;
  state.accessToken = parsed.accessToken;

  if (!state.transferId) {
    setStatus("That is not a valid LynkShare transfer link.", "error");
    return;
  }
  if (!state.aesKey) {
    setStatus("This link is missing its decryption key (#fragment). Use the original QR link.", "error");
    return;
  }

  const clean = new URL(window.location.href);
  clean.pathname = `/send/${encodeURIComponent(state.transferId)}`;
  clean.hash = "";
  clean.searchParams.delete("url");
  window.history.replaceState(null, "", clean);

  // Take the key out of the address bar, so that the ad script on this page
  // cannot read it, and keep it for a reload.
  stashLink({
    transferId: state.transferId,
    aesKey: state.aesKey,
    accessToken: state.accessToken,
  });

  loadTransfer();
}

els.downloadButton.addEventListener("click", () => startDownload());

// A hidden tab may still be receiving; only leaving the page cancels direct
// work. BFCache restoration keeps the Retry button and claims a fresh lock.
window.addEventListener("pagehide", () => state.cancelDirect?.());

/**
 * Receives by typing the code the sender shows.
 *
 * The code only names a session. The browser publishes an ephemeral public
 * key for it and asks again and again until the sender has wrapped the
 * transfer key for that key. Nothing secret is in the code itself.
 */
async function startCodeReceive() {
  const input = document.getElementById("code-input");
  const codeButton = document.getElementById("code-button");
  const code = input.value.replace(/\D/g, "");
  if (code.length !== 6) {
    setStatus("Type the 6-digit code the sender shows.", "error");
    return;
  }

  codeButton.disabled = true;
  clearInterval(window.__lynkCodePoll);
  setStatus("Checking the code…");

  try {
    if (typeof crypto.subtle === "undefined") throw new Error("no webcrypto");
    const api = new LynkApi({ baseUrl: resolveApiBase() });
    const receiver = await generateReceiverKeyPair();
    const session = await api.joinSenderSession(code, receiver.publicKeyB64);
    input.value = "";
    setStatus("Waiting for the sender to share the key…");

    let elapsed = 0;
    window.__lynkCodePoll = setInterval(async () => {
      elapsed += 2;
      if (elapsed > session.expiresIn) {
        clearInterval(window.__lynkCodePoll);
        codeButton.disabled = false;
        setStatus("That code expired. Ask the sender for a new one.", "error");
        return;
      }
      try {
        const key = await api.getSenderSessionKey(session.sessionId);
        if (!key) return;
        clearInterval(window.__lynkCodePoll);
        const delivery = await unwrapDelivery({
          wrappedBase64: key.wrappedKey,
          privateKeySeed: receiver.privateKeySeed,
          sessionId: session.sessionId,
        });
        state.transferId = key.transferId;
        state.aesKey = delivery.aesKey;
        state.accessToken = delivery.accessToken;
        state.mode = key.mode;
        stashLink({
          transferId: state.transferId,
          aesKey: state.aesKey,
          accessToken: state.accessToken,
        });
        document.getElementById("receive-section").classList.add("hidden");
        loadTransfer();
      } catch (err) {
        clearInterval(window.__lynkCodePoll);
        codeButton.disabled = false;
        setStatus(
          "Could not pair with that code. Ask the sender for a new one.",
          "error",
        );
      }
    }, 2000);
  } catch (err) {
    codeButton.disabled = false;
    if (err instanceof TransferNotFoundError) {
      setStatus("That code is not valid or has expired.", "error");
    } else if (err instanceof ApiError && err.status === 409) {
      setStatus("That code is already paired with another device.", "error");
    } else {
      setStatus("Could not use that code. Check your connection.", "error");
    }
  }
}

document
  .getElementById("code-button")
  .addEventListener("click", () => startCodeReceive());
document.getElementById("code-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter") startCodeReceive();
});

const initialLink = window.__lynkTakeInitialLink?.() ?? window.location.href;
const direct = parseSendLink(new URL(initialLink));
const stashed = direct.transferId && !direct.aesKey ? peekStashedLink() : null;
if (direct.transferId && direct.aesKey) {
  // The head bootstrap has already scrubbed the address bar. adoptLink also
  // scrubs links adopted later and keeps the parsed key for this transfer.
  adoptLink(new URL(initialLink));
} else if (stashed && stashed.transferId === direct.transferId) {
  // A reload: the fragment is gone, but the key is still in this tab.
  state.transferId = stashed.transferId;
  state.aesKey = stashed.aesKey;
  state.accessToken = stashed.accessToken ?? "";
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
    setStatus("Scan this QR from the LynkShare app on your phone.");

    state.pairing = {
      sessionId: session.sessionId,
      privateKeySeed: receiver.privateKeySeed,
    };
    pollAttached(api, pairButton);
  } catch (err) {
    if (typeof window.qrcode !== "function") {
      setStatus("QR generator failed to load — please refresh the page.", "error");
    } else if (typeof crypto.subtle === "undefined" || (typeof window !== "undefined" && !window.isSecureContext)) {
      setStatus("Pairing requires a secure HTTPS connection — use the 6-digit code instead.", "error");
    } else {
      setStatus(`Pairing unavailable (${err?.message ?? "unsupported"}) — use the 6-digit code instead.`, "error");
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
        stashLink({
          transferId: state.transferId,
          aesKey: state.aesKey,
          accessToken: state.accessToken,
        });
        state.pairing = null;
        document.getElementById("receive-section").classList.add("hidden");
        loadTransfer();
      }
    } catch {}
  }, 2000);
}

document.getElementById("pair-button").addEventListener("click", () => startPairing());

const incomingReceiverQr = parseReceiverQrLink(new URL(window.location.href));
if (incomingReceiverQr.publicKeyB64) {
  document.getElementById("receive-section").classList.add("hidden");
}
