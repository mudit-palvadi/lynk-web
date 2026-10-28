// Classic script, immediately after the bootstrap. A module is deferred, so
// it would run after every classic script on the page, including one injected
// later in the document. This takes the link into a local binding and drops
// the window handoff before yielding. A script inserted between these two
// tags could still wrap the taker; nothing on the page sits between them.
(function () {
  var take = window.__lynkTakeInitialLink;
  var link = typeof take === "function" ? take() : window.location.href;
  delete window.__lynkTakeInitialLink;
  if (typeof window.__lynkLoadReceivePage === "function") {
    window.__lynkLoadReceivePage(link);
    return;
  }
  import("/js/pages/receive.js").then(function (page) {
    page.start(link);
  });
})();
