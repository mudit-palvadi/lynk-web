import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSendLink, parseReceiverQrLink } from "../js/core/link_parser.js";

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

test("receiver QR link yields session id and pk", () => {
  const parsed = parseReceiverQrLink(
    new URL("https://lynkshare.app/receive/rs9#pk=abc123DEF-_"),
  );
  assert.deepEqual(parsed, { sessionId: "rs9", publicKeyB64: "abc123DEF-_" });
});

test("receiver QR link without pk degrades to empty string", () => {
  const parsed = parseReceiverQrLink(new URL("https://lynkshare.app/receive/rs9"));
  assert.deepEqual(parsed, { sessionId: "rs9", publicKeyB64: "" });
});

test("non-receive links yield empty session id", () => {
  const parsed = parseReceiverQrLink(
    new URL("https://lynkshare.app/send/t1#key"),
  );
  assert.equal(parsed.sessionId, "");
});
