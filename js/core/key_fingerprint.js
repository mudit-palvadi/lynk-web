/** Eight hex digits from the first four SHA-256 bytes of a receiver public key. */
export async function keyFingerprint(publicKeyB64) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(publicKeyB64),
  );
  const hex = [...new Uint8Array(digest).slice(0, 4)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 4)} ${hex.slice(4)}`;
}
