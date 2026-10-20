const KEY_INFO = "lynk-wrapped-key-v1";
const X25519_PKCS8_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e,
  0x04, 0x22, 0x04, 0x20,
]);

function encodeBase64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function importX25519PrivateFromSeed(seed) {
  const pkcs8 = new Uint8Array(X25519_PKCS8_PREFIX.length + seed.length);
  pkcs8.set(X25519_PKCS8_PREFIX, 0);
  pkcs8.set(seed, X25519_PKCS8_PREFIX.length);
  return crypto.subtle.importKey("pkcs8", pkcs8, { name: "X25519" }, false, [
    "deriveBits",
  ]);
}

export async function generateReceiverKeyPair() {
  const pair = await crypto.subtle.generateKey({ name: "X25519" }, true, [
    "deriveBits",
  ]);
  const rawPub = await crypto.subtle.exportKey("raw", pair.publicKey);
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  return {
    publicKeyB64: encodeBase64Url(new Uint8Array(rawPub)),
    privateKeySeed: new Uint8Array(pkcs8.slice(X25519_PKCS8_PREFIX.length)),
  };
}

export async function deriveKekBytes(sharedSecretBytes, sessionId) {
  const key = await crypto.subtle.importKey("raw", sharedSecretBytes, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode(sessionId),
      info: new TextEncoder().encode(KEY_INFO),
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function agreeKek(privateKeySeedOrKey, remotePublicKeyBytes, sessionId) {
  const privateKey =
    privateKeySeedOrKey instanceof CryptoKey
      ? privateKeySeedOrKey
      : await importX25519PrivateFromSeed(privateKeySeedOrKey);
  const remotePub = await crypto.subtle.importKey(
    "raw",
    remotePublicKeyBytes,
    { name: "X25519" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "X25519", public: remotePub }, privateKey, 256),
  );
  return deriveKekBytes(shared, sessionId);
}

function wrappedPlaintext(aesKey, accessToken) {
  if (!accessToken) return aesKey;
  return `v2\n${aesKey}\n${accessToken}`;
}

export function splitWrappedPlaintext(plain) {
  const prefix = "v2\n";
  if (!plain.startsWith(prefix)) return { aesKey: plain, accessToken: "" };
  const rest = plain.slice(prefix.length);
  const splitAt = rest.indexOf("\n");
  if (splitAt < 0) return { aesKey: rest, accessToken: "" };
  return { aesKey: rest.slice(0, splitAt), accessToken: rest.slice(splitAt + 1) };
}

export async function wrapKey({ aesKey, receiverPublicKeyB64, sessionId, accessToken }) {
  const ephemeral = await crypto.subtle.generateKey({ name: "X25519" }, true, [
    "deriveBits",
  ]);
  const ephPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));

  const kek = await agreeKek(ephemeral.privateKey, decodeBase64Url(receiverPublicKeyB64), sessionId);

  const aesKeyBytes = new TextEncoder().encode(wrappedPlaintext(aesKey, accessToken));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(sessionId);
  const params = { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 };
  const kekKey = await crypto.subtle.importKey("raw", kek, "AES-GCM", false, ["encrypt"]);
  const cipherWithTag = new Uint8Array(
    await crypto.subtle.encrypt(params, kekKey, aesKeyBytes),
  );
  const ciphertext = cipherWithTag.subarray(0, cipherWithTag.length - 16);
  const tag = cipherWithTag.subarray(cipherWithTag.length - 16);

  const out = new Uint8Array(32 + 12 + ciphertext.length + 16);
  out.set(ephPubRaw, 0);
  out.set(nonce, 32);
  out.set(ciphertext, 44);
  out.set(tag, 44 + ciphertext.length);
  return encodeBase64Url(out);
}

export async function unwrapKey({ wrappedBase64, privateKeySeed, sessionId }) {
  const delivery = await unwrapDelivery({ wrappedBase64, privateKeySeed, sessionId });
  return delivery.aesKey;
}

export async function unwrapDelivery({ wrappedBase64, privateKeySeed, sessionId }) {
  const bytes = decodeBase64Url(wrappedBase64);
  if (bytes.length < 60) {
    throw new Error("wrapped_key payload too short");
  }

  const ephPub = bytes.slice(0, 32);
  const nonce = bytes.slice(32, 44);
  const ciphertext = bytes.slice(44, bytes.length - 16);
  const tag = bytes.slice(bytes.length - 16);

  const kek = await agreeKek(privateKeySeed, ephPub, sessionId);

  const aad = new TextEncoder().encode(sessionId);
  const sealed = new Uint8Array(ciphertext.length + tag.length);
  sealed.set(ciphertext, 0);
  sealed.set(tag, ciphertext.length);
  const kekKey = await crypto.subtle.importKey("raw", kek, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 },
    kekKey,
    sealed,
  );
  return splitWrappedPlaintext(new TextDecoder().decode(plain));
}
