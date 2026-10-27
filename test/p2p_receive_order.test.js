import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { receiveViaP2p, sealName } from "../js/core/p2p_session.js";
import { encryptWithIvPrefix } from "../js/core/crypto.js";
import { encodeHeader, encodeEof, encodeDone } from "../js/core/framer.js";
import { KEY, flush, until, barrier, nativeBoundary } from "../test-support/p2p_native.js";

test("ordered frames survive a delayed sealed-header decryption", async (t) => {
  const token = await sealName("test.txt", KEY);
  const packed = await encryptWithIvPrefix(new Uint8Array([7, 8, 9]), KEY);
  const gate = barrier();
  const decrypt = webcrypto.subtle.decrypt.bind(webcrypto.subtle);
  t.mock.method(webcrypto.subtle, "decrypt", async (...args) => {
    await gate.promise;
    return decrypt(...args);
  });
  const native = nativeBoundary(t);
  const saved = [];
  const stop = receiveViaP2p({
    apiBase: "https://example.invalid", transferId: "test-room", aesKey: KEY,
    onFileSaved: (bytes, name) => saved.push({ bytes: Array.from(bytes), name }),
  });
  t.after(stop);
  const channel = await native.openReceiver();
  channel.onmessage({ data: encodeHeader({ token, size: packed.length }) });
  await flush();
  channel.onmessage({ data: packed.buffer });
  channel.onmessage({ data: encodeEof({ token }) });
  channel.onmessage({ data: encodeDone() });
  assert.equal(saved.length, 0);
  gate.release();
  await until(() => saved.length);
  assert.deepEqual(saved, [{ bytes: [7, 8, 9], name: "test.txt" }]);
});

test("the next file waits for the preceding asynchronous delivery callback", async (t) => {
  const packed = await encryptWithIvPrefix(new Uint8Array([1, 2, 3]), KEY);
  const gate = barrier();
  const native = nativeBoundary(t);
  const saved = [];
  const stop = receiveViaP2p({
    apiBase: "https://example.invalid", transferId: "test-room", aesKey: KEY,
    onFileSaved: async (_bytes, name) => {
      if (name === "first.txt") await gate.promise;
      saved.push(name);
    },
  });
  t.after(stop);
  const channel = await native.openReceiver();
  for (const name of ["first.txt", "second.txt"]) {
    channel.onmessage({ data: encodeHeader({ name, size: packed.length }) });
    channel.onmessage({ data: packed.buffer });
    channel.onmessage({ data: encodeEof({ name }) });
  }
  channel.onmessage({ data: encodeDone() });
  await flush();
  assert.deepEqual(saved, []);
  gate.release();
  await until(() => saved.length === 2);
  assert.deepEqual(saved, ["first.txt", "second.txt"]);
});
