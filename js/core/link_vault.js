// Keeps the transfer key out of the address bar.
//
// The key stays in this page's memory. It is not written to sessionStorage,
// so another script on the origin cannot read it back after this page is
// gone. A reload needs the link again.
//
// The browser objects can be passed in, so the behaviour can be tested
// without a DOM.
const pageHold = { current: null };

function hold(overrides) {
  if (overrides) {
    if (!overrides.hold) overrides.hold = { current: null };
    return overrides.hold;
  }
  return pageHold;
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
 * Keeps the key for this page and takes it out of the address bar.
 *
 * Nothing is written to storage. The key lives only until the page is left.
 */
export function stashLink({ transferId, aesKey, accessToken }, overrides) {
  const slot = hold(overrides);
  if (typeof aesKey === "string" && aesKey) {
    slot.current = { transferId, aesKey, accessToken: accessToken ?? "" };
  } else {
    slot.current = null;
  }
  scrubFragment(overrides);
}

/** The link kept for this page, if there is one. */
export function peekStashedLink(overrides) {
  const current = hold(overrides).current;
  if (!current || typeof current.aesKey !== "string" || !current.aesKey) return null;
  return current;
}

/** Forgets the stashed link, once the transfer is done with. */
export function clearStashedLink(overrides) {
  hold(overrides).current = null;
}
