// Data-channel framing shared with the app receiver. A name travels either in
// clear (v1) or as a sealed token (v2) when the peer has said it can open one.
export function encodeHello(version = 2) {
  return JSON.stringify({ t: "hi", v: version });
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
      return { kind: "hello", version: typeof json.v === "number" ? json.v : 1 };
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
