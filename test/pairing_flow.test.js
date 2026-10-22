// The pairing flow: the web scans the phone's QR, so the phone already has
// the transfer. Showing it a QR code afterwards is noise, and the page should
// say what actually happened.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "js/pages/send.js"), "utf8");

test("a paired phone is marked as being on the other end", () => {
  const pairing = page.slice(page.indexOf("scan-pair-button"));
  assert.ok(
    pairing.includes("phoneIsReady = true"),
    "the pairing does not mark the phone as ready",
  );
});

test("a paired phone is not asked to scan a QR code", () => {
  assert.ok(
    page.includes('phoneIsReady ? "sent" : "qr"'),
    "the result is always shown as a QR code",
  );
  assert.ok(
    page.includes("Sent to the paired phone."),
    "the page does not say that the phone was sent the transfer",
  );
  assert.ok(
    page.includes("Sent to the phone."),
    "the QR area does not say what happened instead of the code",
  );
});

test("a plain cloud transfer still shows the QR code", () => {
  // The QR is the whole point when no phone is waiting: the receiver scans it.
  assert.ok(page.includes('mode === "qr"'), "the QR code is never drawn");
  assert.ok(
    page.includes("window.qrcode(0, \"M\")"),
    "the QR code is no longer generated",
  );
});
