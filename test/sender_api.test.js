import { test } from "node:test";
import assert from "node:assert/strict";
import { LynkApi } from "../js/core/api.js";
import { buildSendLink } from "../js/core/link_builder.js";

function mockFetch(responses) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const response = responses.shift();
    return new Response(response.body ?? null, {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

test("createTransfer posts file descriptors and maps upload urls", async () => {
  const { fetch, calls } = mockFetch([
    {
      status: 201,
      body: JSON.stringify({
        transfer_id: "t9",
        status: "pending",
        total_files: 1,
        total_size: 100,
        expires_in: 600,
        files: [
          { file_id: "f1", file_name: "a.bin", file_size: 100, upload_url: "https://r2/put" },
        ],
      }),
    },
  ]);
  const api = new LynkApi({ baseUrl: "http://b", fetch });

  const created = await api.createTransfer([
    { name: "a.bin", size: 90, type: "application/octet-stream" },
  ]);

  assert.equal(created.transferId, "t9");
  assert.equal(created.files[0].uploadUrl, "https://r2/put");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    files: [{ file_name: "a.bin", file_size: 90, content_type: "application/octet-stream" }],
  });
});

test("completeFile hits the per-file complete endpoint", async () => {
  const { fetch, calls } = mockFetch([
    { status: 200, body: JSON.stringify({ file_id: "f1", status: "ready", transfer_status: "ready" }) },
  ]);
  const api = new LynkApi({ baseUrl: "http://b", fetch });

  await api.completeFile("t9", "f1");
  assert.equal(calls[0].url, "http://b/api/v1/transfers/t9/files/f1/complete");
  assert.equal(calls[0].options.method, "POST");
});

test("extendTransfer returns the new expiry", async () => {
  const { fetch } = mockFetch([
    { status: 200, body: JSON.stringify({ transfer_id: "t9", status: "ready", expires_in: 1800 }) },
  ]);
  const api = new LynkApi({ baseUrl: "http://b", fetch });

  const result = await api.extendTransfer("t9");
  assert.equal(result.expiresIn, 1800);
});

test("413 maps to LimitExceededError with server detail", async () => {
  const { fetch } = mockFetch([
    { status: 413, body: JSON.stringify({ detail: "too big" }) },
  ]);
  const api = new LynkApi({ baseUrl: "http://b", fetch });

  await assert.rejects(
    () => api.createTransfer([]),
    (err) => err.name === "LimitExceededError",
  );
});

test("buildSendLink produces the canonical fragment link", () => {
  assert.equal(
    buildSendLink("https://lynkshare.app", "abc-123", "key123"),
    "https://lynkshare.app/send/abc-123#key123",
  );
});
