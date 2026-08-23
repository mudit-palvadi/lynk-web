import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseMessage,
  encodeOffer,
  encodeAnswer,
  encodeCandidate,
} from "../js/core/signaling.js";

test("offer message parses to exact wire shape", () => {
  const msg = parseMessage('{"type":"offer","sdp":"v=0..."}');
  assert.deepEqual(msg, { type: "offer", sdp: "v=0..." });
});

test("answer message parses to exact wire shape", () => {
  const msg = parseMessage('{"type":"answer","sdp":"v=1..."}');
  assert.deepEqual(msg, { type: "answer", sdp: "v=1..." });
});

test("candidate message keeps the nested candidate object", () => {
  const raw =
    '{"type":"candidate","candidate":{"candidate":"candidate:1 UDP","sdpMid":"0","sdpMLineIndex":0}}';
  assert.deepEqual(parseMessage(raw), {
    type: "candidate",
    candidate: {
      candidate: "candidate:1 UDP",
      sdpMid: "0",
      sdpMLineIndex: 0,
    },
  });
});

test("unknown or malformed messages degrade to error type, never throw", () => {
  assert.deepEqual(parseMessage("garbage"), { type: "error" });
  assert.deepEqual(parseMessage("[1]"), { type: "error" });
  assert.deepEqual(parseMessage('{"type":"who-knows"}'), { type: "error" });
});

test("encodeOffer/encodeAnswer emit exactly {type,sdp}", () => {
  assert.equal(JSON.stringify(encodeOffer("v=0...")), '{"type":"offer","sdp":"v=0..."}');
  assert.equal(JSON.stringify(encodeAnswer("v=1...")), '{"type":"answer","sdp":"v=1..."}');
});

const CANDIDATE_OBJ = { candidate: "c", sdpMid: "data" };

test("encodeCandidate nests candidate under its key like Dart toJson", () => {
  assert.equal(
    JSON.stringify(encodeCandidate(CANDIDATE_OBJ)),
    '{"type":"candidate","candidate":{"candidate":"c","sdpMid":"data"}}',
  );
});
