import { test, skip } from "node:test";
import assert from "node:assert/strict";
import { LynkApi } from "../js/core/api.js";
import {
  encryptWithIvPrefix,
  decryptWithIvPrefix,
} from "../js/core/crypto.js";

const BASE_URL = process.env.LYNK_API_BASE ?? "http://140.245.220.117:8000";

test("cloud receive path round-trips against the live backend", async (t) => {
  if (!process.env.LYNK_E2E) {
    skip("set LYNK_E2E=1 to run against the live backend");
    return;
  }

  const key = "0123456789abcdef0123456789abcdef";
  const plain = new TextEncoder().encode(
    "lynk e2e: web receiver decrypts what a sender uploaded " + "x".repeat(5000),
  );
  const packed = await encryptWithIvPrefix(plain, key);

  const api = new LynkApi({ baseUrl: BASE_URL });

  const created = await api.request(`${BASE_URL}/api/v1/transfers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      files: [
        {
          file_name: "web-e2e.bin",
          file_size: packed.length,
          content_type: "application/octet-stream",
        },
      ],
    }),
  });

  const file = created.files[0];
  assert.equal(created.transfer_id.length > 0, true);

  const upload = await fetch(file.upload_url, {
    method: "PUT",
    body: packed,
    headers: { "Content-Type": "application/octet-stream" },
  });
  assert.equal(upload.status, 200, `upload failed: ${upload.status}`);

  await api.request(
    `${BASE_URL}/api/v1/transfers/${created.transfer_id}/files/${file.file_id}/complete`,
    { method: "POST" },
  );

  const metadata = await api.getTransferMetadata(created.transfer_id);
  assert.equal(metadata.files[0].file_name, "web-e2e.bin");

  const downloads = await api.getDownloadUrls(created.transfer_id);
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].fileName, "web-e2e.bin");

  const response = await fetch(downloads[0].downloadUrl);
  assert.equal(response.ok, true);
  const ciphertext = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual(Buffer.from(ciphertext.subarray(0, 16)).length, 16);

  const recovered = await decryptWithIvPrefix(ciphertext, key);
  assert.equal(new TextDecoder().decode(recovered), new TextDecoder().decode(plain));

  const wrongKey = await decryptWithIvPrefix(
    await encryptWithIvPrefix(plain, key),
    "ffffffffffffffffffffffffffffffff".slice(0, 32),
  ).catch(() => null);
  assert.equal(wrongKey === null || Buffer.from(wrongKey).equals(Buffer.from(plain)) === false, true);
});
