export function parseSendLink(url) {
  const segments = url.pathname.split("/").filter(Boolean);
  const transferId = segments.length > 0 ? decodeURIComponent(segments[segments.length - 1]) : "";

  const rawFragment = (url.hash.startsWith("#") ? url.hash.slice(1) : url.hash).split("?")[0];
  const aesKey =
    rawFragment !== "" ? rawFragment : (url.searchParams.get("aesKey") ?? "");

  return { transferId, aesKey };
}
