const PUBLIC_API_ORIGIN = "https://api.lynkshare.app";

let cachedPageBase = null;

function configuredBase() {
  if (typeof document === "undefined") return "";
  const meta = document.querySelector('meta[name="lynk-api-base"]');
  return (meta?.content ?? "").trim().replace(/\/+$/, "");
}

function allowedApiBase(candidate, configured) {
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return "";
  }
  if (url.username || url.password || url.search || url.hash) return "";
  if (url.pathname !== "/" && url.pathname !== "") return "";
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const local = loopback && (url.protocol === "http:" || url.protocol === "https:");
  let sameConfiguredOrigin = false;
  if (configured) {
    try {
      sameConfiguredOrigin = url.origin === new URL(configured).origin;
    } catch {
      sameConfiguredOrigin = false;
    }
  }
  if (url.origin !== PUBLIC_API_ORIGIN && !local && !sameConfiguredOrigin) return "";
  return candidate.replace(/\/+$/, "");
}

/**
 * The API the page should call.
 *
 * A `?api=` value is accepted only for the public API, this page's configured
 * origin, or a loopback address. Anything else is ignored, so a crafted link
 * cannot send the access token to storage or an ad host. The real page caches
 * the first answer and then drops `api` from the query.
 *
 * @param {Location} [location]
 * @returns {string}
 */
export function resolveApiBase(location = globalThis.location) {
  const forThisPage = location === globalThis.location;
  if (forThisPage && cachedPageBase) return cachedPageBase;

  const configured = configuredBase();
  const override = location?.searchParams?.get("api");
  const allowed = override ? allowedApiBase(override, configured) : "";
  const base = allowed || configured || location?.origin || "";

  if (forThisPage) {
    cachedPageBase = base;
    scrubCredentialQuery(location);
  }
  return base;
}

function scrubCredentialQuery(location) {
  if (!location?.href || typeof history === "undefined") return;
  const clean = new URL(location.href);
  let removed = false;
  for (const name of ["aesKey", "a", "api"]) {
    if (clean.searchParams.has(name)) {
      clean.searchParams.delete(name);
      removed = true;
    }
  }
  if (removed) history.replaceState(null, "", clean);
}
