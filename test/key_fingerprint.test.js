import { test } from "node:test";
import assert from "node:assert/strict";

import { keyFingerprint } from "../js/core/key_fingerprint.js";

test("a public key has the same eight-digit check as the app", async () => {
  assert.equal(
    await keyFingerprint("receiver-public-key-000000000000000000"),
    "00f5 cb04",
  );
});
