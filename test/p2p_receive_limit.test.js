// A peer must not be able to send more than it said it would.
//
// The file header carries the size of the file. A receiver that trusts
// neither the header nor a limit could be made to fill the browser's
// memory, so both are checked before a chunk is kept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ChunkCollector, MAX_RECEIVE_BYTES } from "../js/core/chunk_collector.js";
import { receiveViaP2p } from "../js/core/p2p_session.js";
import { encodeHeader, encodeEof, encodeDone } from "../js/core/framer.js";
import { barrier, nativeBoundary } from "../test-support/p2p_native.js";

const bytes = (n) => new Uint8Array(n);

test("a file that stays inside what it declared is accepted", () => {
  const collector = new ChunkCollector({ expectedBytes: 1000 });

  collector.add(bytes(400));
  collector.add(bytes(600));

  assert.equal(collector.receivedBytes, 1000);
  assert.equal(collector.chunkCount, 2);
});

test("a peer that sends more than it declared is cut off", () => {
  const collector = new ChunkCollector({ expectedBytes: 1000 });

  collector.add(bytes(1000));
  assert.throws(() => collector.add(bytes(1)), /more data than it declared/);
});

test("a file bigger than the biggest transfer on offer is cut off", () => {
  const collector = new ChunkCollector({ expectedBytes: MAX_RECEIVE_BYTES + 1 });

  assert.throws(
    () => collector.add(bytes(MAX_RECEIVE_BYTES + 1)),
    /more data than a transfer may hold/,
  );
});

test("the cap leaves room for the per-file encryption overhead", () => {
  // The app offers 50 MB for a direct transfer once the limit is unlocked.
  assert.ok(MAX_RECEIVE_BYTES > 50 * 1024 * 1024);
  assert.ok(MAX_RECEIVE_BYTES < 51 * 1024 * 1024);
});

test("the receiver builds the collector from the size the peer declared", async () => {
  const { readFileSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const source = readFileSync(join(root, "js/core/p2p_session.js"), "utf8");

  assert.ok(
    source.includes("expectedBytes: frame.size"),
    "the receiver does not check the declared size",
  );
  assert.ok(source.includes("frame.size > budgetRemaining"));
  assert.ok(source.includes("collected !== activeFile.size"));
});

test("a header with no positive size is refused", async (t) => {
  const native = nativeBoundary(t);
  const failed = barrier();
  const stop = receiveViaP2p({
    apiBase: "https://example.invalid",
    transferId: "test-room",
    aesKey: "k".repeat(32),
    onStatus: (event) => { if (String(event).startsWith("p2p-failed")) failed.release(); },
  });
  t.after(stop);
  const channel = await native.openReceiver();
  channel.onmessage({ data: encodeHeader({ name: "empty.txt", size: 0 }) });
  await failed.promise;
});

test("an eof that is short of the declared size is refused", async (t) => {
  const native = nativeBoundary(t);
  const failed = barrier();
  let saved = 0;
  const stop = receiveViaP2p({
    apiBase: "https://example.invalid",
    transferId: "test-room",
    aesKey: "k".repeat(32),
    onFileSaved: () => { saved += 1; },
    onStatus: (event) => { if (String(event).startsWith("p2p-failed")) failed.release(); },
  });
  t.after(stop);
  const channel = await native.openReceiver();
  channel.onmessage({ data: encodeHeader({ name: "short.txt", size: 4 }) });
  channel.onmessage({ data: new Uint8Array([1, 2]).buffer });
  channel.onmessage({ data: encodeEof({ name: "short.txt" }) });
  channel.onmessage({ data: encodeDone() });
  await failed.promise;
  assert.equal(saved, 0);
});
