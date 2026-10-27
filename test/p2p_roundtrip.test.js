import { test } from "node:test";
import assert from "node:assert/strict";
import { receiveViaP2p, sendViaP2p } from "../js/core/p2p_session.js";
import { encryptWithIvPrefix } from "../js/core/crypto.js";
import { KEY, barrier, until } from "../test-support/p2p_native.js";

// Only the native transport is replaced. Both protocol endpoints, name sealing,
// byte collection, decryption and receipt decisions run their production code.
for (const dropReceipt of [false, true]) {
  test(`paired sessions deliver exact files${dropReceipt ? " without false success when the receipt is lost" : " before sender success"}`, async (t) => {
    const sockets = [];
    const channels = [];
    const replace = (name, value) => {
      const previous = Object.getOwnPropertyDescriptor(globalThis, name);
      Object.defineProperty(globalThis, name, { configurable: true, value });
      t.after(() => {
        if (previous) Object.defineProperty(globalThis, name, previous);
        else delete globalThis[name];
      });
    };
    replace("WebSocket", class {
      static OPEN = 1;
      readyState = 1;
      constructor() { sockets.push(this); queueMicrotask(() => this.onopen?.()); }
      send(data) {
        if (JSON.parse(data).type === "auth") return;
        for (const socket of sockets) if (socket !== this) {
          queueMicrotask(() => socket.onmessage?.({ data }));
        }
      }
      close() { this.readyState = 3; }
    });
    function channel() {
      return {
        label: "fileTransfer", readyState: "open", bufferedAmount: 0,
        send(data) {
          if (this.readyState !== "open") throw new Error("closed native channel");
          this.bufferedAmount++;
          queueMicrotask(() => {
            this.bufferedAmount--;
            if (dropReceipt && typeof data === "string" && JSON.parse(data).t === "ack") return;
            this.other.onmessage?.({ data });
          });
        },
        close() {
          if (this.readyState === "closed") return;
          this.readyState = this.other.readyState = "closed";
          this.onclose?.(); this.other.onclose?.();
        },
      };
    }
    replace("RTCPeerConnection", class {
      createDataChannel() {
        const sender = channel(), receiver = channel();
        sender.other = receiver; receiver.other = sender;
        channels.push(sender, receiver);
        return sender;
      }
      async createOffer() { return { type: "offer", sdp: "test-offer" }; }
      async createAnswer() { return { type: "answer", sdp: "test-answer" }; }
      async setLocalDescription() {}
      async setRemoteDescription(description) {
        if (description.type === "offer") {
          this.ondatachannel({ channel: channels[1] });
          queueMicrotask(() => { channels[1].onopen(); channels[0].onopen(); });
        }
      }
      close() {}
    });
    const gate = barrier();
    const saved = [];
    let receiverComplete = false, senderComplete = false;
    const stop = receiveViaP2p({
      apiBase: "https://example.invalid", transferId: "test-room", aesKey: KEY, expectedFiles: 2,
      onFileSaved: async (bytes, name) => {
        if (name === "second.txt") await gate.promise;
        saved.push([name, Array.from(bytes)]);
      },
      onComplete: () => { receiverComplete = true; },
    });
    t.after(stop);
    const files = await Promise.all(["first.txt", "second.txt"].map(async (name, index) => ({
      name, blob: await encryptWithIvPrefix(new Uint8Array([index, 7, 9]), KEY),
    })));
    const sending = sendViaP2p({
      apiBase: "https://example.invalid", sessionId: "test-room", aesKey: KEY, files,
      confirmationTimeoutMs: 500,
    }).then((result) => { senderComplete = true; return result; });
    t.after(async () => { gate.release(); channels[0]?.close(); await sending; });
    await until(() => saved.length === 1);
    assert.equal(senderComplete, false);
    assert.equal(channels[0].readyState, "open");
    gate.release();
    assert.equal(await sending, !dropReceipt);
    await until(() => receiverComplete);
    assert.deepEqual(saved, [["first.txt", [0, 7, 9]], ["second.txt", [1, 7, 9]]]);
  });
}
