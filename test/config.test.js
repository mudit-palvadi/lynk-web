import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveApiBase } from "../js/core/config.js";

function page(search) {
  return {
    href: `https://lynkshare.app/send/abc${search}`,
    origin: "https://lynkshare.app",
    searchParams: new URL(`https://lynkshare.app/send/abc${search}`).searchParams,
  };
}

test("the public api is accepted from the query", () => {
  assert.equal(
    resolveApiBase(page("?api=https://api.lynkshare.app/")),
    "https://api.lynkshare.app",
  );
});

test("a loopback api is accepted from the query", () => {
  assert.equal(
    resolveApiBase(page("?api=http://127.0.0.1:8000")),
    "http://127.0.0.1:8000",
  );
});

test("an unrelated api in the query is ignored", () => {
  const location = page("?api=https://ads.example");
  assert.equal(resolveApiBase(location), "https://lynkshare.app");
});

test("a passed-in location is not cached for the next call", () => {
  resolveApiBase(page("?api=https://api.lynkshare.app"));
  assert.equal(
    resolveApiBase(page("?api=http://localhost:8000")),
    "http://localhost:8000",
  );
});
