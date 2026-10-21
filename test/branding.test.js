// Guards the product name on the site.
//
// The app was renamed to LynkShare; the site had to follow. The API header
// names are the wire protocol and keep the old name on purpose, so a word
// boundary followed by a dash is not the brand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(root, relative), "utf8");

const OLD_BRAND = /\bLynk\b(?!-)/g;

const BRANDED = [
  "index.html",
  "app/send.html",
  "app/receive.html",
  "manifest.webmanifest",
  "js/pages/send.js",
  "js/pages/receive.js",
];

test("nothing on the site still calls the product Lynk", () => {
  for (const file of BRANDED) {
    const hits = read(file).match(OLD_BRAND) ?? [];
    assert.deepEqual(hits, [], `${file} still says Lynk`);
  }
});

test("the site calls the product LynkShare", () => {
  assert.ok(read("index.html").includes("<title>LynkShare"));
  assert.ok(read("app/send.html").includes("LynkShare"));
  assert.ok(read("app/receive.html").includes("LynkShare"));
  assert.ok(read("manifest.webmanifest").includes('"short_name": "LynkShare"'));

  for (const page of ["index.html", "app/send.html", "app/receive.html"]) {
    assert.ok(read(page).includes("LynkShare"), `${page} has no brand`);
    assert.ok(
      read(page).includes('og:site_name" content="LynkShare"'),
      `${page} has no site name`,
    );
  }
});

test("the wire protocol keeps its header names", () => {
  const api = read("js/core/api.js");
  assert.ok(api.includes("X-Lynk-Access-Token"));
  assert.ok(api.includes("X-Lynk-Sender-Secret"));
});
