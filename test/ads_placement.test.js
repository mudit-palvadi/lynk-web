// Guards where ads are allowed to appear, and where they must never appear.
//
// The receiver page holds the transfer key and the access token in its URL
// fragment, so no third-party script may run there. The send page does load
// the ad script, so the share link (which carries the same key) is kept out
// of its DOM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

const PUBLISHER = "ca-pub-9472143004063972";
const LANDING_SLOTS = ["6518797490", "5205715829", "5753132853"];
const TRANSFER_SLOT = "7640307472";

const index = read("index.html");
const send = read("app/send.html");
const receive = read("app/receive.html");

test("ads.txt declares the publisher for the ad server", () => {
  const adsTxt = read("ads.txt");
  assert.match(adsTxt, /^google\.com, pub-9472143004063972, DIRECT, [0-9a-f]+$/m);
});

test("the pages carry Google's ad script in the served HTML", () => {
  // The site-ownership check fetches the page and looks for this script, so
  // a loader that is only added by JavaScript cannot be found and the site
  // cannot be verified.
  const snippet =
    "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9472143004063972";

  for (const page of ["index.html", "app/send.html", "app/receive.html"]) {
    assert.ok(read(page).includes(snippet), `${page} has no ad script in its HTML`);
  }
});

test("the landing page loads the ad script and every landing unit", () => {
  assert.ok(index.includes(`content="${PUBLISHER}"`), "publisher id missing");
  for (const slot of LANDING_SLOTS) {
    assert.ok(index.includes(`data-ad-banner="${slot}"`), `slot ${slot} missing`);
  }
  assert.ok(index.includes("/js/mount_ads.js"));
});

test("the landing page points people at the app", () => {
  assert.ok(
    index.includes("https://play.google.com/store/apps/details?id=app.xynix.lynk"),
    "no store link",
  );
  assert.ok(index.includes("LynkShare for Android"));
});

test("the landing page has no inline script, so a strict CSP can stand", () => {
  // A `<script>` without a src is either inline JavaScript, which the CSP
  // would have to allow with `unsafe-inline`, or a data block such as
  // JSON-LD, which the browser never executes.
  const inlineScripts = [...index.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/gi)];
  for (const [tag] of inlineScripts) {
    assert.ok(
      tag.includes('type="application/ld+json"'),
      `inline script is not a data block: ${tag}`,
    );
  }
  assert.ok(index.includes('/js/pages/index.js'));
});

test("the send page carries the ad unit and the publisher id", () => {
  assert.ok(send.includes(`content="${PUBLISHER}"`));
  assert.ok(send.includes(`data-ad-banner="${TRANSFER_SLOT}"`));
  assert.ok(send.includes("/js/mount_ads.js"));
});

test("the send page never puts the share link in the DOM", () => {
  // The link carries the AES key and the access token. The page loads a
  // third-party script, so the link may not be readable from the page.
  assert.ok(!send.includes('id="link-box"'), "the link is still rendered");
});

test("the receiver page carries one ad unit", () => {
  assert.ok(receive.includes(`content="${PUBLISHER}"`));
  const units = [...receive.matchAll(/data-ad-banner="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(units, [TRANSFER_SLOT], "the receiver page should have one unit");
  assert.ok(receive.includes("/js/mount_ads.js"));
});

test("the receiver page loads the ad loader after the page script", () => {
  // The page script takes the key out of the address bar. Module scripts run
  // in document order, so the ad loader has to come after it, or Google would
  // be asked for anything while the key was still in the URL.
  const pageScript = receive.indexOf("/js/pages/receive.js");
  const adLoader = receive.indexOf("/js/mount_ads.js");

  assert.ok(pageScript >= 0, "the page script is missing");
  assert.ok(adLoader > pageScript, "the ad loader must run last");
});

test("the receiver page keeps the key out of the DOM", () => {
  const page = read("js/pages/receive.js");
  assert.ok(page.includes('els.pasteInput.value = ""'), "the pasted link is not cleared");
  assert.ok(page.includes("stashLink("), "the key is not taken out of the address bar");
});

test("the security headers are set, and scripts stay strict", () => {
  assert.ok(existsSync(join(root, "_headers")), "_headers is missing");
  const headers = read("_headers");

  assert.ok(headers.includes("X-Content-Type-Options: nosniff"));
  assert.ok(headers.includes("Referrer-Policy: no-referrer"));

  const csp = headers.split("Content-Security-Policy:")[1] ?? "";
  assert.ok(csp.includes("script-src 'self'"), "no script-src in the CSP");
  assert.ok(
    !/script-src[^;]*unsafe-inline/.test(csp),
    "script-src must not allow inline scripts",
  );
  assert.ok(csp.includes("pagead2.googlesyndication.com"), "the ad loader is blocked");
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(
    csp.includes("static.cloudflareinsights.com"),
    "Cloudflare's analytics beacon would be blocked",
  );
  assert.ok(
    /script-src[^;]*adtrafficquality\.google/.test(csp),
    "the ad loader's audience matcher would be blocked",
  );
});
