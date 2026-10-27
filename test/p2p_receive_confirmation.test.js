import { test } from "node:test";
import assert from "node:assert/strict";
import { receiveViaP2p } from "../js/core/p2p_session.js";
import { encryptWithIvPrefix } from "../js/core/crypto.js";
import { encodeHeader, encodeEof, encodeDone, encodeReceipt, sha256Hex } from "../js/core/framer.js";
import { KEY, flush, until, barrier, nativeBoundary } from "../test-support/p2p_native.js";

test("receiver acknowledges only after done and asynchronous delivery of every file", async (t) => {
  const native = nativeBoundary(t);
  const packed = await encryptWithIvPrefix(new Uint8Array([7, 8, 9]), KEY);
  const gate = barrier();
  const completed = barrier();
  const saved = [];
  const stop = receiveViaP2p({
    apiBase: "https://example.invalid", transferId: "test-room", aesKey: KEY, expectedFiles: 2,
    onFileSaved: async (bytes, name) => {
      if (name === "two.txt") await gate.promise;
      saved.push([name, Array.from(bytes)]);
    },
    onComplete: completed.release,
  });
  t.after(stop);
  const channel = await native.openReceiver();
  for (const name of ["one.txt", "two.txt"]) {
    channel.onmessage({ data: encodeHeader({ name, size: packed.length }) });
    channel.onmessage({ data: packed.buffer });
    channel.onmessage({ data: encodeEof({ name }) });
  }
  channel.onmessage({ data: encodeDone() });
  await until(() => saved.length === 1);
  assert.equal(channel.sent.some((s) => JSON.parse(s).t === "ack"), false);
  gate.release();
  await completed.promise;
  assert.deepEqual(saved, [["one.txt", [7, 8, 9]], ["two.txt", [7, 8, 9]]]);
  assert.equal(
    channel.sent.at(-1),
    encodeReceipt(2, packed.length * 2, await sha256Hex([packed, packed])),
  );
});

test("decryption failure never produces a receipt", async (t) => {
  const native = nativeBoundary(t);
  const failed = barrier();
  let saved = 0;
  const stop = receiveViaP2p({
    apiBase: "https://example.invalid", transferId: "test-room", aesKey: KEY, expectedFiles: 1,
    onFileSaved: () => saved++,
    onStatus: (event) => { if (event.startsWith("p2p-failed")) failed.release(); },
  });
  t.after(stop);
  const channel = await native.openReceiver();
  channel.onmessage({ data: encodeHeader({ name: "bad.txt", size: 1 }) });
  channel.onmessage({ data: new Uint8Array([1]).buffer });
  channel.onmessage({ data: encodeEof({ name: "bad.txt" }) });
  channel.onmessage({ data: encodeDone() });
  await failed.promise;
  assert.equal(saved, 0);
  assert.equal(channel.sent.some((s) => JSON.parse(s).t === "ack"), false);
});

for (const mode of ["drain", "incomplete", "cancelled-save"]) {
  test(`receiver confirmation respects ${mode}`, async (t) => {
    const native = nativeBoundary(t);
    const packed = await encryptWithIvPrefix(new Uint8Array([4, 5, 6]), KEY);
    let completed = false;
    const failed = barrier();
    const stop = receiveViaP2p({
      apiBase: "https://example.invalid", transferId: "test-room", aesKey: KEY,
      expectedFiles: mode === "incomplete" ? 2 : 1,
      onFileSaved: () => mode !== "cancelled-save",
      onComplete: () => { completed = true; },
      onStatus: (event) => { if (event.startsWith("p2p-failed")) failed.release(); },
    });
    t.after(stop);
    const channel = await native.openReceiver();
    channel.bufferedAmount = mode === "drain" ? 100 : 0;
    channel.onmessage({ data: encodeHeader({ name: "file.txt", size: packed.length }) });
    channel.onmessage({ data: packed.buffer });
    channel.onmessage({ data: encodeEof({ name: "file.txt" }) });
    channel.onmessage({ data: encodeDone() });
    if (mode === "drain") {
      await until(() => channel.sent.some((text) => JSON.parse(text).t === "ack"));
      assert.equal(completed, false);
      channel.bufferedAmount = 0;
      await until(() => completed);
    } else {
      if (mode === "incomplete") await failed.promise;
      else { await flush(); await flush(); }
      assert.equal(channel.sent.some((text) => JSON.parse(text).t === "ack"), false);
      assert.equal(completed, false);
    }
  });
}
