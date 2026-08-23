import { parseMessage } from "./signaling.js";
import { parseText } from "./framer.js";
import { ChunkCollector } from "./chunk_collector.js";
import { decryptWithIvPrefix } from "./crypto.js";
import { P2pCoordinator } from "./p2p_coordinator.js";

const ICE_SERVERS = [
  { urls: ["stun:stun.l.google.com:19302"] },
  { urls: ["stun:stun1.l.google.com:19302"] },
  { urls: ["stun:stun2.l.google.com:19302"] },
];

export function toWebSocketUrl(apiBase, transferId) {
  return `${apiBase.replace(/^http/, "ws")}/ws/signaling/${encodeURIComponent(transferId)}`;
}

export function isP2pSupported() {
  return (
    typeof window !== "undefined" &&
    typeof window.RTCPeerConnection === "function" &&
    typeof WebSocket === "function"
  );
}

export function receiveViaP2p({ apiBase, transferId, aesKey, onStatus, onFileSaved }) {
  let ws;
  let pc;
  let activeFile = null;

  const cleanup = () => {
    try {
      pc?.close();
    } catch {}
    try {
      ws?.close();
    } catch {}
  };

  const fail = (reason) => {
    onStatus?.(`p2p-failed:${reason}`);
    cleanup();
  };

  const handleBinaryChunk = async (data) => {
    if (!activeFile) return;
    activeFile.collector.add(new Uint8Array(data));
    onStatus?.("p2p-progress", {
      received: activeFile.collector.receivedBytes,
      expected: activeFile.size,
    });
  };

  const finishActiveFile = async () => {
    if (!activeFile) return;
    const packed = await activeFile.collector.close();
    const plaintext = await decryptWithIvPrefix(packed, aesKey);
    onFileSaved?.(plaintext, activeFile.name);
    activeFile = null;
  };

  const handleTextFrame = async (raw) => {
    const frame = parseText(raw);
    if (!frame) return;
    if (frame.kind === "header" && !activeFile) {
      activeFile = { name: frame.name, size: frame.size, collector: new ChunkCollector() };
      onStatus?.("p2p-header", { name: frame.name, size: frame.size });
    } else if (frame.kind === "eof" && activeFile && frame.name === activeFile.name) {
      await finishActiveFile();
    }
  };

  const coordinator = new P2pCoordinator({
    timeoutMs: 8000,
    onP2PFailed: () => fail("timeout"),
    actions: {
      async handleRemoteDescription(message) {
        if (message.type !== "offer") return null;
        pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

        pc.ondatachannel = (event) => {
          const channel = event.channel;
          if (channel.label !== "fileTransfer") return;
          channel.binaryType = "arraybuffer";
          channel.onopen = () => coordinator.notifyConnected();
          channel.onmessage = (evt) => {
            if (typeof evt.data === "string") {
              handleTextFrame(evt.data);
            } else {
              handleBinaryChunk(evt.data);
            }
          };
        };
        pc.onicecandidate = (event) => {
          if (!event.candidate || !ws || ws.readyState !== WebSocket.OPEN) return;
          ws.send(
            JSON.stringify({
              type: "candidate",
              candidate: {
                candidate: event.candidate.candidate,
                sdpMid: event.candidate.sdpMid ?? undefined,
                sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined,
              },
            }),
          );
        };

        await pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        return { type: "answer", sdp: answer.sdp };
      },
      async addIceCandidate(candidate) {
        try {
          await pc?.addIceCandidate(candidate);
        } catch {}
      },
      async sendSignaling(message) {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
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
    coordinator.start({ role: "receiver" });
  };

  return cleanup;
}
