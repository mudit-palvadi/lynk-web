// Run synchronously before third-party scripts, without touching storage.
// The receiver module consumes the original link once, after its imports load.
(() => {
  if (!window.location.hash) return;
  let initialLink = window.location.href;
  const clean = new URL(initialLink);
  clean.hash = "";
  window.history.replaceState(null, "", clean);
  window.__lynkTakeInitialLink = () => {
    const link = initialLink;
    initialLink = null;
    delete window.__lynkTakeInitialLink;
    return link;
  };
})();
