import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  maxTotalSize,
  encryptedSize,
  validateSelection,
} from "../js/core/tiers.js";

const MB = 1024 * 1024;

const jsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "js");

function jsFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });
}

test("cloud tier is 10 MB free and 20 MB unlocked", () => {
  assert.equal(maxTotalSize("cloud", false), 10 * MB);
  assert.equal(maxTotalSize("cloud", true), 20 * MB);
});

test("p2p tier is 10 MB free and 30 MB unlocked", () => {
  assert.equal(maxTotalSize("p2p", false), 10 * MB);
  assert.equal(maxTotalSize("p2p", true), 30 * MB);
});

test("encrypted size adds IV prefix plus PKCS7 padding like the app", () => {
  assert.equal(encryptedSize(0), 16 + 16);
  assert.equal(encryptedSize(15), 16 + 16);
  assert.equal(encryptedSize(16), 16 + 32);
  assert.equal(encryptedSize(1024), 1024 + 16 + 16);
});

test("selection within the active limit passes", () => {
  const result = validateSelection(
    [{ name: "a", size: 1 * MB }],
    "cloud",
    false,
  );
  assert.equal(result.ok, true);
});

test("selection exceeding the free cloud limit fails with a hint", () => {
  const result = validateSelection(
    [{ name: "a", size: 25 * MB }],
    "cloud",
    false,
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /10/);
});

test("empty selection fails", () => {
  const result = validateSelection([], "cloud", true);
  assert.equal(result.ok, false);
});

test("multiple files sum toward the limit using encrypted sizes", () => {
  const result = validateSelection(
    [
      { name: "a", size: 19 * MB },
      { name: "b", size: 2 * MB },
    ],
    "cloud",
    false,
  );
  assert.equal(result.ok, false);
});

// The website has no rewarded-ad flow, so the unlocked tiers are unreachable
// here. These two tests pin that fact, so nobody "fixes" the send page by
// unlocking a tier the user has no way to earn - and so the number the page
// shows can never drift from the number it enforces.
test("no website code unlocks a paid tier", () => {
  const unlockCall = /(validateSelection|maxTotalSize)\([^)]*\btrue\b[^)]*\)/;
  for (const file of jsFiles(jsDir)) {
    const source = readFileSync(file, "utf8");
    assert.equal(
      unlockCall.test(source),
      false,
      `${file} unlocks a tier the website cannot earn`,
    );
  }
});

test("the sender page validates and labels the same free-tier limit", () => {
  const source = readFileSync(join(jsDir, "pages", "send.js"), "utf8");

  assert.match(
    source,
    /validateSelection\(selectedFiles,\s*MODE,\s*false\)/,
    "the sender must validate against the free tier",
  );
  assert.match(
    source,
    /maxTotalSize\("cloud",\s*false\)/,
    "the label must show the same limit the validation uses",
  );
});
