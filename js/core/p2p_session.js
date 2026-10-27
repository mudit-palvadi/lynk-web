import { parseMessage, encodeOffer } from "./signaling.js";
import { parseText, encodeHeader, encodeEof, encodeDone, encodeHello } from "./framer.js";
import { ChunkCollector } from "./chunk_collector.js";
import { ChunkSender } from "./chunk_sender.js";
import { decryptWithIvPrefix, encryptWithIvPrefix } from "./crypto.js";
import { P2pCoordinator } from "./p2p_coordinator.js";

const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302"] },
  { urls: ["stun:stun1.l.google.com:19302"] },
  { urls: ["stun:stun2.l.google.com:19302"] },
];

export function toWebSocketUrl(apiBase, transferId) {
  return `${apiBase.replace(/^http/, "ws")}/ws/signaling/${encodeURIComponent(transferId)}`;
}

// The signaling room only lets a socket in after this frame (#32). It has to be
// the first thing on the wire, before any offer or candidate.
export function sendAuthFrame(ws, accessToken) {
  if (!accessToken || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "auth", token: accessToken }));
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// The data-channel header used to carry the file name in clear text (#32). A
// peer that sends `hi` gets the name sealed with the transfer key instead.
export async function sealName(name, aesKey) {
  const packed = await encryptWithIvPrefix(new TextEncoder().encode(name), aesKey);
  return bytesToBase64(packed);
}

export async function openName(token, aesKey) {
  try {
    const packed = base64ToBytes(token);
    return new TextDecoder().decode(await decryptWithIvPrefix(packed, aesKey));
  } catch {
    return null;
  }
}

// Gathering starts inside setLocalDescription, before the offer or answer is
// written to the socket. Candidates that leave first are replayed ahead of
// that description, and the other peer drops them.
export function createOutboundOrder() {
  const pending = [];
  let descriptionSent = false;
  return {
    stage(message) {
      const description = message?.type === "offer" || message?.type === "answer";
      if (!description && !descriptionSent) {
        if (message?.type === "candidate") pending.push(message);
        return [];
      }
      if (!description) return [message];
      descriptionSent = true;
      const ready = [message, ...pending];
      pending.length = 0;
      return ready;
    },
  };
}

// Remote candidates are applied only after setRemoteDescription finishes.
export function createRemoteCandidateQueue() {
  const pending = [];
  let ready = false;
  return {
    add(candidate) {
      if (!ready) {
        pending.push(candidate);
        return [];
      }
      return [candidate];
    },
    markReady() {
      ready = true;
      return pending.splice(0);
    },
  };
}

function candidateMessage(event) {
  return {
    type: "candidate",
    candidate: {
      candidate: event.candidate.candidate,
      sdpMid: event.candidate.sdpMid ?? undefined,
      sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined,
    },
  };
}

function sendStaged(ws, outbound, message) {
  for (const ready of outbound.stage(message)) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ready));
  }
}

async function addQueued(pc, inbound, candidate) {
  for (const ready of inbound.add(candidate)) {
    try {
      await pc?.addIceCandidate(ready);
    } catch {}
  }
}

async function flushQueued(pc, inbound) {
  for (const ready of inbound.markReady()) {
    try {
      await pc?.addIceCandidate(ready);
    } catch {}
  }
}

export function isP2pSupported() {
  return (
    typeof window !== "undefined" &&
    typeof window.RTCPeerConnection === "function" &&
    typeof WebSocket === "function"
  );
}

export function receiveViaP2p({ apiBase, transferId, aesKey, accessToken, onStatus, onFileSaved }) {
  let ws;
  let pc;
  let activeFile = null;
  let closed = false;
  let coordinator;
  let incoming = Promise.resolve();

  const cleanup = () => {
    if (closed) return;
    closed = true;
    coordinator?.dispose();
    try {
      pc?.close();
    } catch {}
    try {
      ws?.close();
    } catch {}
  };

  const fail = (reason) => {
    if (closed) return;
    onStatus?.(`p2p-failed:${reason}`);
    cleanup();
  };

  const handleBinaryChunk = async (data) => {
    if (closed || !activeFile) return;
    try {
      activeFile.collector.add(new Uint8Array(data));
    } catch (err) {
      // The peer sent more than it declared: stop the transfer instead of
      // taking whatever it keeps sending.
      fail(err?.message ?? "size");
      return;
    }
    onStatus?.("p2p-progress", {
      received: activeFile.collector.receivedBytes,
      expected: activeFile.size,
    });
  };

  const finishActiveFile = async () => {
    if (!activeFile) return;
    const file = activeFile;
    const packed = await file.collector.close();
    if (closed) return;
    const plaintext = await decryptWithIvPrefix(packed, aesKey);
    if (closed) return;
    await onFileSaved?.(plaintext, file.name);
    if (closed) return;
    activeFile = null;
  };

  const handleTextFrame = async (raw) => {
    if (closed) return;
    const frame = parseText(raw);
    if (!frame) return;
    if (frame.kind === "header" && !activeFile) {
      const name = frame.token ? await openName(frame.token, aesKey) : frame.name;
      if (closed) return;
      if (!name) {
        fail("header");
        return;
      }
      activeFile = {
        name,
        token: frame.token ?? null,
        size: frame.size,
        collector: new ChunkCollector({ expectedBytes: frame.size }),
      };
      onStatus?.("p2p-header", { name, size: frame.size });
    } else if (frame.kind === "eof" && activeFile) {
      const matches = activeFile.token
        ? frame.token === activeFile.token
        : frame.name === activeFile.name;
      if (matches) await finishActiveFile();
    }
  };

  const outbound = createOutboundOrder();
  const inbound = createRemoteCandidateQueue();
  coordinator = new P2pCoordinator({
    timeoutMs: 30000,
    onP2PFailed: () => fail("timeout"),
    actions: {
      async handleRemoteDescription(message) {
        if (closed || message.type !== "offer") return null;
        pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

        pc.ondatachannel = (event) => {
          const channel = event.channel;
          if (channel.label !== "fileTransfer") return;
          channel.binaryType = "arraybuffer";
          channel.onopen = () => {
            if (closed) return;
            // Tells the sender this side can read a sealed name (#32).
            try {
              channel.send(encodeHello());
            } catch {}
            coordinator.notifyConnected();
            onStatus?.("p2p-connected");
          };
          channel.onmessage = (evt) => {
            // Ordered RTC messages still need an application queue: opening a
            // sealed header and decrypting/saving a file both await WebCrypto.
            incoming = incoming.then(() => typeof evt.data === "string"
              ? handleTextFrame(evt.data) : handleBinaryChunk(evt.data))
              .catch(() => fail("receive"));
          };
        };
        pc.onicecandidate = (event) => {
          if (!event.candidate) return;
          sendStaged(ws, outbound, candidateMessage(event));
        };

        await pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
        await flushQueued(pc, inbound);
        if (closed) return null;
        const answer = await pc.createAnswer();
        if (closed) return null;
        await pc.setLocalDescription(answer);
        return { type: "answer", sdp: answer.sdp };
      },
      async addIceCandidate(candidate) {
        await addQueued(pc, inbound, candidate);
      },
      async sendSignaling(message) {
        sendStaged(ws, outbound, message);
      },
    },
  });

  try {
    ws = new WebSocket(toWebSocketUrl(apiBase, transferId));
  } catch {
    fail("websocket");
    return () => {};
  }

  ws.onmessage = (event) => {
    coordinator.handleMessage(parseMessage(event.data));
  };
  ws.onerror = () => {
    if (!coordinator.hasFailed) fail("websocket");
  };
  ws.onopen = () => {
    sendAuthFrame(ws, accessToken);
    coordinator.start({ role: "receiver" });
  };

  return cleanup;
}

export function sendViaP2p({ apiBase, sessionId, files, accessToken, aesKey, onStatus }) {
  return new Promise((resolve) => {
    let ws;
    let pc;
    let channel;
    let settled = false;
    let sending = false;
    let channelOpen = false;
    let framesSent = false;
    let helloResolve;
    const helloSeen = new Promise((resolve) => {
      helloResolve = resolve;
    });
    const outbound = createOutboundOrder();
    const inbound = createRemoteCandidateQueue();

    const finish = (delivered) => {
      if (settled) return;
      settled = true;
      try {
        channel?.close();
      } catch {}
      try {
        pc?.close();
      } catch {}
      try {
        ws?.close();
      } catch {}
      resolve(delivered);
    };

    const fail = (reason) => {
      // Once the file frames are on the wire the receiver has the file, so a
      // late failure must not turn a delivered transfer into a cloud
      // fallback. The signaling socket and the closing "done" frame are only
      // needed for the handshake.
      if (framesSent) {
        onStatus?.("p2p-delivered");
        finish(true);
        return;
      }
      onStatus?.(`p2p-failed:${reason}`);
      finish(false);
    };

    const sendFrames = async () => {
      if (sending) return;
      sending = true;
      try {
        // A peer that never says hello only understands the clear-text header;
        // it gets two seconds, then the transfer goes ahead the old way.
        const peerOpensNames = await Promise.race([
          helloSeen,
          new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
        ]);
        const seal = peerOpensNames && aesKey ? (name) => sealName(name, aesKey) : () => null;

        const sender = new ChunkSender({
          bufferedAmount: () => channel.bufferedAmount,
          send: async (chunk) => {
            channel.send(chunk);
            await new Promise((r) => setTimeout(r, 0));
          },
        });

        for (const file of files) {
          const token = await seal(file.name);
          onStatus?.("p2p-sending", { name: file.name });
          channel.send(encodeHeader({ name: file.name, size: file.blob.length, token }));
          await sender.sendAll(file.blob);
          channel.send(encodeEof({ name: file.name, token }));
        }
        // The files are on the wire, so the receiver has them.
        framesSent = true;
        // The "done" frame only tells the receiver that nothing more is
        // coming. If it cannot be sent the transfer is still delivered, so it
        // must not fail the whole thing.
        try {
          channel.send(encodeDone());
        } catch {}
        onStatus?.("p2p-delivered");
        finish(true);
      } catch {
        fail("channel");
      }
    };

  const coordinator = new P2pCoordinator({
      timeoutMs: 30000,
      onP2PFailed: () => fail("timeout"),
      actions: {
        async createOffer() {
          pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
          channel = pc.createDataChannel("fileTransfer");
          channel.binaryType = "arraybuffer";
          channel.onopen = () => {
            channelOpen = true;
            coordinator.notifyConnected();
            onStatus?.("p2p-connected");
            sendFrames();
          };
          channel.onerror = () => {
            if (!settled) fail("channel");
          };
          channel.onclose = () => {
            if (!settled && !sending) fail("closed");
          };
          channel.onmessage = (event) => {
            if (typeof event.data !== "string") return;
            const frame = parseText(event.data);
            if (frame && frame.kind === "hello") helloResolve(true);
          };
          pc.onicecandidate = (event) => {
            if (!event.candidate) return;
            sendStaged(ws, outbound, candidateMessage(event));
          };

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          return encodeOffer(offer.sdp);
        },
        async handleRemoteDescription(message) {
          if (message.type !== "answer" || !pc) return null;
          await pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
          await flushQueued(pc, inbound);
          return null;
        },
        async addIceCandidate(candidate) {
          await addQueued(pc, inbound, candidate);
        },
        async sendSignaling(message) {
          sendStaged(ws, outbound, message);
        },
      },
    });

    try {
      ws = new WebSocket(toWebSocketUrl(apiBase, sessionId));
    } catch {
      fail("websocket");
      return;
    }

    ws.onmessage = (event) => {
      coordinator.handleMessage(parseMessage(event.data));
    };
    ws.onerror = () => {
      // The signaling socket is only needed for the handshake. Once the data
      // channel is open, an error on it says nothing about the transfer.
      if (!settled && !channelOpen) fail("websocket");
    };
    ws.onopen = () => {
      sendAuthFrame(ws, accessToken);
      coordinator.start({ role: "sender" });
    };
  });
}
