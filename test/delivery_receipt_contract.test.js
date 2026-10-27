import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parseText, encodeHello, encodeReceipt } from "../js/core/framer.js";
const fixture = readFileSync(new URL("./fixtures/delivery_receipts.json", import.meta.url), "utf8");
test("receipt fixtures match the app when both repositories are present", () => {
  const app = new URL("../../client/test/fixtures/delivery_receipts.json", import.meta.url);
  if (existsSync(app)) assert.equal(readFileSync(app, "utf8"), fixture);
});
for (const vector of JSON.parse(fixture)) test(`receipt contract: ${vector.wire}`, () => {
  const frame = parseText(vector.wire);
  assert.equal(frame?.kind ?? null, vector.kind);
  if (vector.kind === "hello") assert.equal(frame.receipts === true, vector.receipts);
  if (vector.kind === "receipt") {
    assert.equal(frame.sha256 ?? null, vector.sha256 ?? null);
    if (vector.sha256) {
      assert.equal(encodeReceipt(frame.files, frame.bytes, frame.sha256), vector.wire);
    } else {
      assert.equal(encodeReceipt(frame.files, frame.bytes), '{"t":"ack","files":2,"bytes":64}');
    }
  }
});
test("receipt negotiation is opt-in without changing legacy hello bytes", () => {
  assert.equal(encodeHello(), '{"t":"hi","v":2}');
  assert.equal(encodeHello(2, true), '{"t":"hi","v":2,"receipts":true}');
  assert.throws(() => encodeReceipt(0, 32));
});
