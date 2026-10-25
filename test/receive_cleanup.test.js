import { test } from "node:test";
import assert from "node:assert/strict";
import { receiveViaP2p } from "../js/core/p2p_session.js";

function replaceGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  });
}

for (const duringOffer of [false, true]) {
  test(`receiver cleanup cancels negotiation and ignores late native events (offer pending: ${duringOffer})`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let socket;
    let peer;
    let releaseOffer;
    const offer = new Promise((resolve) => { releaseOffer = resolve; });
    let answers = 0;
    let peerCloses = 0;
    let socketCloses = 0;
    const statuses = [];
    replaceGlobal(t, "WebSocket", class {
      static OPEN = 1;
      readyState = 1;
      constructor() { socket = this; }
      send() {}
      close() { socketCloses++; this.readyState = 3; }
    });
    replaceGlobal(t, "RTCPeerConnection", class {
      constructor() { peer = this; }
      async setRemoteDescription() { if (duringOffer) await offer; }
      async createAnswer() { answers++; return { type: "answer", sdp: "answer" }; }
      async setLocalDescription() {}
      close() { peerCloses++; }
    });
    const stop = receiveViaP2p({
      apiBase: "https://api.test.local", transferId: "room", accessToken: "token",
      onStatus: (event) => statuses.push(event),
      onFileSaved: () => assert.fail("a closed receiver must not save files"),
    });
    socket.onopen();
    socket.onmessage({ data: JSON.stringify({ type: "offer", sdp: "offer" }) });
    await new Promise(setImmediate);
    const channel = { label: "fileTransfer", send() {} };
    peer.ondatachannel({ channel });
    if (!duringOffer) {
      channel.onopen();
      assert.deepEqual(statuses, ["p2p-connected"]);
    }
    stop();
    stop(); // Cleanup must be safe when more than one path unwinds.
    releaseOffer();
    await new Promise(setImmediate);
    const before = [...statuses];
    channel.onopen();
    channel.onmessage({ data: JSON.stringify({ type: "header", name: "late.txt", size: 1 }) });
    socket.onerror();
    t.mock.timers.tick(60000);
    await new Promise(setImmediate);
    assert.deepEqual(statuses, before);
    assert.equal(answers, duringOffer ? 0 : 1);
    assert.equal(peerCloses, 1);
    assert.equal(socketCloses, 1);
  });
}
