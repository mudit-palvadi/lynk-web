import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("assetlinks.json is valid and binds the app package to the upload cert", () => {
  const parsed = JSON.parse(
    readFileSync(join(webRoot, ".well-known/assetlinks.json"), "utf8"),
  );
  const statement = parsed[0];
  assert.equal(statement.target.namespace, "android_app");
  assert.equal(statement.target.package_name, "app.xynix.lynk");
  assert.ok(statement.target.sha256_cert_fingerprints.length >= 1);
  assert.match(statement.target.sha256_cert_fingerprints[0], /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
});

test("apple-app-site-association lists send and receive paths", () => {
  const parsed = JSON.parse(
    readFileSync(join(webRoot, ".well-known/apple-app-site-association"), "utf8"),
  );
  const detail = parsed.applinks.details[0];
  assert.match(detail.appID, /\.app\.xynix\.lynk$/);
  for (const path of ["/send/*", "/receive/*"]) {
    assert.ok(detail.paths.includes(path), `missing ${path}`);
  }
});

test("manifest references real icon files with correct sizes", () => {
  const manifest = JSON.parse(readFileSync(join(webRoot, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.background_color, "#0A0A0A");
  for (const icon of manifest.icons) {
    const file = join(webRoot, icon.src);
    assert.ok(existsSync(file), `missing icon ${icon.src}`);
    if (icon.src.endsWith(".png")) {
      const buf = readFileSync(file);
      // PNG signature + IHDR width/height at fixed offsets
      assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      const [declared] = icon.sizes.split("x").map(Number);
      assert.equal(width, declared);
      assert.equal(height, declared);
    }
  }
});

test("all pages link the manifest and declare the theme color", () => {
  for (const page of ["index.html", "app/send.html", "app/receive.html"]) {
    const html = readFileSync(join(webRoot, page), "utf8");
    assert.match(html, /manifest\.webmanifest/, `${page} missing manifest`);
    assert.match(html, /theme-color/, `${page} missing theme-color`);
  }
});

test("dev server serves well-known files as application/json", () => {
  const source = readFileSync(join(webRoot, "tools/dev_server.py"), "utf8");
  assert.match(source, /application\/json/);
  assert.match(source, /assetlinks/);
});
