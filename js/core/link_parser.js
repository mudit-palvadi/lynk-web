export function parseSendLink(url) {
  const segments = url.pathname.split("/").filter(Boolean);
  const transferId = segments.length > 0 ? decodeURIComponent(segments[segments.length - 1]) : "";

  const rawFragment = (url.hash.startsWith("#") ? url.hash.slice(1) : url.hash).split("?")[0];
  const marker = "&a=";
  const markerAt = rawFragment.indexOf(marker);
  const fragmentKey = markerAt < 0 ? rawFragment : rawFragment.slice(0, markerAt);
  const fragmentToken = markerAt < 0 ? "" : rawFragment.slice(markerAt + marker.length);
  const aesKey = fragmentKey !== "" ? fragmentKey : (url.searchParams.get("aesKey") ?? "");
  const accessToken = fragmentToken !== "" ? fragmentToken : (url.searchParams.get("a") ?? "");

  return { transferId, aesKey, accessToken };
}

export function parseReceiverQrLink(url) {
  const segments = url.pathname.split("/").filter(Boolean);
  const receiveIndex = segments.indexOf("receive");
  const sessionId = receiveIndex >= 0 && receiveIndex + 1 < segments.length
    ? decodeURIComponent(segments[receiveIndex + 1])
    : "";

  const fragment = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const publicKeyB64 = fragment.startsWith("pk=") ? fragment.slice(3) : "";

  return { sessionId, publicKeyB64 };
}
