const IV_LENGTH = 16;
const KEY_LENGTH = 32;

function sanitizeKey(keyString) {
  const clean = String(keyString ?? "").trim();
  if (clean.length === KEY_LENGTH) return clean;
  if (clean.length > KEY_LENGTH) return clean.slice(0, KEY_LENGTH);
  return clean.padEnd(KEY_LENGTH, "0");
}

function importAesKey(keyString) {
  const keyBytes = new TextEncoder().encode(sanitizeKey(keyString));
  return crypto.subtle.importKey("raw", keyBytes, { name: "AES-CBC" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptWithIvPrefix(plainBytes, keyString) {
  const key = await importAesKey(keyString);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, plainBytes),
  );
  const out = new Uint8Array(IV_LENGTH + ciphertext.length);
  out.set(iv, 0);
  out.set(ciphertext, IV_LENGTH);
  return out;
}

export async function decryptWithIvPrefix(packedBytes, keyString) {
  if (packedBytes.length <= IV_LENGTH) {
    throw new Error("ciphertext too short to contain an IV prefix");
  }
  const key = await importAesKey(keyString);
  const iv = packedBytes.subarray(0, IV_LENGTH);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-CBC", iv },
    key,
    packedBytes.subarray(IV_LENGTH),
  );
  return new Uint8Array(plaintext);
}
