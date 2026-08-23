export function parseMessage(raw) {
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    return { type: "error" };
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) {
    return { type: "error" };
  }

  switch (json.type) {
    case "offer":
      return { type: "offer", sdp: json.sdp ?? null };
    case "answer":
      return { type: "answer", sdp: json.sdp ?? null };
    case "candidate":
      return {
        type: "candidate",
        candidate:
          json.candidate !== null && typeof json.candidate === "object"
            ? json.candidate
            : null,
      };
    default:
      return { type: "error" };
  }
}

export function encodeOffer(sdp) {
  return { type: "offer", sdp };
}

export function encodeAnswer(sdp) {
  return { type: "answer", sdp };
}

export function encodeCandidate(candidate) {
  return { type: "candidate", candidate };
}
