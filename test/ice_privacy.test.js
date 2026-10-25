import { test } from "node:test";
import assert from "node:assert/strict";
import { receiveViaP2p, sendViaP2p } from "../js/core/p2p_session.js";

function replaceGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  });
}

for (const role of ["sender", "receiver"]) {
  test(`${role} sends local ICE only to the authenticated signaling socket`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let socket;
    let peer;
    const http = t.mock.fn();
    const beacon = t.mock.fn();
    const status = t.mock.fn();
    replaceGlobal(t, "fetch", http);
    replaceGlobal(t, "navigator", { sendBeacon: beacon });
    const logs = ["log", "info", "debug", "warn", "error"].map((name) => t.mock.method(console, name, () => {}));
    replaceGlobal(t, "WebSocket", class {
      static OPEN = 1;
      readyState = 1;
      sent = [];
      constructor(url) { this.url = url; socket = this; }
      send(raw) { this.sent.push(JSON.parse(raw)); }
      close() { this.readyState = 3; }
    });
    replaceGlobal(t, "RTCPeerConnection", class {
      constructor() { peer = this; }
      createDataChannel() { return { close() {} }; }
      async createOffer() { return { type: "offer", sdp: "test-offer" }; }
      async createAnswer() { return { type: "answer", sdp: "test-answer" }; }
      async setLocalDescription() {}
      async setRemoteDescription() {}
      close() {}
    });

    const options = {
      apiBase: "https://api.lynkshare.app", transferId: "room", sessionId: "room",
      accessToken: "room-token", files: [], onStatus: status,
    };
    let sending;
    let stop;
    if (role === "sender") sending = sendViaP2p(options);
    else stop = receiveViaP2p(options);
    try {
      socket.onopen();
      if (role === "receiver") {
        socket.onmessage({ data: JSON.stringify({ type: "offer", sdp: "test-offer" }) });
      }
      await new Promise(setImmediate);
      assert.equal(socket.url, "wss://api.lynkshare.app/ws/signaling/room");
      assert.deepEqual(socket.sent[0], { type: "auth", token: "room-token" });
      const before = socket.sent.length;
      // Node may emit its MockTimers experimental warning during setup.
      // Only candidate handling is under the no-logging assertion.
      const logCounts = logs.map((log) => log.mock.callCount());
      const local = {
        candidate: "candidate:1 1 udp 2122260223 192.168.1.20 54545 typ host",
        sdpMid: "0", sdpMLineIndex: 0,
        address: "192.168.1.20", extra: "must not be serialized",
      };
      peer.onicecandidate({ candidate: local });
      assert.deepEqual(socket.sent.slice(before), [{
        type: "candidate",
        candidate: { candidate: local.candidate, sdpMid: "0", sdpMLineIndex: 0 },
      }]);
      peer.onicecandidate({ candidate: null });
      socket.readyState = 3;
      peer.onicecandidate({ candidate: local });
      assert.equal(socket.sent.length, before + 1, "no candidate is sent after the socket closes");
      assert.equal(http.mock.callCount(), 0);
      assert.equal(beacon.mock.callCount(), 0);
      assert.equal(status.mock.callCount(), 0, "candidates must not reach UI/telemetry callbacks");
      logs.forEach((log, index) => assert.equal(log.mock.callCount(), logCounts[index]));
    } finally {
      if (role === "sender") {
        socket.onerror();
        assert.equal(await sending, false);
      } else stop();
    }
  });
}
