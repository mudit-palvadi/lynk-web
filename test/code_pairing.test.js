// Receiving by code: the browser publishes a key for the six digits, then
// collects the sender's wrapped transfer key from the same session.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { LynkApi } from "../js/core/api.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(join(root, "js/pages/receive.js"), "utf8");
const html = readFileSync(join(root, "app/receive.html"), "utf8");
const sendPage = readFileSync(join(root, "js/pages/send.js"), "utf8");
const sendHtml = readFileSync(join(root, "app/send.html"), "utf8");

function mockFetch(responses) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const next = responses.shift();
    return new Response(next.body ?? null, {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

test("joining a code sends the digits and the receiver's public key", async () => {
  const { fetch, calls } = mockFetch([
    {
      status: 201,
      body: JSON.stringify({
        session_id: "s1",
        status: "joined",
        expires_in: 600,
      }),
    },
  ]);
  const api = new LynkApi({ baseUrl: "http://b", fetch });

  const session = await api.joinSenderSession("123456", "pk-1");

  assert.equal(session.sessionId, "s1");
  assert.equal(session.expiresIn, 600);
  assert.equal(calls[0].url, "http://b/api/v1/sender-sessions/join");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    code: "123456",
    receiver_pk: "pk-1",
  });
});

test("a key response carries the transfer, the wrap and the send mode", async () => {
  const { fetch } = mockFetch([
    {
      body: JSON.stringify({
        transfer_id: "t7",
        wrapped_key: "wrapped",
        mode: "p2p",
        expires_in: 300,
      }),
    },
  ]);
  const api = new LynkApi({ baseUrl: "http://b", fetch });

  const key = await api.getSenderSessionKey("s1");

  assert.deepEqual(key, { transferId: "t7", wrappedKey: "wrapped", mode: "p2p" });
});

test("409 while the sender has not attached means keep waiting", async () => {
  const { fetch } = mockFetch([
    { status: 409, body: JSON.stringify({ detail: "not attached yet" }) },
  ]);
  const api = new LynkApi({ baseUrl: "http://b", fetch });

  assert.equal(await api.getSenderSessionKey("s1"), null);
});

test("the page wires the code box to the pairing endpoints", () => {
  assert.ok(html.includes('id="code-input"'), "there is no code box");
  assert.ok(html.includes('id="code-button"'), "there is no code button");
  assert.ok(
    page.includes("joinSenderSession"),
    "the page never joins a code session",
  );
  assert.ok(
    page.includes("getSenderSessionKey"),
    "the page never collects the wrapped key",
  );
  assert.ok(
    page.includes("unwrapDelivery"),
    "the page never unwraps the delivered key",
  );
});

test("a cloud sender is not waited on over a direct connection", () => {
  assert.ok(
    page.includes('state.mode !== "cloud"'),
    "the download always tries a direct connection first",
  );
});

test("a sender mints a code and records the send mode with the key", async () => {
  const { fetch, calls } = mockFetch([
    {
      status: 201,
      body: JSON.stringify({
        session_id: "s2",
        code: "654321",
        status: "waiting",
        expires_in: 600,
        sender_secret: "sender-secret",
      }),
    },
    {
      body: JSON.stringify({
        session_id: "s2",
        status: "joined",
        receiver_pk: "pk-2",
        expires_in: 500,
      }),
    },
    { body: JSON.stringify({ detail: "ok" }) },
  ]);
  const api = new LynkApi({ baseUrl: "http://b", fetch });

  const session = await api.createSenderSession();
  const view = await api.getSenderSession(session.sessionId);
  await api.attachSenderKey("s2", "t7", "wrapped", "p2p", session.senderSecret);

  assert.equal(session.code, "654321");
  assert.equal(session.senderSecret, "sender-secret");
  assert.equal(view.receiverPk, "pk-2");
  assert.equal(
    calls[2].options.headers["X-Lynk-Sender-Secret"],
    "sender-secret",
  );
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    transfer_id: "t7",
    wrapped_key: "wrapped",
    mode: "p2p",
  });
});

test("the send page shows the code and wraps for the joined receiver", () => {
  assert.ok(sendHtml.includes('id="sender-code"'), "there is no code display");
  assert.ok(
    sendPage.includes("createSenderSession"),
    "the send page never mints a code",
  );
  assert.ok(
    sendPage.includes("attachSenderKey"),
    "the send page never hands over the wrapped key",
  );
  assert.ok(
    sendPage.includes("session.senderSecret"),
    "the send page never sends the code secret",
  );
  assert.ok(
    sendPage.includes('"p2p"'),
    "a direct send does not tell the receiver it is direct",
  );
});
