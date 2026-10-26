import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { acquireReceiverOwnership } from "../js/core/receiver_ownership.js";

const page = readFileSync(new URL("../js/pages/receive.js", import.meta.url), "utf8");
const receiveCode = page.slice(page.indexOf("async function startDownload()"), page.indexOf("async function downloadViaCloud()"));
const flush = () => new Promise((resolve) => setImmediate(resolve));

function receiver(status = "uploading", acquireOwnership = async () => ({ status: "acquired", release: async () => {} })) {
  const timers = new Map();
  const events = new Map();
  const calls = { direct: 0, cloud: 0, cleanup: 0, saves: 0, metadata: [], statuses: [] };
  let timerId = 0;
  let callbacks;
  let currentStatus = status;
  let metadataBarrier;
  let metadataError = false;
  let elapsed = 0;
  const context = {
    performance: { now: () => elapsed },
    state: { transferId: "transfer-1", accessToken: "test-token", aesKey: "test-key", mode: "p2p", metadata: { status } },
    els: { downloadButton: { classList: { remove() {} } }, fileName: {}, fileMeta: {} },
    window: { addEventListener: (event, callback) => events.set(event, callback) },
    showTransferCard() {},
    isP2pSupported: () => true,
    acquireReceiverOwnership: acquireOwnership,
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
    setStatus: (message) => calls.statuses.push(message), setProgress() {}, formatBytes: String,
    saveBlob: () => { calls.saves++; }, recordReceive() {},
    downloadViaCloud: async () => { calls.cloud++; },
  };
  const lifecycleCode = page.match(/^window\.addEventListener\("pagehide".*$/m)?.[0] ?? "";
  const loadCode = page.slice(page.indexOf("async function loadTransfer()"), page.indexOf("async function streamWithProgress("));
  runInNewContext(`${receiveCode}\n${loadCode}\n${lifecycleCode}\nglobalThis.begin = startDownload; globalThis.load = loadTransfer;`, context);
  return {
    calls, context, begin: context.begin,
    load: context.load,
    leave: () => events.get("pagehide")?.({ persisted: true }),
    hide: () => events.get("visibilitychange")?.(),
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
      await flush();
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
  await flush();
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

function ownershipPool() {
  const active = new Set();
  const locks = {
    async request(name, options, callback) {
      assert.deepEqual(options, { mode: "exclusive", ifAvailable: true });
      if (active.has(name)) return callback(null);
      active.add(name);
      try { return await callback({ name }); }
      finally { active.delete(name); }
    },
  };
  return (options) => acquireReceiverOwnership({ ...options, locks });
}

test("two receiver tabs cannot join the same direct transfer, and the loser can retry", async () => {
  const acquire = ownershipPool();
  const first = receiver("uploading", acquire);
  const second = receiver("uploading", acquire);
  const one = first.begin();
  const two = second.begin();
  await flush();
  const directCount = first.calls.direct + second.calls.direct;
  // Complete both in the old implementation so the regression never hangs.
  first.callbacks?.onFileSaved(new Uint8Array([1]), "one.txt");
  second.callbacks?.onStatus("p2p-failed:timeout");
  await Promise.all([one, two]);
  assert.equal(directCount, 1, "only the ownership winner may open signaling");
  assert.equal(second.calls.cloud, 0, "contention is not permission to start a duplicate cloud download");
  assert.ok(second.calls.statuses.some((message) => /another tab/i.test(message)));
  assert.equal(second.context.els.downloadButton.disabled, false);
  const retry = second.begin();
  await flush();
  second.callbacks.onFileSaved(new Uint8Array([2]), "retry.txt");
  await retry;
  assert.equal(second.calls.direct, 1, "retry acquires ownership after the first tab finishes");
});

test("different transfer ids can receive directly in separate tabs", async () => {
  const acquire = ownershipPool();
  const first = receiver("uploading", acquire);
  const second = receiver("uploading", acquire);
  second.context.state.transferId = "transfer-2";
  const pending = [first.begin(), second.begin()];
  await flush();
  first.callbacks.onFileSaved(new Uint8Array([1]), "one.txt");
  second.callbacks.onFileSaved(new Uint8Array([2]), "two.txt");
  await Promise.all(pending);
  assert.equal(first.calls.direct + second.calls.direct, 2);
});

test("unavailable cross-tab ownership uses cloud without opening signaling", async () => {
  const run = receiver("uploading", async () => ({ status: "unavailable" }));
  const pending = run.begin();
  await flush();
  run.callbacks?.onStatus("p2p-failed:timeout");
  await pending;
  assert.equal(run.calls.direct, 0);
  assert.equal(run.calls.cloud, 1);
});

test("cancelling during ownership acquisition cannot open a late direct session", async () => {
  let grant;
  let releases = 0;
  const ownership = new Promise((resolve) => { grant = resolve; });
  const run = receiver("uploading", () => ownership);
  const pending = run.begin();
  await flush();
  run.context.state.cancelDirect();
  grant({ status: "acquired", release: async () => { releases++; } });
  await pending;
  await flush();
  assert.equal(run.calls.direct, 0);
  assert.equal(run.calls.cloud, 0);
  assert.equal(releases, 1);
});

test("receiver cleanup completes before cross-tab ownership is released", async () => {
  let releases = 0;
  const run = receiver("uploading", async () => ({
    status: "acquired",
    release: async () => {
      assert.equal(run.calls.cleanup, 1, "the old socket must close before a new owner can join");
      releases++;
    },
  }));
  const pending = run.begin();
  await flush();
  run.callbacks.onFileSaved(new Uint8Array([1]), "one.txt");
  await pending;
  assert.equal(releases, 1);
});

test("pagehide releases ownership, discards late callbacks and requires a fresh claim on Retry", async () => {
  const acquire = ownershipPool();
  const first = receiver("uploading", acquire);
  const second = receiver("uploading", acquire);
  const pending = first.begin();
  await flush();
  const stale = first.callbacks;
  first.hide();
  assert.equal(first.calls.cleanup, 0, "backgrounding is not navigation");
  first.leave();
  assert.equal(first.calls.cleanup, 1, "pagehide closes native work synchronously before BFCache suspension");
  await pending;
  assert.equal(first.calls.cleanup, 1);
  assert.equal(first.calls.cloud, 0);
  assert.equal(first.context.els.downloadButton.disabled, false);
  stale.onFileSaved(new Uint8Array([1]), "late.txt");
  assert.equal(first.calls.saves, 0);
  const two = second.begin();
  await flush();
  const restored = first.begin();
  await restored;
  assert.equal(first.calls.direct, 1, "restored pages cannot resume without a new ownership claim");
  second.callbacks.onFileSaved(new Uint8Array([2]), "two.txt");
  await two;
  const retry = first.begin();
  await flush();
  first.callbacks.onFileSaved(new Uint8Array([3]), "retry.txt");
  await retry;
  assert.equal(first.calls.direct, 2);
});

test("loading a different transfer cancels the old native session and releases its room", async () => {
  const acquire = ownershipPool();
  const first = receiver("uploading", acquire);
  const pending = first.begin();
  await flush();
  const stale = first.callbacks;
  first.context.state.transferId = "replacement";
  await first.load();
  await pending;
  stale.onFileSaved(new Uint8Array([1]), "old.txt");
  assert.equal(first.calls.saves, 0);
  assert.equal(first.calls.cleanup, 1);
  const second = receiver("uploading", acquire);
  const two = second.begin();
  await flush();
  assert.equal(second.calls.direct, 1);
  second.callbacks.onFileSaved(new Uint8Array([2]), "two.txt");
  await two;
});

test("multi-file reception holds ownership until the final decrypted file is saved", async () => {
  const acquire = ownershipPool();
  const first = receiver("uploading", acquire);
  first.context.state.metadata.total_files = 2;
  const pending = first.begin();
  await flush();
  first.callbacks.onFileSaved(new Uint8Array([1]), "one.txt");
  const second = receiver("uploading", acquire);
  await second.begin();
  assert.equal(second.calls.direct, 0);
  assert.equal(second.calls.cloud, 0);
  first.callbacks.onFileSaved(new Uint8Array([2]), "two.txt");
  await pending;
  const retry = second.begin();
  await flush();
  second.callbacks.onFileSaved(new Uint8Array([3]), "retry.txt");
  await retry;
});

test("synchronous native failure still cleans up before releasing ownership", async () => {
  const events = [];
  const run = receiver("uploading", async () => ({ status: "acquired", release: async () => { events.push("release"); } }));
  run.context.receiveViaP2p = ({ onStatus }) => {
    onStatus("p2p-failed:setup");
    return () => events.push("cleanup");
  };
  await run.begin();
  assert.deepEqual(events, ["cleanup", "release"]);
  assert.equal(run.calls.cloud, 1);
});

test("failure waits for ownership release before starting cloud fallback", async () => {
  let finishRelease;
  const released = new Promise((resolve) => { finishRelease = resolve; });
  const run = receiver("uploading", async () => ({ status: "acquired", release: () => released }));
  const pending = run.begin();
  await flush();
  run.callbacks.onStatus("p2p-failed:timeout");
  await flush();
  assert.equal(run.calls.cleanup, 1);
  assert.equal(run.calls.cloud, 0);
  finishRelease();
  await pending;
  assert.equal(run.calls.cloud, 1);
});
