import { test } from "node:test";
import assert from "node:assert/strict";
import { BackpressureController } from "../js/core/backpressure.js";

const MB = 1024 * 1024;

test("sending is allowed below the high water mark", () => {
  const bp = new BackpressureController();
  assert.equal(bp.canSend(MB - 1), true);
});

test("exactly at the high water mark is still allowed (strictly greater pauses)", () => {
  const bp = new BackpressureController();
  assert.equal(bp.canSend(MB), true);
});

test("crossing the high water mark pauses", () => {
  const bp = new BackpressureController();
  assert.equal(bp.canSend(MB + 1), false);
  assert.equal(bp.isPaused, true);
});

test("while paused, sends stay blocked above the resume mark", () => {
  const bp = new BackpressureController();
  bp.canSend(MB + 1);
  assert.equal(bp.canSend(512 * 1024), false);
});

test("resume happens at or below 256 KB and clears the pause", () => {
  const bp = new BackpressureController();
  bp.canSend(MB + 1);
  assert.equal(bp.canSend(256 * 1024), true);
  assert.equal(bp.isPaused, false);
});

test("hysteresis cycle repeats after resuming and overrunning again", () => {
  const bp = new BackpressureController();
  bp.canSend(MB + 1);
  bp.canSend(100 * 1024);
  assert.equal(bp.canSend(MB + 5), false);
  bp.canSend(256 * 1024);
  assert.equal(bp.canSend(64 * 1024), true);
});
