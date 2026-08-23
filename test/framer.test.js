import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeHeader,
  encodeEof,
  encodeDone,
  parseText,
} from "../js/core/framer.js";

test("header frame JSON matches Dart jsonEncode output exactly", () => {
  const raw = encodeHeader({ name: "photo.jpg", size: 204800 });
  assert.equal(raw, '{"t":"hdr","name":"photo.jpg","size":204800}');
});

test("eof frame carries only type and name", () => {
  const raw = encodeEof({ name: "photo.jpg" });
  assert.equal(raw, '{"t":"eof","name":"photo.jpg"}');
});

test("done frame is a bare type marker", () => {
  assert.equal(encodeDone(), '{"t":"done"}');
});

test("parseText decodes a valid header", () => {
  const parsed = parseText('{"t":"hdr","name":"a.bin","size":5}');
  assert.deepEqual(parsed, { kind: "header", name: "a.bin", size: 5 });
});

test("parseText decodes eof and done", () => {
  assert.deepEqual(parseText('{"t":"eof","name":"a.bin"}'), {
    kind: "eof",
    name: "a.bin",
  });
  assert.deepEqual(parseText('{"t":"done"}'), { kind: "done" });
});

test("parseText returns null for malformed input without throwing", () => {
  assert.equal(parseText("not json"), null);
  assert.equal(parseText("[1,2,3]"), null);
  assert.equal(parseText('{"no-type":true}'), null);
});

test("parseText rejects frames with wrong field types", () => {
  assert.equal(parseText('{"t":"hdr","name":5,"size":5}'), null);
  assert.equal(parseText('{"t":"hdr","name":"a","size":"5"}'), null);
  assert.equal(parseText('{"t":"eof","name":null}'), null);
});

test("parseText rejects unknown frame types", () => {
  assert.equal(parseText('{"t":"mystery"}'), null);
});
