import { test } from "node:test";
import assert from "node:assert/strict";
import { safeFileName } from "../js/core/file_names.js";

const NUL = String.fromCharCode(0);

test("an ordinary name is left alone", () => {
  assert.equal(safeFileName("photo.jpg"), "photo.jpg");
  assert.equal(safeFileName("my holiday photo.tar.gz"), "my holiday photo.tar.gz");
  assert.equal(safeFileName(".gitignore"), ".gitignore");
  assert.equal(safeFileName("ünïcödé.txt"), "ünïcödé.txt");
});

test("a parent directory reference keeps only the last segment", () => {
  assert.equal(safeFileName("../etc/passwd"), "passwd");
  assert.equal(safeFileName("../../.ssh/authorized_keys"), "authorized_keys");
});

test("a directory prefix is dropped", () => {
  assert.equal(safeFileName("folder/file.txt"), "file.txt");
});

test("a windows separator is treated as a separator too", () => {
  assert.equal(safeFileName("folder\\file.txt"), "file.txt");
  assert.equal(safeFileName("C:\\Windows\\System32\\config"), "config");
});

test("an absolute posix path keeps only the last segment", () => {
  assert.equal(safeFileName("/etc/passwd"), "passwd");
});

test("a name that is not a file falls back", () => {
  assert.equal(safeFileName(".."), "file");
  assert.equal(safeFileName("."), "file");
  assert.equal(safeFileName(""), "file");
  assert.equal(safeFileName("   "), "file");
  assert.equal(safeFileName(undefined), "file");
  assert.equal(safeFileName(null), "file");
});

test("control characters are removed", () => {
  assert.equal(safeFileName(`with${NUL}null.txt`), "withnull.txt");
  assert.equal(safeFileName("with\nnewline.txt"), "withnewline.txt");
  assert.equal(safeFileName("with\ttab.txt"), "withtab.txt");
});

test("the result is always a single safe segment", () => {
  const hostile = [
    "../etc/passwd",
    "..\\..\\windows\\system32",
    "/absolute/path.txt",
    "..",
    "a/b/c/d.txt",
    `name with ${NUL} null`,
    "",
  ];

  for (const raw of hostile) {
    const safe = safeFileName(raw);
    assert.ok(!safe.includes("/"), `"${raw}" kept a forward slash`);
    assert.ok(!safe.includes("\\"), `"${raw}" kept a backslash`);
    assert.ok(!safe.startsWith(".."), `"${raw}" still starts with a parent reference`);
    assert.ok(safe.length > 0, `"${raw}" became empty`);
  }
});

test("a long name is trimmed to the byte budget", () => {
  const safe = safeFileName("a".repeat(400));
  assert.equal(new TextEncoder().encode(safe).length, 255);
});

test("a multi-byte name is trimmed on a character boundary", () => {
  const safe = safeFileName("é".repeat(200));
  assert.ok(new TextEncoder().encode(safe).length <= 255);
  assert.ok(!safe.includes("�"), "the name was split mid-character");
});