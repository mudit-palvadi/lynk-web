// Keeps the transfer key out of the address bar.
//
// The key arrives in the URL fragment. This page loads Google's ad script,
// and the fragment is part of the page's URL, which an ad request can carry,
// so the key could leave the browser along with the ad. The fragment is
// therefore removed as soon as the key has been read, and the key is kept in
// session storage instead: the same tab, the same origin, and never sent
// anywhere.
//
// The browser objects can be passed in, so the behaviour can be tested
// without a DOM.
const STORAGE_KEY = "lynkshare.receiver-link";

function env(overrides = {}) {
  return {
    location: overrides.location ?? window.location,
    history: overrides.history ?? window.history,
    storage: overrides.storage ?? window.sessionStorage,
  };
}

/** Removes the fragment from the address bar without reloading the page. */
export function scrubFragment(overrides) {
  const { location, history } = env(overrides);
  if (!location.hash) return;
  const clean = new URL(location.href);
  clean.hash = "";
  history.replaceState(null, "", clean);
}

/**
 * Keeps the key for a reload and takes it out of the address bar.
 *
 * Session storage is per tab and per origin: it is never sent to the server
 * and never leaves the browser. It is readable by other scripts on this page,
 * which is why the key is also kept out of the DOM.
 */
export function stashLink({ transferId, aesKey, accessToken }, overrides) {
  const { storage } = env(overrides);
  try {
    storage.setItem(
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
  const { storage } = env(overrides);
  try {
    const raw = storage.getItem(STORAGE_KEY);
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
  const { storage } = env(overrides);
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
