import { test, skip } from "node:test";
import assert from "node:assert/strict";
import { LynkApi } from "../js/core/api.js";
import {
  encryptWithIvPrefix,
  decryptWithIvPrefix,
} from "../js/core/crypto.js";
import {
  generateReceiverKeyPair,
  wrapKey,
  unwrapKey,
} from "../js/core/key_wrap.js";

const BASE_URL = process.env.LYNK_API_BASE ?? "http://140.245.220.117:8000";

test("flow B pairing round-trips through the live backend", async () => {
  if (!process.env.LYNK_E2E) {
    skip("set LYNK_E2E=1 to run against the live backend");
    return;
  }

  const api = new LynkApi({ baseUrl: BASE_URL });
  const aesKey = "aaaabbbbccccddddeeeeffff00001111";
  const plain = new TextEncoder().encode("flow b: phone pairs with pc receiver");
  const packed = await encryptWithIvPrefix(plain, aesKey);

  // --- PC (web receiver): create pairing session + ephemeral X25519 pair ---
  const session = await api.createReceiverSession();
  const receiver = await generateReceiverKeyPair();
  assert.ok(session.sessionId);

  // --- Phone (sender): upload transfer, wrap AES key, attach ---
  const created = await api.createTransfer([
    { name: "flowb.bin", size: packed.length, type: "application/octet-stream" },
  ]);
  await fetch(created.files[0].uploadUrl, {
    method: "PUT",
    body: packed,
    headers: { "Content-Type": "application/octet-stream" },
  });
  await api.completeFile(created.transferId, created.files[0].fileId);
  const wrapped = await wrapKey({
    aesKey,
    receiverPublicKeyB64: receiver.publicKeyB64,
    sessionId: session.sessionId,
  });
  await api.attachTransfer(session.sessionId, created.transferId, wrapped);

  // --- PC polls and receives single-use wrapped_key, then downloads ---
  let attached;
  for (let attempt = 0; attempt < 10; attempt++) {
    attached = await api.getReceiverSession(session.sessionId);
    if (attached.status === "attached" && attached.wrappedKey) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(attached.status, "attached");
  assert.ok(attached.wrappedKey);

  const recoveredKey = await unwrapKey({
    wrappedBase64: attached.wrappedKey,
    privateKeySeed: receiver.privateKeySeed,
    sessionId: session.sessionId,
  });
  assert.equal(recoveredKey, aesKey);

  // Single-use wipe: second read must not expose the wrapped key again.
  const secondRead = await api.getReceiverSession(session.sessionId);
  assert.equal(secondRead.wrappedKey, null);

  const downloads = await api.getDownloadUrls(attached.transferId);
  const response = await fetch(downloads[0].downloadUrl);
  const ciphertext = new Uint8Array(await response.arrayBuffer());
  const recovered = await decryptWithIvPrefix(ciphertext, recoveredKey);
  assert.equal(new TextDecoder().decode(recovered), new TextDecoder().decode(plain));
});
