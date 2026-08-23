export function resolveClientId(document = globalThis.document) {
  const meta = document?.querySelector?.('meta[name="lynk-adsense-client"]');
  return meta?.getAttribute?.("content")?.trim() ?? "";
}

export function isAdsEnabled(clientId) {
  return typeof clientId === "string" && clientId.length > 0;
}

export function buildBannerAttributes({ clientId, slotId, format }) {
  return {
    class: "adsbygoogle",
    style: "display:block",
    "data-ad-client": clientId,
    "data-ad-slot": slotId,
    "data-ad-format": format ?? "auto",
    "data-full-width-responsive": "true",
  };
}
