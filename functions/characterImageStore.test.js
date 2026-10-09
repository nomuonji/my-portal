'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { detectMime, publicIPv4, parseRemoteUrl, fromBase64, importCharacterImage } = require('./characterImageStore');

test('blocks local and metadata-network SSRF targets, redirects are not followed by importer', () => {
  for (const input of [
    'http://example.com/test.png', 'https://127.0.0.1/test.png',
    'https://[::1]/image.png', 'https://localhost:8080/a.png',
    'https://user:secret@example.com/a.png', 'https://example.com:8443/a.png',
  ]) assert.throws(() => parseRemoteUrl(input), { message: /public HTTPS|HTTPS URL/ });
  for (const address of [
    '127.0.0.1', '10.2.3.4', '172.16.2.3', '192.168.2.1',
    '169.254.169.254', '100.64.1.1', '198.18.0.1', '0.1.2.3', '224.0.0.1',
  ]) assert.equal(publicIPv4(address), false, address);
  assert.equal(publicIPv4('8.8.8.8'), true);
});

test('checks actual image bytes rather than user-provided MIME metadata', () => {
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  assert.equal(detectMime(png), 'image/png');
  const jpeg = Buffer.from('ffd8ffe10012', 'hex');
  assert.equal(detectMime(jpeg), 'image/jpeg');
  const webp = Buffer.from('RIFF0000WEBPVP8 ', 'ascii');
  assert.equal(detectMime(webp), 'image/webp');
  assert.throws(() => detectMime(Buffer.from('<svg onload="alert(1)"></svg>')), /Unsupported/);
  assert.throws(() => detectMime(Buffer.from('not-an-image')), /Unsupported/);
});

test('base64 import accepts valid small bytes, rejects excessive size and malformed data', () => {
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  assert.deepEqual(fromBase64('data:image/png;base64,' + png.toString('base64')), png);
  assert.throws(() => fromBase64('@@@'), /valid base64/);
  assert.throws(() => fromBase64('A'.repeat(4 * 1024 * 1024 + 80)), /valid base64/);
});

test('explicit approval and safe identifier are checked before touching the DB', async () => {
  await assert.rejects(importCharacterImage({ characterId: 'abc', imageBase64: 'AA==' }), /confirm=true/);
  await assert.rejects(importCharacterImage({ characterId: '../secret', imageBase64: 'AA==', confirm: true }), /Invalid characterId/);
});
