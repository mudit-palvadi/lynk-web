import { test } from "node:test";
import assert from "node:assert/strict";
import { acquireReceiverOwnership } from "../js/core/receiver_ownership.js";

function lockManager() {
  const held = new Set();
  const calls = [];
  return {
    calls, held,
    async request(name, options, callback) {
      calls.push({ name, options });
      assert.deepEqual(options, { mode: "exclusive", ifAvailable: true });
      const available = !held.has(name);
      if (available) held.add(name);
      try {
        return await callback(available ? { name } : null);
      } finally {
        if (available) held.delete(name);
      }
    },
  };
}

const input = { apiBase: "https://api.test.local/api/v1/", transferId: "room" };

test("simultaneous receiver claims have one winner, no queue, and an idempotent awaited release", async () => {
  const locks = lockManager();
  const [one, two] = await Promise.all([
    acquireReceiverOwnership({ ...input, locks }), acquireReceiverOwnership({ ...input, locks }),
  ]);
  assert.equal(one.status, "acquired");
  assert.equal(two.status, "busy");
  assert.equal(locks.held.size, 1);
  const release = one.release();
  assert.equal(one.release(), release);
  await release;
  assert.equal(locks.held.size, 0);
  const retry = await acquireReceiverOwnership({ ...input, locks });
  assert.equal(retry.status, "acquired");
  await retry.release();
});

test("different rooms and API origins do not conflict; names contain no credentials", async () => {
  const locks = lockManager();
  const claims = await Promise.all([
    acquireReceiverOwnership({ ...input, locks }),
    acquireReceiverOwnership({ ...input, transferId: "room/2?#", locks }),
    acquireReceiverOwnership({ ...input, apiBase: "https://other.test.local", locks }),
  ]);
  assert.ok(claims.every((claim) => claim.status === "acquired"));
  assert.equal(new Set(locks.calls.map(({ name }) => name)).size, 3);
  assert.ok(locks.calls.every(({ name }) => name.startsWith("lynkshare:p2p:receiver:https://")));
  assert.ok(locks.calls.some(({ name }) => name.endsWith("room%2F2%3F%23")));
  await Promise.all(claims.map((claim) => claim.release()));
});

test("receiver ownership does not block a same-origin sender role", async () => {
  const locks = lockManager();
  const receiver = await acquireReceiverOwnership({ ...input, locks });
  let senderRan = false;
  await locks.request("lynkshare:p2p:sender:https://api.test.local:room", { mode: "exclusive", ifAvailable: true }, (lock) => {
    assert.ok(lock);
    senderRan = true;
  });
  assert.equal(senderRan, true);
  await receiver.release();
});

for (const failure of ["missing", "throw", "reject"]) {
  test(`unavailable locking is explicit (${failure})`, async () => {
    const locks = failure === "missing" ? {} : {
      request() {
        if (failure === "throw") throw new Error("policy denied");
        return Promise.reject(new Error("policy denied"));
      },
    };
    assert.deepEqual(await acquireReceiverOwnership({ ...input, locks }), { status: "unavailable" });
  });
}

test("equivalent API URLs use the same room namespace", async () => {
  const locks = lockManager();
  const owner = await acquireReceiverOwnership({ ...input, locks });
  const duplicate = await acquireReceiverOwnership({ ...input, apiBase: "https://API.test.local:443/", locks });
  assert.equal(duplicate.status, "busy");
  await owner.release();
});

test("a denied navigator.locks getter falls back without throwing", async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: {
    get locks() { throw new Error("storage access denied"); },
  } });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
    else delete globalThis.navigator;
  });
  assert.deepEqual(await acquireReceiverOwnership(input), { status: "unavailable" });
});

test("URL credentials, query and fragment do not enter the public lock name", async () => {
  const locks = lockManager();
  const owner = await acquireReceiverOwnership({ ...input, apiBase: "https://user:password@api.test.local/api/v1?token=private#key", locks });
  assert.equal(locks.calls[0].name, "lynkshare:p2p:receiver:https://api.test.local:room");
  await owner.release();
});
