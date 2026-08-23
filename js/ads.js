import { resolveClientId, isAdsEnabled, buildBannerAttributes } from "./core/ads_config.js";

function loadScript(clientId) {
  if (document.querySelector(`script[src*="adsbygoogle"][data-client="${clientId}"]`)) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`;
  script.crossOrigin = "anonymous";
  script.dataset.client = clientId;
  document.head.appendChild(script);
}

export function mountBanner(container, { slotId, format }) {
  const clientId = resolveClientId();
  if (!isAdsEnabled(clientId) || !container) return false;

  loadScript(clientId);

  const ins = document.createElement("ins");
  for (const [name, value] of Object.entries(
    buildBannerAttributes({ clientId, slotId, format }),
  )) {
    ins.setAttribute(name, value);
  }
  container.appendChild(ins);

  try {
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch {}
  return true;
}

export function grantOnAdFailure(fallbackGrant) {
  return fallbackGrant;
}
