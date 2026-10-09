'use strict';

const { createHash } = require('node:crypto');
const { lookup } = require('node:dns/promises');
const https = require('node:https');
const { isIP } = require('node:net');
const { getDocumentDb, FieldValue } = require('./documentDb');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_INLINE_BYTES = 3 * 1024 * 1024;
const MAX_ASSETS = 100;
const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);

function env(name) {
  try { return String(globalThis.Netlify?.env?.get(name) || process.env[name] || '').trim(); }
  catch (_) { return String(process.env[name] || '').trim(); }
}

function detectMime(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif';
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp' &&
      ['avif', 'avis'].includes(bytes.toString('ascii', 8, 12))) return 'image/avif';
  throw new Error('Unsupported or invalid image data. Use PNG, JPEG, WebP, GIF, or AVIF.');
}

function publicIPv4(address) {
  if (isIP(address) !== 4) return false;
  const parts = address.split('.').map(Number);
  const [a, b, c] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 88 && c === 99));
}

function parseRemoteUrl(value) {
  let url;
  try { url = new URL(value); } catch (_) { throw new Error('imageUrl must be an HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash ||
      !url.hostname || isIP(url.hostname) || url.hostname.endsWith('.local')) {
    throw new Error('imageUrl must be a public HTTPS URL without credentials, an IP address, fragments or custom ports.');
  }
  return url;
}

async function fromRemote(value) {
  const url = parseRemoteUrl(value);
  const addresses = await lookup(url.hostname, { all: true, family: 4, verbatim: true });
  if (!addresses.length || addresses.some((entry) => !publicIPv4(entry.address))) {
    throw new Error('Image host must resolve only to public IPv4 addresses.');
  }
  const selected = addresses[0].address;
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET',
      timeout: 10000,
      lookup: (_hostname, _options, callback) => callback(null, selected, 4),
      headers: { Accept: 'image/png,image/jpeg,image/webp,image/gif,image/avif', 'User-Agent': 'MyPortal-CharacterImage/1.0' },
    }, (response) => {
      // Never follow redirects: a public endpoint can otherwise bounce to metadata/internal services.
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error('Image source returned HTTP ' + response.statusCode + '. Redirects are not allowed.'));
        return;
      }
      const length = Number(response.headers['content-length'] || 0);
      if (length > MAX_IMAGE_BYTES) {
        response.destroy();
        reject(new Error('Image exceeds the 8 MiB limit.'));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) {
          response.destroy(new Error('Image exceeds the 8 MiB limit.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('Image download timed out.')));
    request.on('error', reject);
    request.end();
  });
}

function fromBase64(value) {
  const stripped = String(value).replace(/^data:image\/(?:png|jpeg|webp|gif|avif);base64,/i, '');
  if (!stripped || stripped.length > Math.ceil(MAX_INLINE_BYTES * 4 / 3) + 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(stripped) || stripped.length % 4 !== 0) {
    throw new Error('imageBase64 must be valid base64, up to 3 MiB decoded. For larger images use imageUrl.');
  }
  const bytes = Buffer.from(stripped, 'base64');
  if (!bytes.length || bytes.length > MAX_INLINE_BYTES) throw new Error('Inline image exceeds 3 MiB.');
  return bytes;
}

function extensionFor(mime) {
  return { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' }[mime];
}

async function uploadImageKit(bytes, mime, characterId, digest) {
  const privateKey = env('IMAGEKIT_PRIVATE_KEY');
  if (!privateKey) throw new Error('IMAGEKIT_PRIVATE_KEY is not configured on Netlify.');
  const form = new FormData();
  const name = 'character-' + digest.slice(0, 24) + '.' + extensionFor(mime);
  form.append('file', new Blob([bytes], { type: mime }), name);
  form.append('fileName', name);
  form.append('folder', '/my-portal/characters/' + characterId);
  form.append('useUniqueFileName', 'true');
  form.append('isPrivateFile', 'false');
  const response = await fetch('https://upload.imagekit.io/api/v1/files/upload', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(privateKey + ':').toString('base64') },
    body: form,
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error('ImageKit upload failed (HTTP ' + response.status + ').');
  const result = await response.json();
  if (!result.fileId || typeof result.url !== 'string' || !result.url.startsWith('https://')) {
    throw new Error('ImageKit response is missing a valid fileId or HTTPS URL.');
  }
  return result;
}

async function importCharacterImage(input = {}) {
  if (input.confirm !== true) throw new Error('Explicit user approval is required: confirm=true.');
  const characterId = String(input.characterId || '');
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(characterId)) throw new Error('Invalid characterId.');
  const hasUrl = typeof input.imageUrl === 'string' && Boolean(input.imageUrl.trim());
  const hasInline = typeof input.imageBase64 === 'string' && Boolean(input.imageBase64.trim());
  if (hasUrl === hasInline) throw new Error('Supply exactly one of imageUrl or imageBase64.');
  const requestedRole = input.role === undefined ? 'auto' : input.role;
  if (!['auto', 'avatar', 'reference'].includes(requestedRole)) throw new Error('Invalid image role.');

  // Check existence before transferring any bytes or uploading to the public CDN.
  const ref = getDocumentDb('(default)').collection('characters').doc(characterId);
  const before = await ref.get();
  if (!before.exists) throw new Error('Character not found.');
  const bytes = hasUrl ? await fromRemote(input.imageUrl) : fromBase64(input.imageBase64);
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Image exceeds the 8 MiB limit.');
  const mime = detectMime(bytes);
  if (!ACCEPTED.has(mime)) throw new Error('Unsupported image format.');
  const digest = createHash('sha256').update(bytes).digest('hex');
  const beforeAssets = Array.isArray(before.data().assets) ? before.data().assets : [];
  const duplicate = beforeAssets.find((asset) => asset.sha256 === digest);
  if (duplicate) return { characterId, asset: duplicate, duplicate: true, uploaded: false };
  if (beforeAssets.length >= MAX_ASSETS) throw new Error('Character has reached the 100-image limit.');
  // No DB mutation happens until ImageKit confirms its upload.
  const uploaded = await uploadImageKit(bytes, mime, characterId, digest);
  const asset = {
    id: uploaded.fileId,
    provider: 'imagekit',
    kind: 'image',
    role: 'reference',
    url: uploaded.url,
    filePath: uploaded.filePath || '',
    name: 'character-' + digest.slice(0, 24) + '.' + extensionFor(mime),
    size: bytes.length,
    mimeType: mime,
    sha256: digest,
    createdAt: new Date().toISOString(),
  };
  try {
    const result = await getDocumentDb('(default)').runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw new Error('Character was deleted during image upload.');
      const current = snapshot.data();
      const assets = Array.isArray(current.assets) ? current.assets : [];
      const existing = assets.find((value) => value.sha256 === digest);
      if (existing) return { asset: existing, duplicate: true };
      if (assets.length >= MAX_ASSETS) throw new Error('Character has reached the 100-image limit.');
      asset.role = (requestedRole === 'avatar' || (requestedRole === 'auto' && !assets.length)) ? 'avatar' : 'reference';
      const next = requestedRole === 'avatar'
        ? assets.map((value) => ({ ...value, role: 'reference' }))
        : assets.slice();
      next.push(asset);
      tx.update(ref, { assets: next, updatedAt: FieldValue.serverTimestamp() });
      return { asset, duplicate: false };
    });
    return { characterId, asset: result.asset, duplicate: result.duplicate, uploaded: true };
  } catch (_) {
    // ImageKit does not offer a transactional commit with the document DB.
    throw new Error('Image uploaded to ImageKit but the character DB update failed. Check ImageKit Media Library for orphan fileId: ' + uploaded.fileId);
  }
}

module.exports = { importCharacterImage, detectMime, publicIPv4, parseRemoteUrl, fromBase64 };
