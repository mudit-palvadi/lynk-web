// Data-channel framing shared with the app receiver. A name travels either in
// clear (v1) or as a sealed token (v2) when the peer has said it can open one.
export function encodeHello(version = 2, receipts = false) {
  return JSON.stringify({ t: "hi", v: version, ...(receipts ? { receipts: true } : {}) });
}

export function encodeReceipt(files, bytes) {
  if (!Number.isSafeInteger(files) || files <= 0 || files > 10 ||
      !Number.isSafeInteger(bytes) || bytes <= 0) throw new Error("invalid receipt");
  return JSON.stringify({ t: "ack", files, bytes });
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
      return { kind: "receipt", files: json.files, bytes: json.bytes };
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
