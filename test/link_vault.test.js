// The receiver page carries an ad unit, so the transfer key has to be kept
// away from the ad script. It arrives in the URL fragment; this vault takes
// it out of the address bar and keeps it in session storage, so that it
// never travels with an ad request.
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
  const { calls, env } = fakeEnv();

  stashLink({ transferId: "abc", aesKey: "thekey", accessToken: "thetoken" }, env);

  assert.equal(calls.length, 1);
  assert.ok(!calls[0].includes("#"), `the fragment is still in the url: ${calls[0]}`);
  assert.ok(calls[0].includes("/send/abc"), "the path must survive");
});

test("the stashed link can be read back for a reload", () => {
  const { env } = fakeEnv();

  stashLink({ transferId: "abc", aesKey: "thekey", accessToken: "thetoken" }, env);
  const stashed = peekStashedLink(env);

  assert.equal(stashed.transferId, "abc");
  assert.equal(stashed.aesKey, "thekey");
  assert.equal(stashed.accessToken, "thetoken");
});

test("a stashed link without a key is not returned", () => {
  const { env } = fakeEnv();
  env.storage.setItem("lynkshare.receiver-link", JSON.stringify({ transferId: "abc", aesKey: "" }));

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

test("storage that refuses to work does not break the page", () => {
  const { calls, env } = fakeEnv();
  env.storage.setItem = () => {
    throw new Error("storage is full");
  };

  stashLink({ transferId: "abc", aesKey: "thekey", accessToken: "thetoken" }, env);

  // The fragment is still removed, and the page carries on.
  assert.equal(calls.length, 1);
  assert.equal(peekStashedLink(env), null);
});

test("a denied storage getter cannot prevent fragment removal or break cleanup", () => {
  const { calls, env } = fakeEnv();
  Object.defineProperty(env, "storage", {
    get() { throw new Error("SecurityError: storage access denied"); },
  });

  assert.doesNotThrow(() => scrubFragment(env));
  assert.doesNotThrow(() => stashLink({ transferId: "abc", aesKey: "thekey" }, env));
  assert.equal(calls.length, 2);
  assert.equal(peekStashedLink(env), null);
  assert.doesNotThrow(() => clearStashedLink(env));
});
