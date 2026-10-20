import { test } from "node:test";
import assert from "node:assert/strict";
import { createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync } from "node:crypto";
import {
  generateReceiverKeyPair,
  wrapKey,
  unwrapKey,
  unwrapDelivery,
  deriveKekBytes,
} from "../js/core/key_wrap.js";

const AES_KEY = "0123456789abcdef0123456789abcdef";
const SESSION = "sess123";

test("receiver key pair yields base64url public key and raw seed", async () => {
  const pair = await generateReceiverKeyPair();
  assert.equal(pair.publicKeyB64.length, 43, "32 bytes b64url without padding");
  assert.equal(Buffer.from(pair.privateKeySeed).length, 32);
});

test("wrap/unwrap round trip recovers the AES key", async () => {
  const receiver = await generateReceiverKeyPair();
  const wrapped = await wrapKey({
    aesKey: AES_KEY,
    receiverPublicKeyB64: receiver.publicKeyB64,
    sessionId: SESSION,
  });
  const recovered = await unwrapKey({
    wrappedBase64: wrapped,
    privateKeySeed: receiver.privateKeySeed,
    sessionId: SESSION,
  });
  assert.equal(recovered, AES_KEY);
});

test("v2 wrap carries the access token and still returns the AES key", async () => {
  const receiver = await generateReceiverKeyPair();
  const wrapped = await wrapKey({
    aesKey: AES_KEY,
    accessToken: "access-token-value",
    receiverPublicKeyB64: receiver.publicKeyB64,
    sessionId: SESSION,
  });
  const delivery = await unwrapDelivery({
    wrappedBase64: wrapped,
    privateKeySeed: receiver.privateKeySeed,
    sessionId: SESSION,
  });
  assert.equal(delivery.aesKey, AES_KEY);
  assert.equal(delivery.accessToken, "access-token-value");
  const recovered = await unwrapKey({
    wrappedBase64: wrapped,
    privateKeySeed: receiver.privateKeySeed,
    sessionId: SESSION,
  });
  assert.equal(recovered, AES_KEY);
});

test("blob layout matches the Dart wire format exactly", async () => {
  const receiver = await generateReceiverKeyPair();
  const wrapped = await wrapKey({
    aesKey: AES_KEY,
    receiverPublicKeyB64: receiver.publicKeyB64,
    sessionId: SESSION,
  });
  const bytes = Buffer.from(
    wrapped.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
  // 32 ephPub + 12 nonce + N ciphertext + 16 tag; plaintext is 32 UTF-8 chars
  assert.equal(bytes.length, 32 + 12 + AES_KEY.length + 16);
});

test("each wrap uses a fresh ephemeral key and nonce", async () => {
  const receiver = await generateReceiverKeyPair();
  const a = await wrapKey({ aesKey: AES_KEY, receiverPublicKeyB64: receiver.publicKeyB64, sessionId: SESSION });
  const b = await wrapKey({ aesKey: AES_KEY, receiverPublicKeyB64: receiver.publicKeyB64, sessionId: SESSION });
  assert.notEqual(a, b);
});

test("wrong session id breaks both HKDF salt and AAD", async () => {
  const receiver = await generateReceiverKeyPair();
  const wrapped = await wrapKey({ aesKey: AES_KEY, receiverPublicKeyB64: receiver.publicKeyB64, sessionId: SESSION });
  await assert.rejects(() =>
    unwrapKey({
      wrappedBase64: wrapped,
      privateKeySeed: receiver.privateKeySeed,
      sessionId: "other-session",
    }),
  );
});

test("wrong receiver seed cannot unwrap", async () => {
  const receiver = await generateReceiverKeyPair();
  const other = await generateReceiverKeyPair();
  const wrapped = await wrapKey({ aesKey: AES_KEY, receiverPublicKeyB64: receiver.publicKeyB64, sessionId: SESSION });
  await assert.rejects(() =>
    unwrapKey({
      wrappedBase64: wrapped,
      privateKeySeed: other.privateKeySeed,
      sessionId: SESSION,
    }),
  );
});

test("KEK derivation matches node HKDF reference (salt=session, info=lynk-wrapped-key-v1)", async () => {
  const a = generateKeyPairSync("x25519");
  const b = generateKeyPairSync("x25519");
  const shared = diffieHellman({ privateKey: a.privateKey, publicKey: b.publicKey });

  const expected = Buffer.from(
    hkdfSync("sha256", shared, Buffer.from(SESSION), Buffer.from("lynk-wrapped-key-v1"), 32),
  );
  const actual = Buffer.from(await deriveKekBytes(new Uint8Array(shared), SESSION));
  assert.deepEqual(actual, expected);
});
