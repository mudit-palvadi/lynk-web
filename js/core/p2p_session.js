import { parseMessage, encodeOffer } from "./signaling.js";
import { parseText, encodeHeader, encodeEof, encodeDone } from "./framer.js";
import { ChunkCollector } from "./chunk_collector.js";
import { ChunkSender } from "./chunk_sender.js";
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

export function sendViaP2p({ apiBase, sessionId, files, onStatus }) {
  return new Promise((resolve) => {
    let ws;
    let pc;
    let channel;
    let settled = false;
    let sending = false;

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
      onStatus?.(`p2p-failed:${reason}`);
      finish(false);
    };

    const sendFrames = async () => {
      if (sending) return;
      sending = true;
      try {
        const sender = new ChunkSender({
          bufferedAmount: () => channel.bufferedAmount,
          send: async (chunk) => {
            channel.send(chunk);
            await new Promise((r) => setTimeout(r, 0));
          },
        });

        for (const file of files) {
          onStatus?.("p2p-sending", { name: file.name });
          channel.send(encodeHeader({ name: file.name, size: file.blob.length }));
          await sender.sendAll(file.blob);
          channel.send(encodeEof({ name: file.name }));
        }
        channel.send(encodeDone());
        onStatus?.("p2p-delivered");
        finish(true);
      } catch {
        fail("channel");
      }
    };

  const coordinator = new P2pCoordinator({
      timeoutMs: 8000,
      onP2PFailed: () => fail("timeout"),
      actions: {
        async createOffer() {
          pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
          channel = pc.createDataChannel("fileTransfer");
          channel.binaryType = "arraybuffer";
          channel.onopen = () => {
            coordinator.notifyConnected();
            sendFrames();
          };
          channel.onerror = () => {
            if (!settled) fail("channel");
          };
          channel.onclose = () => {
            if (!settled && !sending) fail("closed");
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

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          return encodeOffer(offer.sdp);
        },
        async handleRemoteDescription(message) {
          if (message.type !== "answer" || !pc) return null;
          await pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
          return null;
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
      ws = new WebSocket(toWebSocketUrl(apiBase, sessionId));
    } catch {
      fail("websocket");
      return;
    }

    ws.onmessage = (event) => {
      coordinator.handleMessage(parseMessage(event.data));
    };
    ws.onerror = () => {
      if (!settled) fail("websocket");
    };
    ws.onopen = () => {
      coordinator.start({ role: "sender" });
    };
  });
}
