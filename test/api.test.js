import { test } from "node:test";
import assert from "node:assert/strict";
import { LynkApi } from "../js/core/api.js";

function mockFetch(responses) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const response = responses.shift();
    if (!response) throw new Error("unexpected extra call");
    return new Response(response.body ?? null, {
      status: response.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

const METADATA = {
  transfer_id: "t1",
  status: "ready",
  total_files: 1,
  total_size: 10,
  expires_in: 600,
  files: [
    { file_id: "f1", file_name: "a.txt", file_size: 10, content_type: "text/plain" },
  ],
};

test("getTransferMetadata hits the versioned transfers endpoint", async () => {
  const { fetch, calls } = mockFetch([{ status: 200, body: JSON.stringify(METADATA) }]);
  const api = new LynkApi({ baseUrl: "http://140.245.220.117:8000", fetch });

  const meta = await api.getTransferMetadata("t1");
  assert.equal(meta.files[0].file_name, "a.txt");
  assert.equal(calls[0].url, "http://140.245.220.117:8000/api/v1/transfers/t1");
});

test("getDownloadUrls posts file_ids payload and maps download_url", async () => {
  const { fetch, calls } = mockFetch([
    {
      status: 200,
      body: JSON.stringify({
        files: [{ file_id: "f1", file_name: "a.txt", download_url: "https://r2/x", expires_in: 300 }],
      }),
    },
  ]);
  const api = new LynkApi({ baseUrl: "http://b", fetch });

  const files = await api.getDownloadUrls("t1");
  assert.equal(files[0].downloadUrl, "https://r2/x");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { file_ids: null });
});

test("404 maps to a TransferNotFound error with friendly message", async () => {
  const { fetch } = mockFetch([
    { status: 404, body: JSON.stringify({ detail: "Transfer not found or expired" }) },
  ]);
  const api = new LynkApi({ baseUrl: "http://b", fetch });

  await assert.rejects(
    () => api.getTransferMetadata("gone"),
    (err) => err.name === "TransferNotFoundError",
  );
});

test("network failure maps to a NetworkError", async () => {
  const api = new LynkApi({
    baseUrl: "http://b",
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });
  await assert.rejects(
    () => api.getTransferMetadata("t"),
    (err) => err.name === "NetworkError",
  );
});
