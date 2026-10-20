import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSendLink } from "../js/core/link_builder.js";
import { parseSendLink } from "../js/core/link_parser.js";

const BASE = "https://lynkshare.app";
const TRANSFER_ID = "_s8CuT1G6vCi";
const AES_KEY = "d314956182fd0af22a4797f4a1f2d4e7";
const ACCESS_TOKEN = "mVLh-Cw6JtD560wetHFf6kH3n0wl3w0H96qHm38KCOw";

test("a share link carries the transfer id, the key and the access token", () => {
  const link = buildSendLink(BASE, TRANSFER_ID, AES_KEY, ACCESS_TOKEN);

  assert.equal(link, `${BASE}/send/${TRANSFER_ID}#${AES_KEY}&a=${ACCESS_TOKEN}`);

  const parsed = parseSendLink(new URL(link));
  assert.equal(parsed.transferId, TRANSFER_ID);
  assert.equal(parsed.aesKey, AES_KEY);
  assert.equal(parsed.accessToken, ACCESS_TOKEN);
});

test("a share link without an access token has no capability marker", () => {
  const link = buildSendLink(BASE, TRANSFER_ID, AES_KEY, "");

  assert.equal(link, `${BASE}/send/${TRANSFER_ID}#${AES_KEY}`);
  assert.ok(!link.includes("&a="));
  assert.equal(parseSendLink(new URL(link)).accessToken, "");
});

test("the P2P sender creates the server transfer before it publishes the link", () => {
  // The page module is DOM-bound and has no import-free entry point, so the
  // invariant that broke production is asserted on the source instead: the
  // sender has to create the server-side transfer first, because the
  // receiver reads the transfer metadata (which needs the access token)
  // before it connects, and the signaling server only accepts live transfer
  // ids. A locally generated session id 404s on the metadata and can no
  // longer open a room, so the P2P flow never starts.
  const source = readFileSync(
    new URL("../js/pages/send.js", import.meta.url),
    "utf8",
  );

  const start = source.indexOf("async function sendP2P");
  assert.ok(start >= 0, "sendP2P must exist");

  const p2p = source.slice(start);
  assert.ok(
    p2p.includes("createTransferSession("),
    "sendP2P must create the server transfer before it shows the link",
  );
  assert.ok(
    !source.includes("generateSessionId"),
    "the locally generated session id must be gone",
  );
});
