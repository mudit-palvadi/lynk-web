// The data-channel header used to carry the file name in clear text (#32). A
// peer that announces itself gets the name sealed with the transfer key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeEof, encodeHeader, encodeHello, parseText } from "../js/core/framer.js";
import { openName, sealName } from "../js/core/p2p_session.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

const KEY = "0123456789abcdef0123456789abcdef";

test("a sealed header travels without the name", async () => {
  const token = await sealName("holiday.jpg", KEY);
  const frame = encodeHeader({ token, size: 4096 });
  assert.deepEqual(JSON.parse(frame), { t: "hdr", v: 2, n: token, size: 4096 });
  assert.ok(!frame.includes("holiday.jpg"), "the name is still in the clear");
  assert.deepEqual(parseText(frame), { kind: "header", token, size: 4096 });
});

test("a peer without the sealed form still gets a plain header", () => {
  const frame = encodeHeader({ name: "holiday.jpg", size: 4096 });
  assert.deepEqual(JSON.parse(frame), { t: "hdr", name: "holiday.jpg", size: 4096 });
  assert.deepEqual(parseText(frame), { kind: "header", name: "holiday.jpg", size: 4096 });
});

test("the end-of-file frame matches either shape", () => {
  assert.deepEqual(parseText(encodeEof({ token: "tok-1" })), { kind: "eof", token: "tok-1" });
  assert.deepEqual(parseText(encodeEof({ name: "holiday.jpg" })), { kind: "eof", name: "holiday.jpg" });
});

test("the hello advertises the sealed-name version", () => {
  assert.deepEqual(JSON.parse(encodeHello()), { t: "hi", v: 2 });
  assert.deepEqual(parseText(encodeHello()), { kind: "hello", version: 2 });
  assert.deepEqual(parseText('{"t":"hi"}'), { kind: "hello", version: 1 });
});

test("a sealed name opens only with the transfer key", async () => {
  const token = await sealName("holiday.jpg", KEY);
  assert.equal(await openName(token, KEY), "holiday.jpg");
  assert.notEqual(await openName(token, "ffffffffffffffffffffffffffffffff"), "holiday.jpg");
});

test("the sender waits for the hello before it seals", () => {
  const source = read("js/core/p2p_session.js");
  const wait = source.indexOf("peerOpensNames");
  const header = source.indexOf("encodeHeader(", source.indexOf("sendFrames"));
  assert.ok(wait >= 0, "the sender never waits for the hello");
  assert.ok(header > wait, "a header goes out before the peer has said hello");
  assert.match(source, /channel\.onopen = \(\) => \{[\s\S]{0,300}encodeHello\(\)/);
});

test("the send page hands the transfer key to the direct path", () => {
  assert.match(read("js/pages/send.js"), /sendViaP2p\(\{[\s\S]*aesKey: key/);
});
