import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { P2pCoordinator } from "../js/core/p2p_coordinator.js";

function fakeActions() {
  const calls = { sent: [], answers: 0, candidates: [] };
  return {
    calls,
    async handleRemoteDescription(msg) {
      if (msg.type === "offer") {
        calls.answers += 1;
        return { type: "answer", sdp: "local-answer" };
      }
      return null;
    },
    async addIceCandidate(candidate) {
      calls.candidates.push(candidate);
    },
    async sendSignaling(message) {
      calls.sent.push(message);
    },
  };
}

test("receiver answers a remote offer over signaling", async () => {
  const actions = fakeActions();
  const coordinator = new P2pCoordinator({ actions });
  await coordinator.start({ role: "receiver" });

  await coordinator.handleMessage({ type: "offer", sdp: "remote-offer" });

  assert.equal(actions.calls.answers, 1);
  assert.deepEqual(actions.calls.sent, [{ type: "answer", sdp: "local-answer" }]);
});

test("candidates are routed to the platform layer", async () => {
  const actions = fakeActions();
  const coordinator = new P2pCoordinator({ actions });
  await coordinator.start({ role: "receiver" });

  const candidate = { candidate: "candidate:1", sdpMid: "0" };
  await coordinator.handleMessage({ type: "candidate", candidate });
  assert.deepEqual(actions.calls.candidates, [candidate]);
});

test("null candidate and error messages are ignored safely", async () => {
  const actions = fakeActions();
  const coordinator = new P2pCoordinator({ actions });
  await coordinator.start({ role: "receiver" });

  await coordinator.handleMessage({ type: "candidate", candidate: null });
  await coordinator.handleMessage({ type: "error" });
  assert.equal(actions.calls.candidates.length, 0);
  assert.equal(actions.calls.sent.length, 0);
});

test("timeout fires onP2PFailed exactly once after 8 seconds", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const actions = fakeActions();
    let failures = 0;
    const coordinator = new P2pCoordinator({
      actions,
      onP2PFailed: () => {
        failures += 1;
      },
    });
    coordinator.start({ role: "receiver" });

    mock.timers.tick(7999);
    assert.equal(failures, 0);
    assert.equal(coordinator.hasFailed, false);

    mock.timers.tick(1);
    assert.equal(failures, 1);
    assert.equal(coordinator.hasFailed, true);

    mock.timers.tick(60000);
    assert.equal(failures, 1, "must not fire twice");
  } finally {
    mock.timers.reset();
  }
});

test("connecting in time cancels the timeout", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let failures = 0;
    const coordinator = new P2pCoordinator({
      actions: fakeActions(),
      onP2PFailed: () => {
        failures += 1;
      },
    });
    coordinator.start({ role: "receiver" });
    mock.timers.tick(4000);
    coordinator.notifyConnected();
    mock.timers.tick(10000);
    assert.equal(failures, 0);
  } finally {
    mock.timers.reset();
  }
});

test("dispose stops any pending timeout from firing", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    let failures = 0;
    const coordinator = new P2pCoordinator({
      actions: fakeActions(),
      onP2PFailed: () => {
        failures += 1;
      },
    });
    coordinator.start({ role: "receiver" });
    coordinator.dispose();
    mock.timers.tick(20000);
    assert.equal(failures, 0);
  } finally {
    mock.timers.reset();
  }
});
