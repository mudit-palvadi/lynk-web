// Guards where ads are allowed to appear, and where they must never appear.
//
// The send and receive pages hold the transfer key, so they load no ad
// script and no ad unit. The landing page still carries the publisher's
// units.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

const PUBLISHER = "ca-pub-9472143004063972";
const LANDING_SLOTS = ["6518797490", "5205715829", "5753132853"];

const index = read("index.html");
const send = read("app/send.html");
const receive = read("app/receive.html");

test("ads.txt declares the publisher for the ad server", () => {
  const adsTxt = read("ads.txt");
  assert.match(adsTxt, /^google\.com, pub-9472143004063972, DIRECT, [0-9a-f]+$/m);
});

test("the landing page carries Google's ad script in the served HTML", () => {
  // The site-ownership check fetches the page and looks for this script, so
  // a loader that is only added by JavaScript cannot be found and the site
  // cannot be verified.
  const snippet =
    "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9472143004063972";

  assert.ok(index.includes(snippet), "index.html has no ad script in its HTML");
  for (const page of [send, receive]) {
    assert.equal(page.includes("adsbygoogle"), false);
    assert.equal(page.includes("mount_ads.js"), false);
    assert.equal(page.includes("data-ad-banner"), false);
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

test("the send page never puts the share link in the DOM", () => {
  assert.ok(!send.includes('id="link-box"'), "the link is still rendered");
});

test("the receiver page keeps the key out of the DOM", () => {
  const page = read("js/pages/receive.js");
  assert.ok(!page.includes("paste-input"), "the receiver still has a paste-link box");
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
  // AdSense draws the creative in a SafeFrame served from
  // tpc.googlesyndication.com, and some creatives are framed from
  // doubleclick. Without these, Chrome replaces the ad with "This content is
  // blocked. Contact the site owner to fix the issue."
  assert.ok(
    /frame-src[^;]*\*\.googlesyndication\.com/.test(csp),
    "AdSense's SafeFrame would be blocked by frame-src",
  );
  assert.ok(
    /frame-src[^;]*\*\.doubleclick\.net/.test(csp),
    "ad creatives framed from doubleclick would be blocked",
  );
  assert.ok(
    /frame-src[^;]*\*\.google\.com/.test(csp),
    "Google's ad frames would be blocked",
  );
});
