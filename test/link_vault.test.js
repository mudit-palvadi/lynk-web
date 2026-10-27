// The transfer key arrives in the URL fragment. The vault takes it out of
// the address bar and keeps it in memory for this page only.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clearStashedLink,
  peekStashedLink,
  scrubFragment,
  stashLink,
} from "../js/core/link_vault.js";

function fakeEnv(hash = "#thekey&a=thetoken") {
  const calls = [];
  const store = new Map();
  return {
    calls,
    store,
    env: {
      location: { href: `https://lynkshare.app/send/abc${hash}`, hash },
      history: {
        replaceState: (_a, _b, url) => calls.push(String(url)),
      },
      storage: {
        setItem: (k, v) => store.set(k, v),
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        removeItem: (k) => store.delete(k),
      },
    },
  };
}

test("stashing the link takes the fragment out of the address bar", () => {
  const { calls, store, env } = fakeEnv();

  stashLink({ transferId: "abc", aesKey: "thekey", accessToken: "thetoken" }, env);

  assert.equal(calls.length, 1);
  assert.ok(!calls[0].includes("#"), `the fragment is still in the url: ${calls[0]}`);
  assert.ok(calls[0].includes("/send/abc"), "the path must survive");
  assert.equal(store.size, 0, "the key must not be written to storage");
});

test("the stashed link can be read back on this page", () => {
  const { env } = fakeEnv();

  stashLink({ transferId: "abc", aesKey: "thekey", accessToken: "thetoken" }, env);
  const stashed = peekStashedLink(env);

  assert.equal(stashed.transferId, "abc");
  assert.equal(stashed.aesKey, "thekey");
  assert.equal(stashed.accessToken, "thetoken");
});

test("a stashed link without a key is not returned", () => {
  const { env } = fakeEnv();

  stashLink({ transferId: "abc", aesKey: "", accessToken: "thetoken" }, env);

  assert.equal(peekStashedLink(env), null);
});

test("the link is forgotten once the transfer is done", () => {
  const { env } = fakeEnv();

  stashLink({ transferId: "abc", aesKey: "thekey", accessToken: "thetoken" }, env);
  clearStashedLink(env);

  assert.equal(peekStashedLink(env), null);
});

test("scrubbing a page with no fragment does nothing", () => {
  const { calls, env } = fakeEnv("");

  scrubFragment(env);

  assert.equal(calls.length, 0);
});

test("a storage failure still keeps the key in memory", () => {
  const { calls, env } = fakeEnv();
  env.storage.setItem = () => {
    throw new Error("storage is full");
  };

  stashLink({ transferId: "abc", aesKey: "thekey", accessToken: "thetoken" }, env);

  assert.equal(calls.length, 1);
  assert.equal(peekStashedLink(env).aesKey, "thekey");
});

test("a denied storage getter cannot prevent fragment removal or break cleanup", () => {
  const { calls, env } = fakeEnv();
  Object.defineProperty(env, "storage", {
    get() { throw new Error("SecurityError: storage access denied"); },
  });

  assert.doesNotThrow(() => scrubFragment(env));
  assert.doesNotThrow(() => stashLink({ transferId: "abc", aesKey: "thekey" }, env));
  assert.equal(calls.length, 2);
  assert.equal(peekStashedLink(env).aesKey, "thekey");
  assert.doesNotThrow(() => clearStashedLink(env));
  assert.equal(peekStashedLink(env), null);
});
