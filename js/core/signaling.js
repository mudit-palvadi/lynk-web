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
      return encodeOffer(json.sdp);
    case "answer":
      return encodeAnswer(json.sdp);
    case "candidate":
      return encodeCandidate(json.candidate);
    default:
      return { type: "error" };
  }
}

export function encodeOffer(sdp) {
  return encodeSdp("offer", sdp);
}

export function encodeAnswer(sdp) {
  return encodeSdp("answer", sdp);
}

export function encodeCandidate(candidate) {
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate) ||
      typeof candidate.candidate !== "string") return { type: "error" };
  const { sdpMid: mid, sdpMLineIndex: index } = candidate;
  if (mid != null && typeof mid !== "string") return { type: "error" };
  if (index != null && (!Number.isInteger(index) || index < 0 || index > 65535)) {
    return { type: "error" };
  }
  // Preserve omitted/null fields, including the empty end-of-candidates marker.
  const normalized = { candidate: candidate.candidate };
  if (Object.hasOwn(candidate, "sdpMid")) normalized.sdpMid = mid;
  if (Object.hasOwn(candidate, "sdpMLineIndex")) normalized.sdpMLineIndex = index;
  return { type: "candidate", candidate: normalized };
}

function encodeSdp(type, sdp) {
  return typeof sdp === "string" && sdp.trim().length > 0
    ? { type, sdp }
    : { type: "error" };
}
