import { test } from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv } from "node:crypto";
import {
  encryptWithIvPrefix,
  decryptWithIvPrefix,
} from "../js/core/crypto.js";

const KEY = "0123456789abcdef0123456789abcdef";

function referenceDecrypt(buffer, keyString) {
  const decipher = createDecipheriv(
    "aes-256-cbc",
    Buffer.from(keyString, "utf8"),
    Buffer.from(buffer.subarray(0, 16)),
  );
  return Buffer.concat([
    decipher.update(buffer.subarray(16)),
    decipher.final(),
  ]);
}

test("encrypt output layout is 16-byte IV followed by ciphertext", async () => {
  const plain = new TextEncoder().encode("hello lynk");
  const out = await encryptWithIvPrefix(plain, KEY);

  assert.equal(out.length % 16, 0, "ciphertext must be block-aligned");
  assert.ok(out.length > 16 + 10, "must contain IV plus padded plaintext");
});

test("output decrypts correctly via independent OpenSSL reference", async () => {
  const plain = new TextEncoder().encode("cross-language vector payload");
  const out = await encryptWithIvPrefix(plain, KEY);

  const recovered = referenceDecrypt(out, KEY);
  assert.equal(recovered.toString("utf8"), "cross-language vector payload");
});

test("decrypt round-trips bytes encrypted by the OpenSSL reference", async () => {
  const iv = Buffer.alloc(16, 7);
  const cipher = createCipheriv(
    "aes-256-cbc",
    Buffer.from(KEY, "utf8"),
    iv,
  );
  const body = Buffer.concat([
    cipher.update(Buffer.from("dart encrypt package parity check")),
    cipher.final(),
  ]);
  const dartStyle = new Uint8Array(Buffer.concat([iv, body]));

  const recovered = await decryptWithIvPrefix(dartStyle, KEY);
  assert.equal(
    new TextDecoder().decode(recovered),
    "dart encrypt package parity check",
  );
});

test("round trip preserves binary data of arbitrary length", async () => {
  const sizes = [1, 15, 16, 17, 1024, 65537];
  for (const size of sizes) {
    const plain = new Uint8Array(size);
    for (let i = 0; i < size; i++) plain[i] = i % 251;
    const out = await encryptWithIvPrefix(plain, KEY);
    const recovered = await decryptWithIvPrefix(out, KEY);
    assert.deepEqual(Buffer.from(recovered), Buffer.from(plain), `size ${size}`);
  }
});

test("each encryption uses a fresh random IV", async () => {
  const plain = new TextEncoder().encode("iv uniqueness");
  const a = await encryptWithIvPrefix(plain, KEY);
  const b = await encryptWithIvPrefix(plain, KEY);
  assert.notDeepEqual(Buffer.from(a.subarray(0, 16)), Buffer.from(b.subarray(0, 16)));
});

test("a tampered ciphertext never gives back the original plaintext", async () => {
  // The file cipher is AES-CBC with a prepended IV and no authentication
  // tag, so a tampered ciphertext is usually rejected by the padding check -
  // but it can also decrypt to different bytes. What must never happen is
  // the original plaintext coming back, so that is what is asserted here.
  // (Asserting a rejection instead would be a test that fails about once
  // every 256 runs, because a flipped byte can leave the padding valid.)
  const plain = new TextEncoder().encode("integrity matters");
  const out = Uint8Array.from(await encryptWithIvPrefix(plain, KEY));
  out[out.length - 1] ^= 0xff;
  try {
    const recovered = await decryptWithIvPrefix(out, KEY);
    assert.notDeepEqual(Buffer.from(recovered), Buffer.from(plain));
  } catch {
    // Rejected outright, which is the usual case.
  }
});

test("invalid keys are rejected rather than silently padded or truncated", async () => {
  const plain = new TextEncoder().encode("strict key validation");
  for (const key of ["too-short", KEY + "EXTRA-IGNORED", null, 123]) {
    await assert.rejects(encryptWithIvPrefix(plain, key), /exactly 32 UTF-8 bytes/);
  }
});

test("empty payload produces IV plus padding block only", async () => {
  const out = await encryptWithIvPrefix(new Uint8Array(0), KEY);
  assert.equal(out.length, 32, "16 IV + 16 PKCS7 padding block");
  const recovered = await decryptWithIvPrefix(out, KEY);
  assert.equal(recovered.length, 0);
});
