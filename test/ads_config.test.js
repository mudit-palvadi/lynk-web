import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveClientId,
  isAdsEnabled,
  buildBannerAttributes,
} from "../js/core/ads_config.js";

function withMeta(content) {
  const elements = [{ name: "lynk-adsense-client", getAttribute: () => content }];
  return {
    querySelector: (selector) =>
      selector === 'meta[name="lynk-adsense-client"]' ? elements[0] : null,
  };
}

test("client id resolves from the meta tag", () => {
  assert.equal(resolveClientId(withMeta("ca-pub-1234567890")), "ca-pub-1234567890");
});

test("missing or empty meta means ads stay disabled", () => {
  assert.equal(resolveClientId(withMeta(null)), "");
  assert.equal(resolveClientId(withMeta("")), "");
  assert.equal(isAdsEnabled(""), false);
});

test("ads are enabled only with a non-empty client id", () => {
  assert.equal(isAdsEnabled("ca-pub-1234567890"), true);
});

test("banner attributes follow the AdSense ins-tag contract", () => {
  const attrs = buildBannerAttributes({
    clientId: "ca-pub-x",
    slotId: "slot-9",
    format: "horizontal",
  });
  assert.deepEqual(attrs, {
    class: "adsbygoogle",
    style: "display:block",
    "data-ad-client": "ca-pub-x",
    "data-ad-slot": "slot-9",
    "data-ad-format": "horizontal",
    "data-full-width-responsive": "true",
  });
});
