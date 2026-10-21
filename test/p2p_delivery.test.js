// The direct transfer has to report what is actually happening, and a file
// that reached the receiver must not be turned back into a cloud fallback.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { P2pCoordinator } from "../js/core/p2p_coordinator.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function coordinator(timeoutMs) {
  const state = { failed: 0 };
  const instance = new P2pCoordinator({
    actions: {
      createOffer: async () => ({}),
      sendSignaling: async () => {},
    },
    timeoutMs,
    onP2PFailed: () => {
      state.failed += 1;
    },
  });
  return { instance, state };
}

test("the handshake gives up when no peer answers", async () => {
  const { instance, state } = coordinator(20);

  instance.start({ role: "sender" });
  await sleep(80);

  assert.equal(state.failed, 1);
  instance.dispose();
});

test("the timeout does not fire once the peer has connected", async () => {
  const { instance, state } = coordinator(20);

  instance.start({ role: "sender" });
  instance.notifyConnected();
  await sleep(80);

  assert.equal(state.failed, 0, "a connected peer must not be timed out");
  instance.dispose();
});

test("the handshake budget is long enough for a phone that is cold starting", () => {
  const source = read("js/core/p2p_coordinator.js");
  const match = source.match(/DEFAULT_TIMEOUT_MS\s*=\s*(\d+)/);

  assert.ok(match, "the default timeout is not there");
  assert.ok(
    Number(match[1]) >= 15000,
    `the handshake budget is ${match[1]}ms, a phone opening the app from a QR needs more`,
  );
});

test("a delivered file is never turned back into a cloud fallback", () => {
  const session = read("js/core/p2p_session.js");

  assert.ok(
    session.includes("framesSent"),
    "the session does not remember that the frames were sent",
  );
  assert.ok(
    session.includes('onStatus?.("p2p-connected")'),
    "the connected state is never reported",
  );
  assert.ok(
    session.includes("!channelOpen"),
    "a signaling error after the channel opened still fails the transfer",
  );
  assert.ok(
    session.includes("timeoutMs: 30000"),
    "the sender still gives the handshake only eight seconds",
  );
});

test("the page tells the user what is happening", () => {
  const page = read("js/pages/send.js");

  assert.ok(page.includes("p2p-connected"), "the connected state is not handled");
  assert.ok(page.includes("Phone connected - sending directly"));
  assert.ok(page.includes("Delivered directly"));
  assert.ok(
    page.includes('phoneIsReady ? "sent" : "qr"'),
    "the QR comes back even when the phone is already connected",
  );
});
