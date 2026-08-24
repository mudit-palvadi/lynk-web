import { test } from "node:test";
import assert from "node:assert/strict";
import { HistoryStore, MAX_RECORDS } from "../js/core/history_store.js";

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

const RECORD = {
  id: "t1",
  type: "sent",
  fileNames: ["a.bin"],
  totalSize: 1234,
  timestamp: 1724000000000,
  status: "completed",
};

test("adds and lists records newest first", () => {
  const store = new HistoryStore({ storage: fakeStorage() });
  store.add(RECORD);
  store.add({ ...RECORD, id: "t2", timestamp: RECORD.timestamp + 5 });
  const list = store.list();
  assert.equal(list.length, 2);
  assert.equal(list[0].id, "t2");
});

test("prunes beyond 20 records keeping the most recent", () => {
  const store = new HistoryStore({ storage: fakeStorage() });
  for (let i = 0; i < MAX_RECORDS + 5; i++) {
    store.add({ ...RECORD, id: `r${i}`, timestamp: RECORD.timestamp + i });
  }
  const list = store.list();
  assert.equal(list.length, MAX_RECORDS);
  assert.equal(list[0].id, `r${MAX_RECORDS + 4}`);
  assert.equal(list.at(-1).id, "r5");
});

test("records survive a new store instance over the same storage", () => {
  const storage = fakeStorage();
  new HistoryStore({ storage }).add(RECORD);
  const reopened = new HistoryStore({ storage });
  assert.equal(reopened.list().length, 1);
  assert.equal(reopened.list()[0].fileNames[0], "a.bin");
});

test("clear empties the list", () => {
  const store = new HistoryStore({ storage: fakeStorage() });
  store.add(RECORD);
  store.clear();
  assert.equal(store.list().length, 0);
});

test("corrupt storage content degrades to empty list", () => {
  const storage = fakeStorage();
  storage.setItem("lynk-history", "{not json");
  const store = new HistoryStore({ storage });
  assert.deepEqual(store.list(), []);
});

test("keys and links are stripped from stored records", () => {
  const storage = fakeStorage();
  const store = new HistoryStore({ storage });
  store.add({
    ...RECORD,
    aesKey: "secret-key-value",
    link: "https://lynkshare.app/send/t1#secret-key-value",
  });
  const raw = storage._map.get("lynk-history");
  assert.ok(!raw.includes("secret-key-value"));
});
