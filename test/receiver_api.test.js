import { test } from "node:test";
import assert from "node:assert/strict";
import { LynkApi } from "../js/core/api.js";

function mockFetch(responses) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(responses.shift().body ?? null, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

test("createReceiverSession posts to the versioned endpoint", async () => {
  const { fetch, calls } = mockFetch([
    { body: JSON.stringify({ session_id: "rs1", status: "waiting", expires_in: 600 }) },
  ]);
  const api = new LynkApi({ baseUrl: "http://b", fetch });

  const session = await api.createReceiverSession();
  assert.equal(session.sessionId, "rs1");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].url, "http://b/api/v1/receiver-sessions");
});

test("getReceiverSession maps snake_case fields", async () => {
  const { fetch } = mockFetch([
    {
      body: JSON.stringify({
        session_id: "rs1",
        status: "attached",
        transfer_id: "t5",
        wrapped_key: "wk",
        expires_in: 300,
      }),
    },
  ]);
  const api = new LynkApi({ baseUrl: "http://b", fetch });

  const session = await api.getReceiverSession("rs1");
  assert.deepEqual(session, {
    sessionId: "rs1",
    status: "attached",
    transferId: "t5",
    wrappedKey: "wk",
    expiresIn: 300,
  });
});

test("attachTransfer posts transfer id and wrapped key only", async () => {
  const { fetch, calls } = mockFetch([{ body: JSON.stringify({ detail: "ok" }) }]);
  const api = new LynkApi({ baseUrl: "http://b", fetch });

  await api.attachTransfer("rs1", "t5", "wrapped-blob");
  assert.equal(calls[0].url, "http://b/api/v1/receiver-sessions/rs1/attach-transfer");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    transfer_id: "t5",
    wrapped_key: "wrapped-blob",
  });
});
