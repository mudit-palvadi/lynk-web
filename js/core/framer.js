export function encodeHeader(meta) {
  return JSON.stringify({ t: "hdr", name: meta.name, size: meta.size });
}

export function encodeEof(meta) {
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
    case "hdr":
      if (typeof json.name !== "string" || typeof json.size !== "number") {
        return null;
      }
      return { kind: "header", name: json.name, size: json.size };
    case "eof":
      if (typeof json.name !== "string") return null;
      return { kind: "eof", name: json.name };
    case "done":
      return { kind: "done" };
    default:
      return null;
  }
}
