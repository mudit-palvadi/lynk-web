import { test } from "node:test";
import assert from "node:assert/strict";
import {
  maxTotalSize,
  encryptedSize,
  validateSelection,
} from "../js/core/tiers.js";

const MB = 1024 * 1024;

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
