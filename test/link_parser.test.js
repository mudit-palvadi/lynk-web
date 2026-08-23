import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSendLink } from "../js/core/link_parser.js";

test("extracts transfer id and fragment key from a canonical deep link", () => {
  const parsed = parseSendLink(
    new URL("https://lynkshare.app/send/abc-123#deadbeef00112233445566778899aabb"),
  );
  assert.deepEqual(parsed, {
    transferId: "abc-123",
    aesKey: "deadbeef00112233445566778899aabb",
  });
});

test("fragment wins over query parameter", () => {
  const parsed = parseSendLink(
    new URL("https://lynkshare.app/send/id1?aesKey=fromquery#fromfrag"),
  );
  assert.equal(parsed.aesKey, "fromfrag");
});

test("query param is honored as fallback when fragment missing", () => {
  const parsed = parseSendLink(
    new URL("https://lynkshare.app/send/id2?aesKey=fromquery"),
  );
  assert.equal(parsed.transferId, "id2");
  assert.equal(parsed.aesKey, "fromquery");
});

test("junk query riding inside the fragment is stripped from the key", () => {
  const parsed = parseSendLink(
    new URL("https://lynkshare.app/send/id3#thekey?utm_source=x"),
  );
  assert.equal(parsed.aesKey, "thekey");
});

test("missing parts degrade to empty strings instead of throwing", () => {
  assert.deepEqual(parseSendLink(new URL("https://lynkshare.app/")), {
    transferId: "",
    aesKey: "",
  });
  assert.deepEqual(parseSendLink(new URL("https://lynkshare.app/send/only-id")), {
    transferId: "only-id",
    aesKey: "",
  });
});
