// Data-channel framing shared with the app receiver. A name travels either in
// clear (v1) or as a sealed token (v2) when the peer has said it can open one.
export function encodeHello(version = 2, receipts = false) {
  return JSON.stringify({ t: "hi", v: version, ...(receipts ? { receipts: true } : {}) });
}

const DIGEST = /^[0-9a-f]{64}$/;

export async function sha256Hex(parts) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const all = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    const bytes = part instanceof Uint8Array ? part : new Uint8Array(part);
    all.set(bytes, offset);
    offset += bytes.byteLength;
  }
  const digest = await crypto.subtle.digest("SHA-256", all);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function encodeReceipt(files, bytes, sha256) {
  if (!Number.isSafeInteger(files) || files <= 0 || files > 10 ||
      !Number.isSafeInteger(bytes) || bytes <= 0) throw new Error("invalid receipt");
  if (sha256 != null && !DIGEST.test(sha256)) throw new Error("invalid receipt");
  return JSON.stringify(sha256 == null
    ? { t: "ack", files, bytes }
    : { t: "ack", files, bytes, sha256 });
}

export function encodeHeader(meta) {
  if (meta.token) {
    return JSON.stringify({ t: "hdr", v: 2, n: meta.token, size: meta.size });
  }
  return JSON.stringify({ t: "hdr", name: meta.name, size: meta.size });
}

export function encodeEof(meta) {
  if (meta.token) {
    return JSON.stringify({ t: "eof", v: 2, n: meta.token });
  }
  return JSON.stringify({ t: "eof", name: meta.name });
}

export function encodeDone() {
  return JSON.stringify({ t: "done" });
}

export function parseText(raw) {
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return null;
  }

  switch (json.t) {
    case "hi":
      return { kind: "hello", version: typeof json.v === "number" ? json.v : 1,
        ...(json.receipts === true ? { receipts: true } : {}) };
    case "ack":
      if (!Number.isSafeInteger(json.files) || json.files <= 0 || json.files > 10 ||
          !Number.isSafeInteger(json.bytes) || json.bytes <= 0) return null;
      if (json.sha256 !== undefined && !DIGEST.test(json.sha256)) return null;
      return {
        kind: "receipt",
        files: json.files,
        bytes: json.bytes,
        ...(json.sha256 ? { sha256: json.sha256 } : {}),
      };
    case "hdr":
      if (typeof json.n === "string" && typeof json.size === "number") {
        return { kind: "header", token: json.n, size: json.size };
      }
      if (typeof json.name !== "string" || typeof json.size !== "number") {
        return null;
      }
      return { kind: "header", name: json.name, size: json.size };
    case "eof":
      if (typeof json.n === "string") return { kind: "eof", token: json.n };
      if (typeof json.name !== "string") return null;
      return { kind: "eof", name: json.name };
    case "done":
      return { kind: "done" };
    default:
      return null;
  }
}
