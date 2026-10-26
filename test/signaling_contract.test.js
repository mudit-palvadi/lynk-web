import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parseMessage, encodeOffer, encodeAnswer, encodeCandidate } from "../js/core/signaling.js";

const fixture = new URL("./fixtures/signaling_contract.json", import.meta.url);
const contract = JSON.parse(readFileSync(fixture, "utf8"));

test("signaling fixture matches Dart when both repos are checked out", () => {
  const dart = new URL("../../client/test/fixtures/signaling_contract.json", import.meta.url);
  if (existsSync(dart)) assert.deepEqual(readFileSync(fixture), readFileSync(dart));
  assert.equal(contract.version, 1);
});

for (const { name, raw, expected } of contract.cases) {
  test(`Dart/browser signaling: ${name}`, () => {
    const parsed = parseMessage(raw);
    assert.deepEqual(parsed, expected);
    assert.equal(JSON.stringify(parsed), JSON.stringify(expected));
    let input;
    try { input = JSON.parse(raw); } catch { return; }
    const encode = { offer: encodeOffer, answer: encodeAnswer, candidate: encodeCandidate }[input?.type];
    if (encode) {
      const value = input.type === "candidate" ? input.candidate : input.sdp;
      assert.equal(JSON.stringify(encode(value)), JSON.stringify(expected));
    }
  });
}
