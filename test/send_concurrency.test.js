import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const page = readFileSync(new URL("../js/pages/send.js", import.meta.url), "utf8");
const sendCode = page.slice(page.indexOf("async function sendCloud()"), page.indexOf("/**", page.indexOf("async function sendP2P()")));

function sender({ fail = false } = {}) {
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const calls = { encrypt: 0, create: 0, direct: 0, cloud: 0 };
  const buttons = { disabled: false };
  const context = {
    sendActive: false,
    els: { p2pButton: { ...buttons }, cloudButton: { ...buttons }, fileInput: {}, progressTitle: {}, progressLabel: {} },
    generateKey: () => "test-key",
    encryptAll: async () => { calls.encrypt++; await barrier; if (fail) throw new Error('failed'); return []; },
    uploadEncrypted: async () => { calls.cloud++; },
    createTransferSession: async () => { calls.create++; return { transferId: "room-1" }; },
    sendViaP2p: async () => { calls.direct++; return true; },
    currentAccessToken: "test-token", phoneIsReady: false,
    resolveApiBase: () => "https://api.test.local",
    showResult() {}, setResultStatus() {}, recordSend() {}, clearInterval() {}, window: {},
    LimitExceededError: class extends Error {},
  };
  runInNewContext(`${sendCode}\nglobalThis.cloud = sendCloud; globalThis.direct = sendP2P;`, context);
  return { context, calls, release };
}

test('a failed send releases admission for a retry', async () => {
  const run = sender({ fail: true });
  run.release();
  await run.context.cloud();
  await run.context.direct();
  assert.equal(run.calls.encrypt, 2);
  assert.equal(run.context.sendActive, false);
});

for (const stage of ['create', 'lookup', 'wrap']) {
  test(`a stale code ${stage} callback cannot attach another transfer's credentials`, async () => {
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    let poll;
    const calls = [];
    const nodes = new Map(['sender-code', 'sender-code-status'].map((key) => [key, { textContent: '' }]));
    const context = {
      currentAccessToken: 'old-token', senderCodeTransferId: null,
      document: { getElementById: (id) => nodes.get(id) }, window: {},
      clearInterval() {}, setInterval: (callback) => { poll = callback; return 1; },
      resolveApiBase: () => 'https://api.test.local',
      LynkApi: class {
        async createSenderSession() { if (stage === 'create') await pending; return { sessionId: 'code-room', code: '123456', expiresIn: 600 }; }
        async getSenderSession() { if (stage === 'lookup') await pending; return { receiverPk: 'public-key' }; }
        async attachSenderKey(...args) { calls.push(args); }
      },
      wrapKey: async (args) => { assert.equal(args.accessToken, 'old-token'); if (stage === 'wrap') await pending; return 'sealed'; },
    };
    const code = page.slice(page.indexOf('async function showSenderCode('), page.indexOf('function showResult('));
    runInNewContext(`${code}\nglobalThis.start = showSenderCode;`, context);
    const starting = context.start('old-transfer', 'old-key', 'p2p');
    if (stage !== 'create') await starting;
    const polling = stage === 'create' ? null : poll();
    // A replacement send invalidates the previous code before its first await.
    context.senderCodeTransferId = null;
    context.currentAccessToken = 'new-token';
    nodes.get('sender-code-status').textContent = 'new-transfer-status';
    release();
    await starting;
    await polling;
    assert.deepEqual(calls, []);
    assert.equal(nodes.get('sender-code-status').textContent, 'new-transfer-status');
  });
}

test('file selection and pairing cannot mutate an admitted send', async () => {
  const handlers = new Map();
  const element = () => ({ classList: { add() {}, remove() {} }, addEventListener(name, callback) { handlers.set(`${this.id}:${name}`, callback); } });
  const input = { ...element(), id: 'input', files: [{ name: 'new' }], value: 'new' };
  const drop = { ...element(), id: 'drop' };
  const scan = { ...element(), id: 'scan' };
  const original = { name: 'original' };
  let refreshed = 0;
  let scanned = 0;
  const context = {
    sendActive: true, selectedFiles: [original],
    els: { fileInput: input, dropZone: drop, p2pButton: element(), cloudButton: element() },
    document: { getElementById: () => scan },
    refreshPickState: () => { refreshed++; }, scanReceiverQr: () => { scanned++; },
  };
  const removeCode = page.slice(page.indexOf('function removeFile('), page.indexOf('function renderFileList('));
  const handlersCode = page.slice(page.indexOf('els.fileInput.addEventListener'), page.indexOf('document.getElementById("scan-cancel-button")'));
  runInNewContext(`${removeCode}\n${handlersCode}\nglobalThis.remove = removeFile;`, context);
  context.remove(0);
  handlers.get('input:change')();
  handlers.get('drop:drop')({ preventDefault() {}, dataTransfer: { files: [{ name: 'dropped' }] } });
  await handlers.get('scan:click')();
  assert.equal(context.selectedFiles.length, 1);
  assert.equal(context.selectedFiles[0], original);
  assert.equal(refreshed, 0);
  assert.equal(scanned, 0);
});

for (const [first, second] of [["cloud", "cloud"], ["direct", "direct"], ["cloud", "direct"], ["direct", "cloud"]]) {
  test(`${first} then ${second} shares one active send admission`, async () => {
    const run = sender();
    const a = run.context[first]();
    const b = run.context[second]();
    const started = run.calls.encrypt;
    run.release();
    await Promise.all([a, b]);
    assert.equal(started, 1, "reject duplicate/cross-mode clicks before encryption yields");
    assert.equal(run.calls.direct + run.calls.cloud, 1);
    await run.context.cloud();
    assert.equal(run.calls.cloud + run.calls.direct, 2, "release admission after completion");
  });
}
