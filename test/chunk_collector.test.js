import { test } from "node:test";
import assert from "node:assert/strict";
import { ChunkCollector } from "../js/core/chunk_collector.js";

test("ordered chunks concatenate byte-for-byte", async () => {
  const collector = new ChunkCollector();
  collector.add(new Uint8Array([1, 2, 3]));
  collector.add(new Uint8Array([4, 5]));
  const out = await collector.close();
  assert.deepEqual(Buffer.from(out), Buffer.from([1, 2, 3, 4, 5]));
});

test("byte and chunk counters accumulate", async () => {
  const collector = new ChunkCollector();
  collector.add(new Uint8Array(10));
  collector.add(new Uint8Array(32));
  collector.add(new Uint8Array(6));
  await collector.close();
  assert.equal(collector.receivedBytes, 48);
  assert.equal(collector.chunkCount, 3);
});

test("empty chunks are ignored but still not counted", async () => {
  const collector = new ChunkCollector();
  collector.add(new Uint8Array(0));
  collector.add(new Uint8Array(5));
  await collector.close();
  assert.equal(collector.receivedBytes, 5);
  assert.equal(collector.chunkCount, 1);
});

test("adding after close is rejected", async () => {
  const collector = new ChunkCollector();
  await collector.close();
  assert.throws(() => collector.add(new Uint8Array(4)));
});
