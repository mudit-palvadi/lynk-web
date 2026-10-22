// The signaling room asks for the transfer token in the first frame (#32), so
// both direct paths have to present it before they start the handshake.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sendAuthFrame } from "../js/core/p2p_session.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

function socket(readyState = 1) {
  return {
    readyState,
    sent: [],
    send(frame) {
      this.sent.push(frame);
    },
  };
}

test("the room token is the first frame on the socket", () => {
  const ws = socket();
  sendAuthFrame(ws, "tok-1");
  assert.deepEqual(ws.sent, ['{"type":"auth","token":"tok-1"}']);
});

test("a room without a token sends nothing", () => {
  const ws = socket();
  sendAuthFrame(ws, "");
  assert.deepEqual(ws.sent, []);
});

test("a socket that is still connecting is left alone", () => {
  const ws = socket(0);
  sendAuthFrame(ws, "tok-1");
  assert.deepEqual(ws.sent, []);
});

test("both direct paths authenticate before they start the handshake", () => {
  const source = read("js/core/p2p_session.js");
  const openings = source.split("ws.onopen = () => {").slice(1);
  assert.equal(openings.length, 2, "expected the receiver and sender sockets");
  for (const block of openings) {
    const auth = block.indexOf("sendAuthFrame(ws, accessToken)");
    const start = block.indexOf("coordinator.start(");
    assert.ok(auth >= 0, "an onopen handler never presents the token");
    assert.ok(start > auth, "the handshake starts before the token is sent");
  }
});

test("the pages hand their token to the direct path", () => {
  assert.match(read("js/pages/send.js"), /sendViaP2p\(\{[\s\S]*accessToken: currentAccessToken/);
  assert.match(read("js/pages/receive.js"), /receiveViaP2p\(\{[\s\S]*accessToken: state\.accessToken/);
});
