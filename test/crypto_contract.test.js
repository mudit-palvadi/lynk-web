import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createCipheriv } from 'node:crypto';
import { encryptWithIvPrefix, decryptWithIvPrefix } from '../js/core/crypto.js';

const fixture = new URL('./fixtures/crypto_contract.json', import.meta.url);
const bytes = readFileSync(fixture);
const contract = JSON.parse(bytes);

test('cipher fixtures match the Dart copy when both repositories are checked out', () => {
  const dart = new URL('../../client/test/fixtures/crypto_contract.json', import.meta.url);
  if (existsSync(dart)) assert.deepEqual(bytes, readFileSync(dart));
  assert.equal(contract.version, 1);
});

for (const vector of contract.vectors) {
  test(`decrypt actual ${vector.name} bytes`, async () => {
    const plain = await decryptWithIvPrefix(Buffer.from(vector.packedBase64, 'base64'), vector.key);
    assert.deepEqual(Buffer.from(plain), Buffer.from(vector.plainBase64, 'base64'));
  });
}

test('trimmed multibyte UTF-8 key uses exactly 32 bytes', async () => {
  const key = 'é'.repeat(16);
  const plain = Uint8Array.from([0, 255, 42]);
  const packed = await encryptWithIvPrefix(plain, `  ${key}  `);
  const cipher = createCipheriv('aes-256-cbc', Buffer.from(key), packed.subarray(0, 16));
  assert.deepEqual(Buffer.from(packed.subarray(16)), Buffer.concat([cipher.update(plain), cipher.final()]));
  assert.deepEqual(Buffer.from(await decryptWithIvPrefix(packed, `  ${key}  `)), Buffer.from(plain));
});

for (const key of contract.invalidKeys) {
  test(`reject invalid key without echoing it (${Buffer.byteLength(key)} bytes)`, async () => {
    const vector = contract.vectors[0];
    const safeError = (error) => error instanceof Error && !String(error).includes(key);
    await assert.rejects(encryptWithIvPrefix(new Uint8Array([1]), key), safeError);
    await assert.rejects(decryptWithIvPrefix(Buffer.from(vector.packedBase64, 'base64'), key), safeError);
  });
}
