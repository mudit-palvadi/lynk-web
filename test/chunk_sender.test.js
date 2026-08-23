import { test } from "node:test";
import assert from "node:assert/strict";
import { ChunkSender, CHUNK_SIZE } from "../js/core/chunk_sender.js";

test("sends every chunk with correct slice boundaries", async () => {
  const sent = [];
  const sender = new ChunkSender({
    bufferedAmount: () => 0,
    send: async (bytes) => sent.push(bytes),
  });

  const payload = new Uint8Array(200 * 1024).fill(7);
  await sender.sendAll(payload);

  assert.equal(sent.length, 4);
  const rebuilt = Buffer.concat(sent.map((c) => Buffer.from(c)));
  assert.deepEqual(rebuilt, Buffer.from(payload));
  assert.equal(sent[0].length, CHUNK_SIZE);
  assert.equal(sent[3].length, 8 * 1024);
});

test("waits while backpressure is paused, resumes after drain", async () => {
  let buffer = 2 * 1024 * 1024;
  const sent = [];
  const drainer = setInterval(() => {
    buffer = buffer >= 32 * 1024 ? buffer - 32 * 1024 : 0;
  }, 1);
  try {
    const sender = new ChunkSender({
      bufferedAmount: () => buffer,
      send: async (bytes) => sent.push(bytes),
      pollIntervalMs: 1,
    });

    await sender.sendAll(new Uint8Array(128 * 1024).fill(1));
    assert.equal(sent.length, 2);
    assert.ok(sender.pauses > 0, "must yield under backpressure");
  } finally {
    clearInterval(drainer);
  }
});

test("payload smaller than one chunk is a single send", async () => {
  const sent = [];
  const sender = new ChunkSender({
    bufferedAmount: () => 0,
    send: async (bytes) => sent.push(bytes),
  });

  await sender.sendAll(new Uint8Array(1024).fill(3));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].length, 1024);
});

test("empty payload performs no sends", async () => {
  let calls = 0;
  const sender = new ChunkSender({
    bufferedAmount: () => 0,
    send: async () => {
      calls += 1;
    },
  });

  await sender.sendAll(new Uint8Array(0));
  assert.equal(calls, 0);
});
