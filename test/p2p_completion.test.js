import { test } from "node:test";
import assert from "node:assert/strict";
import { sendViaP2p, openName } from "../js/core/p2p_session.js";
import { encodeDone, encodeReceipt, sha256Hex } from "../js/core/framer.js";
import { KEY, flush, until, nativeBoundary } from "../test-support/p2p_native.js";

test("a matching receipt is the only successful sender outcome", async (t) => {
  const native = nativeBoundary(t);
  let settled = false;
  const sending = sendViaP2p({
    apiBase: "https://example.invalid", sessionId: "test-room", aesKey: KEY,
    files: [{ name: "test.txt", blob: new Uint8Array([1, 2, 3]) }],
  }).then((result) => { settled = true; return result; });
  const channel = await native.openSender();
  t.after(async () => { channel.onerror(); await sending; });
  channel.onmessage({ data: encodeReceipt(1, 3) }); // Too early.
  await until(() => channel.sent.includes(encodeDone()));
  const header = channel.sent.filter((data) => typeof data === "string")
    .map((data) => JSON.parse(data)).find((frame) => frame.t === "hdr");
  assert.equal(header.name, undefined);
  assert.equal(await openName(header.n, KEY), "test.txt");
  channel.onmessage({ data: encodeReceipt(2, 3) });
  channel.onmessage({ data: encodeReceipt(1, 4) });
  await flush();
  assert.equal(settled, false);
  channel.onmessage({ data: encodeReceipt(1, 3) });
  await flush();
  assert.equal(settled, false);
  channel.onmessage({ data: encodeReceipt(1, 3, await sha256Hex([new Uint8Array([1, 2, 3])])) });
  assert.equal(await sending, true);
  assert.equal(channel.closed, true);
});

test("no header is sent before the receiver advertises receipt support", async (t) => {
  const native = nativeBoundary(t);
  const sending = sendViaP2p({
    apiBase: "https://example.invalid", sessionId: "test-room", aesKey: KEY,
    files: [{ name: "test.txt", blob: new Uint8Array([1, 2, 3]) }],
  });
  const channel = await native.openSender(null);
  t.after(async () => { channel.onerror(); await sending; });
  await flush();
  assert.equal(channel.sent.length, 0);
  channel.onmessage({ data: JSON.stringify({ t: "hi", v: 2, receipts: true }) });
  await until(() => channel.sent.includes(encodeDone()));
  channel.onmessage({ data: encodeReceipt(1, 3, await sha256Hex([new Uint8Array([1, 2, 3])])) });
  assert.equal(await sending, true);
});

for (const mode of ["timeout", "close", "error", "legacy", "no-hello"]) {
  test(`sender falls back rather than claiming delivery on ${mode}`, async (t) => {
    const native = nativeBoundary(t);
    const sending = sendViaP2p({
      apiBase: "https://example.invalid", sessionId: "test-room",
      files: [{ name: "test.txt", blob: new Uint8Array([1, 2, 3]) }],
      helloTimeoutMs: 15, confirmationTimeoutMs: 25,
    });
    const channel = await native.openSender(mode === "legacy" ? { t: "hi", v: 2 } : mode === "no-hello" ? null : undefined);
    if (mode === "close" || mode === "error") {
      await until(() => channel.sent.includes(encodeDone()));
      if (mode === "close") channel.onclose(); else channel.onerror();
    }
    assert.equal(await sending, false);
    assert.equal(channel.closed, true);
    if (mode === "legacy" || mode === "no-hello") assert.equal(channel.sent.length, 0);
  });
}

test("queuing all frames without a receiver receipt is not delivery", async (t) => {
  const native = nativeBoundary(t);
  let settled = false;
  const events = [];
  const sending = sendViaP2p({
    apiBase: "https://example.invalid", sessionId: "test-room",
    files: [{ name: "test.txt", blob: new Uint8Array([1, 2, 3]) }],
    onStatus: (event) => events.push(event),
  }).then((result) => { settled = true; return result; });
  const channel = await native.openSender();
  t.after(async () => { channel.onerror(); await sending; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(channel.bufferedAmount > 0);
  assert.equal(settled, false, "the remote side has not acknowledged any file");
  assert.equal(channel.closed, false);
  assert.ok(!events.includes("p2p-delivered"));
});
