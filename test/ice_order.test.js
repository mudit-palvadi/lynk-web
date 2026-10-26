import { test } from "node:test";
import assert from "node:assert/strict";
import { createOutboundOrder, createRemoteCandidateQueue } from "../js/core/p2p_session.js";

test("a candidate gathered before the offer is sent after it", () => {
  const order = createOutboundOrder();
  const early = { type: "candidate", candidate: { candidate: "candidate:early" } };

  assert.deepEqual(order.stage(early), []);
  assert.deepEqual(
    order.stage({ type: "offer", sdp: "v=0" }).map((message) => message.type),
    ["offer", "candidate"],
  );
});

test("a candidate gathered after the answer is sent immediately", () => {
  const order = createOutboundOrder();
  order.stage({ type: "answer", sdp: "v=0" });

  assert.deepEqual(order.stage({ type: "candidate", candidate: { candidate: "candidate:late" } }), [
    { type: "candidate", candidate: { candidate: "candidate:late" } },
  ]);
});

test("a remote candidate waits for the remote description", () => {
  const queue = createRemoteCandidateQueue();
  const early = { candidate: "candidate:early" };

  assert.deepEqual(queue.add(early), []);
  assert.deepEqual(queue.markReady(), [early]);
  assert.deepEqual(queue.add({ candidate: "candidate:late" }), [
    { candidate: "candidate:late" },
  ]);
});
