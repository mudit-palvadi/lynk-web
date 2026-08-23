import { mountBanner } from "./ads.js";

function mountAll() {
  document.querySelectorAll("[data-ad-banner]").forEach((container) => {
    mountBanner(container, {
      slotId: container.dataset.adBanner || "",
      format: container.dataset.adFormat || "auto",
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountAll);
} else {
  mountAll();
}
