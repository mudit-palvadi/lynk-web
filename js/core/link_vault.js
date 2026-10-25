// Keeps the transfer key out of the address bar.
//
// receiver_bootstrap.js removes an incoming fragment before third-party
// scripts run. This module also scrubs links adopted later and keeps them in
// per-tab session storage for reloads. Storage is not sent automatically to
// the server, but it remains readable by scripts running on this origin.
//
// The browser objects can be passed in, so the behaviour can be tested
// without a DOM.
const STORAGE_KEY = "lynkshare.receiver-link";

function storage(overrides = {}) {
  // Even reading sessionStorage can throw when browser policy denies it.
  return overrides.storage ?? window.sessionStorage;
}

/** Removes the fragment from the address bar without reloading the page. */
export function scrubFragment(overrides = {}) {
  const location = overrides.location ?? window.location;
  const history = overrides.history ?? window.history;
  if (!location.hash) return;
  const clean = new URL(location.href);
  clean.hash = "";
  history.replaceState(null, "", clean);
}

/**
 * Keeps the key for a reload and takes it out of the address bar.
 *
 * Session storage is per tab and per origin, not part of an HTTP request.
 * It is readable by other scripts on this page,
 * which is why the key is also kept out of the DOM.
 */
export function stashLink({ transferId, aesKey, accessToken }, overrides) {
  try {
    storage(overrides).setItem(
      STORAGE_KEY,
      JSON.stringify({ transferId, aesKey, accessToken }),
    );
  } catch {
    // Storage is unavailable (private mode, or it is full). The key then
    // lives in memory only, and a reload needs the link again.
  }
  scrubFragment(overrides);
}

/** The link stashed by the last page load, if there was one. */
export function peekStashedLink(overrides) {
  try {
    const raw = storage(overrides).getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.aesKey !== "string" || !parsed.aesKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Forgets the stashed link, once the transfer is done with. */
export function clearStashedLink(overrides) {
  try {
    storage(overrides).removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
