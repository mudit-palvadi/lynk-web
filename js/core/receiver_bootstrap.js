// Run synchronously before third-party scripts, without touching storage.
// The receiver module consumes the original link once, after its imports load.
// Query credentials are removed even when there is no fragment, because the
// parser ignores them and they would otherwise stay in the address bar.
(() => {
  let initialLink = window.location.href;
  const clean = new URL(initialLink);
  const hadHash = clean.hash.length > 0;
  clean.hash = "";
  let removedQuery = false;
  for (const name of ["aesKey", "a", "api"]) {
    if (clean.searchParams.has(name)) {
      clean.searchParams.delete(name);
      removedQuery = true;
    }
  }
  if (!hadHash && !removedQuery) return;
  window.history.replaceState(null, "", clean);
  if (!hadHash) return;
  window.__lynkTakeInitialLink = () => {
    const link = initialLink;
    initialLink = null;
    delete window.__lynkTakeInitialLink;
    return link;
  };
})();
