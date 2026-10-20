import { test, skip } from "node:test";
import assert from "node:assert/strict";
import { LynkApi } from "../js/core/api.js";
import {
  encryptWithIvPrefix,
  decryptWithIvPrefix,
} from "../js/core/crypto.js";
import { buildSendLink } from "../js/core/link_builder.js";
import { parseSendLink } from "../js/core/link_parser.js";

const BASE_URL = process.env.LYNK_API_BASE ?? "http://140.245.220.117:8000";

test("web sender cloud flow round-trips through live backend and R2", async () => {
  if (!process.env.LYNK_E2E) {
    skip("set LYNK_E2E=1 to run against the live backend");
    return;
  }

  const key = "fedcba9876543210fedcba9876543210";
  const plain = new TextEncoder().encode(
    "web sender e2e payload " + JSON.stringify({ at: Date.now(), n: 42 }),
  );
  const packed = await encryptWithIvPrefix(plain, key);

  const api = new LynkApi({ baseUrl: BASE_URL });

  const created = await api.createTransfer([
    { name: "sender-e2e.bin", size: packed.length, type: "application/octet-stream" },
  ]);
  assert.equal(created.files.length, 1);
  assert.ok(created.transferId);

  const uploadResponse = await fetch(created.files[0].uploadUrl, {
    method: "PUT",
    body: packed,
    headers: { "Content-Type": "application/octet-stream" },
  });
  assert.equal(uploadResponse.status, 200);

  const completion = await api.completeFile(
    created.transferId,
    created.files[0].fileId,
    created.senderSecret,
  );
  assert.ok(completion);

  const extended = await api.extendTransfer(created.transferId, created.senderSecret);
  assert.equal(extended.expiresIn, 1800);

  const link = buildSendLink(
    "https://lynkshare.app",
    created.transferId,
    key,
    created.accessToken,
  );
  const parsedBack = parseSendLink(new URL(link));
  assert.equal(parsedBack.transferId, created.transferId);
  assert.equal(parsedBack.aesKey, key);
  assert.equal(parsedBack.accessToken, created.accessToken);

  const downloads = await api.getDownloadUrls(created.transferId, parsedBack.accessToken);
  const response = await fetch(downloads[0].downloadUrl);
  const ciphertext = new Uint8Array(await response.arrayBuffer());
  const recovered = await decryptWithIvPrefix(ciphertext, parsedBack.aesKey);
  assert.equal(
    new TextDecoder().decode(recovered),
    new TextDecoder().decode(plain),
  );
});
