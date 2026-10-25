import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_READY_POLL_INTERVAL_MS,
  DEFAULT_READY_TIMEOUT_MS,
  isNotReadyError,
  TransferStillUploadingError,
  TRANSFER_NOT_READY_STATUS,
  waitForTransferReady,
} from "../js/core/ready_wait.js";

/** A clock the test controls, so a wait can be simulated instantly. */
function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
  };
}

test("the not-ready status is the one the server answers with", () => {
  assert.equal(TRANSFER_NOT_READY_STATUS, 409);
});

test("a not-ready error is told apart from any other error", () => {
  assert.equal(isNotReadyError({ status: 409 }), true);
  assert.equal(isNotReadyError({ status: 404 }), false);
  assert.equal(isNotReadyError(new Error("boom")), false);
  assert.equal(isNotReadyError(null), false);
});

test("waiting returns as soon as the sender is ready", async () => {
  let calls = 0;
  const api = {
    getTransferMetadata: async () => {
      calls += 1;
      return { status: "ready", files: [] };
    },
  };

  const metadata = await waitForTransferReady({
    api,
    transferId: "t1",
    accessToken: "token",
  });

  assert.equal(metadata.status, "ready");
  assert.equal(calls, 1);
});

test("waiting keeps asking while the sender is still uploading", async () => {
  const clock = fakeClock();
  let calls = 0;
  const api = {
    getTransferMetadata: async () => {
      calls += 1;
      return { status: calls < 3 ? "uploading" : "ready" };
    },
  };
  const waits = [];

  const metadata = await waitForTransferReady({
    api,
    transferId: "t1",
    accessToken: "token",
    timeoutMs: 60_000,
    pollIntervalMs: 1_000,
    onWait: (info) => waits.push(info),
    sleep: clock.sleep,
    now: clock.now,
  });

  assert.equal(metadata.status, "ready");
  assert.equal(calls, 3);
  assert.equal(waits.length, 2);
  assert.equal(waits[0].status, "uploading");
  assert.equal(waits[0].remainingMs, 60_000);
  assert.equal(waits[1].remainingMs, 59_000);
});

test("waiting gives up with a clear message when the sender never finishes", async () => {
  const clock = fakeClock();
  const api = {
    getTransferMetadata: async () => ({ status: "uploading" }),
  };

  await assert.rejects(
    () =>
      waitForTransferReady({
        api,
        transferId: "t1",
        accessToken: "token",
        timeoutMs: 5_000,
        pollIntervalMs: 1_000,
        sleep: clock.sleep,
        now: clock.now,
      }),
    (err) =>
      err instanceof TransferStillUploadingError &&
      err.status === 409 &&
      /still uploading/i.test(err.message),
  );
});

for (const jump of [60_000, -60_000]) {
  test(`the default timeout ignores a ${jump} ms system clock adjustment`, async (t) => {
    let elapsed = 0;
    let wallTime = 1_000_000;
    let calls = 0;
    t.mock.method(Date, "now", () => wallTime);
    t.mock.method(performance, "now", () => elapsed);

    await assert.rejects(
      waitForTransferReady({
        api: {
          getTransferMetadata: async () => {
            calls += 1;
            // Bound the fake loop even when a backward jump breaks the deadline.
            if (calls > 4) throw new Error("Timeout exceeded its elapsed-time budget");
            return { status: "uploading" };
          },
        },
        transferId: "t1",
        timeoutMs: 2_000,
        pollIntervalMs: 1_000,
        sleep: async (ms) => {
          elapsed += ms;
          wallTime += ms + (elapsed === 1_000 ? jump : 0);
        },
      }),
      TransferStillUploadingError,
    );
    assert.equal(elapsed, 2_000);
    assert.equal(calls, 3);
  });
}

test("a transfer that no longer exists is reported straight away", async () => {
  const clock = fakeClock();
  const api = {
    getTransferMetadata: async () => {
      const err = new Error("Transfer not found");
      err.status = 404;
      throw err;
    },
  };

  await assert.rejects(
    () =>
      waitForTransferReady({
        api,
        transferId: "t1",
        accessToken: "token",
        sleep: clock.sleep,
        now: clock.now,
      }),
    /Transfer not found/,
  );
});

test("the default wait covers the window a sender needs", () => {
  // A sender shows its QR code and waits for a direct connection for about a
  // minute before it uploads, so the wait has to outlast that.
  assert.ok(DEFAULT_READY_TIMEOUT_MS >= 60_000);
  assert.ok(DEFAULT_READY_POLL_INTERVAL_MS >= 1_000);
  assert.ok(DEFAULT_READY_POLL_INTERVAL_MS <= 10_000);
});

const jsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "js");

test("the receiver page waits for the sender instead of giving up", () => {
  const source = readFileSync(join(jsDir, "pages", "receive.js"), "utf8");

  assert.match(source, /waitForTransferReady/);
  assert.match(source, /isNotReadyError/);
});

test("the receiver page never blames a working link for expiring", () => {
  const source = readFileSync(join(jsDir, "pages", "receive.js"), "utf8");

  // A sender that is still uploading is not an expired link, and saying so
  // sends the reader off for a fresh QR code they do not need.
  assert.equal(source.includes("The link may have expired"), false);
  assert.match(source, /still uploading/);
});
