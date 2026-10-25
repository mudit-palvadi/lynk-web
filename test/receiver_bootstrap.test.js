import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { parseSendLink } from "../js/core/link_parser.js";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("app/receive.html", root), "utf8");

// A cached async ad can execute as soon as the parser encounters its tag,
// before the receiver module and its dependencies have downloaded.
function parseUntilFirstThirdParty(href, storageDenied) {
  const original = href;
  const window = {
    location: new URL(href),
    history: {
      replaceState(_state, _title, clean) { window.location = new URL(clean); },
    },
    get sessionStorage() {
      if (storageDenied) throw new Error("Storage access denied");
      return { setItem() {} };
    },
  };
  let sawAd = false;
  for (const [, attrs] of html.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script>/gi)) {
    const src = attrs.match(/\bsrc="([^"]+)"/)?.[1];
    if (!src) continue;
    const url = new URL(src, original);
    if (url.origin !== new URL(original).origin) {
      sawAd = true;
      assert.equal(window.location.hash, "", "the ad can read the key fragment before the module runs");
      break;
    }
    if (/\b(?:async|defer)\b|type="module"/.test(attrs)) continue;
    runInNewContext(readFileSync(new URL(src.slice(1), root), "utf8"), { window, URL });
  }
  assert.equal(sawAd, true, "the static AdSense ownership script must remain present");
  return window;
}

for (const storageDenied of [false, true]) {
  test(`the key is scrubbed before a cached ad runs (storage denied: ${storageDenied})`, () => {
    const original = "https://lynkshare.app/send/abc#test-key&a=test-token";
    const window = parseUntilFirstThirdParty(original, storageDenied);
    assert.equal(window.location.pathname, "/send/abc");
    assert.equal(window.__lynkTakeInitialLink(), original, "the receiver still needs the original link");
    assert.equal(window.__lynkTakeInitialLink, undefined, "the link handoff is consumed once");
  });
}

test("the receiver startup adopts the original link after the bootstrap scrubs it", () => {
  const original = "https://lynkshare.app/send/abc#test-key&a=test-token";
  const window = parseUntilFirstThirdParty(original, true);
  const page = readFileSync(new URL("js/pages/receive.js", root), "utf8");
  const startup = page.slice(page.indexOf("const initialLink ="), page.indexOf("async function startPairing"));
  assert.ok(startup, "receiver startup must consume the bootstrap handoff");
  let adopted;
  runInNewContext(startup, {
    window, URL, parseSendLink,
    peekStashedLink: () => { throw new Error("the first load must not need storage"); },
    adoptLink: (url) => { adopted = url; },
  });
  assert.equal(adopted.href, original);
  assert.equal(window.location.hash, "");
  assert.equal(window.__lynkTakeInitialLink, undefined);
});

test("code-first visits and query strings are left intact without a fragment", () => {
  const original = "https://lynkshare.app/app/receive?example=1";
  const window = parseUntilFirstThirdParty(original, true);
  assert.equal(window.location.href, original);
  assert.equal(window.__lynkTakeInitialLink, undefined);
});
