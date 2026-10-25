import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const page = readFileSync(new URL("../js/pages/receive.js", import.meta.url), "utf8");
const receiveCode = page.slice(page.indexOf("async function startDownload()"), page.indexOf("async function downloadViaCloud()"));
const flush = () => new Promise((resolve) => setImmediate(resolve));

function receiver(status = "uploading") {
  const timers = new Map();
  const calls = { direct: 0, cloud: 0, cleanup: 0, saves: 0, metadata: [] };
  let timerId = 0;
  let callbacks;
  let currentStatus = status;
  let metadataBarrier;
  let metadataError = false;
  let elapsed = 0;
  const context = {
    performance: { now: () => elapsed },
    state: { transferId: "transfer-1", accessToken: "test-token", aesKey: "test-key", mode: "p2p", metadata: { status } },
    els: { downloadButton: {}, fileName: {}, fileMeta: {} },
    isP2pSupported: () => true,
    resolveApiBase: () => "https://api.test.local",
    receiveViaP2p: (options) => {
      calls.direct++;
      callbacks = options;
      return () => { calls.cleanup++; };
    },
    LynkApi: class {
      async getTransferMetadata(id, token) {
        calls.metadata.push({ id, token });
        await metadataBarrier;
        if (metadataError) throw new Error("temporary offline failure");
        return { ...context.state.metadata, status: currentStatus };
      }
    },
    setTimeout: (callback) => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: (id) => timers.delete(id),
    setStatus() {}, setProgress() {}, formatBytes: String,
    saveBlob: () => { calls.saves++; }, recordReceive() {},
    downloadViaCloud: async () => { calls.cloud++; },
  };
  runInNewContext(`${receiveCode}\nglobalThis.begin = startDownload;`, context);
  return {
    calls, context, begin: context.begin,
    get callbacks() { return callbacks; },
    ready() { currentStatus = "ready"; },
    failMetadata() { metadataError = true; },
    expireWatch() { elapsed = 30000; },
    holdMetadata() {
      let release;
      metadataBarrier = new Promise((resolve) => { release = resolve; });
      return release;
    },
    async poll() {
      const pending = [...timers.values()];
      timers.clear();
      for (const callback of pending) await callback();
      await flush();
    },
    get pendingTimers() { return timers.size; },
  };
}

test("ready metadata bypasses a stale direct code hint", async () => {
  const run = receiver("ready");
  const reception = run.begin();
  await flush();
  // Drain the old implementation's direct attempt without waiting 30 seconds.
  run.callbacks?.onStatus("p2p-failed:timeout");
  await reception;
  assert.equal(run.calls.direct, 0);
  assert.equal(run.calls.cloud, 1);
});

test("cloud readiness during negotiation wins once and discards late direct saves", async () => {
  const run = receiver();
  const reception = run.begin();
  await flush();
  run.ready();
  await run.poll();
  const cloudBeforeTimeout = run.calls.cloud;
  run.callbacks.onStatus("p2p-failed:timeout");
  await reception;
  run.callbacks.onFileSaved(new Uint8Array([1, 2]), "late.txt");
  assert.equal(cloudBeforeTimeout, 1, "do not wait for the direct timeout after R2 is ready");
  assert.equal(run.calls.cloud, 1);
  assert.equal(run.calls.cleanup, 1);
  assert.equal(run.calls.saves, 0, "a losing direct callback must not download a second copy");
  assert.equal(run.pendingTimers, 0);
  assert.ok(run.calls.metadata.length > 0);
  assert.ok(run.calls.metadata.every(({ id, token }) => id === "transfer-1" && token === "test-token"));
});

test("an opened direct channel is not preempted by later cloud readiness", async () => {
  const run = receiver();
  const reception = run.begin();
  await flush();
  run.callbacks.onStatus("p2p-connected");
  run.ready();
  await run.poll();
  run.callbacks.onFileSaved(new Uint8Array([1, 2]), "direct.txt");
  await reception;
  assert.equal(run.calls.cloud, 0);
  assert.equal(run.calls.saves, 1);
  assert.equal(run.calls.cleanup, 1);
  assert.equal(run.pendingTimers, 0);
});

test("channel open wins against an already in-flight readiness response", async () => {
  const run = receiver();
  const release = run.holdMetadata();
  const reception = run.begin();
  run.ready();
  const polling = run.poll();
  await flush();
  run.callbacks.onStatus("p2p-connected");
  release();
  await polling;
  run.callbacks.onFileSaved(new Uint8Array([1]), "direct.txt");
  await reception;
  assert.equal(run.calls.cloud, 0);
  assert.equal(run.calls.saves, 1);
  assert.equal(run.calls.cleanup, 1);
});

test("cancellation ignores a late ready response and late native callbacks", async () => {
  const run = receiver();
  const release = run.holdMetadata();
  const reception = run.begin();
  run.ready();
  const polling = run.poll();
  await flush();
  run.context.state.cancelDirect();
  release();
  await polling;
  await reception;
  run.callbacks.onStatus("p2p-failed:timeout");
  run.callbacks.onFileSaved(new Uint8Array([1]), "late.txt");
  assert.equal(run.calls.cloud, 0);
  assert.equal(run.calls.saves, 0);
  assert.equal(run.calls.cleanup, 1);
  assert.equal(run.pendingTimers, 0);
});

test("metadata failures leave the direct attempt alive and the watch is bounded", async () => {
  const run = receiver();
  const reception = run.begin();
  run.failMetadata();
  await run.poll();
  assert.equal(run.calls.cloud, 0);
  assert.equal(run.calls.cleanup, 0);
  assert.equal(run.pendingTimers, 1);
  run.expireWatch();
  await run.poll();
  assert.equal(run.calls.metadata.length, 1);
  assert.equal(run.pendingTimers, 0);
  run.callbacks.onStatus("p2p-failed:timeout");
  await reception;
  assert.equal(run.calls.cloud, 1);
});

test("a duplicate click does not start a second transport or lose later files", async () => {
  const run = receiver();
  run.context.state.metadata.total_files = 2;
  const reception = run.begin();
  await run.begin();
  assert.equal(run.calls.direct, 1);
  run.callbacks.onFileSaved(new Uint8Array([1]), "one.txt");
  assert.equal(run.calls.cleanup, 0);
  run.callbacks.onFileSaved(new Uint8Array([2]), "two.txt");
  await reception;
  run.callbacks.onFileSaved(new Uint8Array([3]), "late.txt");
  assert.equal(run.calls.saves, 2);
  assert.equal(run.calls.cloud, 0);
  assert.equal(run.calls.cleanup, 1);
});
