import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("landing page references the shared stylesheet", () => {
  const html = readFileSync(join(webRoot, "index.html"), "utf8");
  assert.match(html, /\/assets\/styles\.css/);
});

test("receiver page exists and extracts transfer id client-side", () => {
  const html = readFileSync(join(webRoot, "app/receive.html"), "utf8");
  assert.match(html, /window\.location\.pathname/);
  assert.match(html, /transfer-id/);
});

test("dev server rewrites /send/{id} to the receiver page", async () => {
  const source = readFileSync(join(webRoot, "tools/dev_server.py"), "utf8");
  assert.match(source, /SEND_PATH/);
  assert.match(source, /receive\.html/);
});

test("core module directories exist for SP2 contracts", () => {
  assert.ok(existsSync(join(webRoot, "js/core")), "js/core missing");
  assert.ok(existsSync(join(webRoot, "test")), "test dir missing");
});
