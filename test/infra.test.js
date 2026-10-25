import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("assetlinks.json binds only the upload and Play signing certificates", () => {
  const parsed = JSON.parse(
    readFileSync(join(webRoot, ".well-known/assetlinks.json"), "utf8"),
  );
  const statement = parsed[0];
  assert.deepEqual(statement.relation, ["delegate_permission/common.handle_all_urls"]);
  assert.equal(statement.target.namespace, "android_app");
  assert.equal(statement.target.package_name, "app.xynix.lynk");
  // Both distribution paths must work; a debug certificate must not be published.
  assert.deepEqual([...statement.target.sha256_cert_fingerprints].sort(), [
    "74:25:40:24:ED:53:EF:1F:A7:8F:00:B7:D1:72:7B:6A:CC:4B:12:B9:20:8D:EB:8D:48:11:58:6C:6C:C8:F0:94",
    "1E:16:7F:D3:94:36:E0:EA:91:95:24:B3:28:51:FC:EA:8A:84:18:85:D4:7C:9B:8B:0A:5F:2F:4D:81:F8:94:D6",
  ].sort());
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
