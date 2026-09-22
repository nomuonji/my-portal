const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const encryptedPayload = require('../functions/_socialArchiveEncryptedPayload.js');
const socialStore = require('../functions/socialArchiveStore.js');

function decryptPayloads() {
  const keyHex = String(process.env.SOCIAL_ARCHIVE_IMPORT_DECRYPT_KEY || '');
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error('SOCIAL_ARCHIVE_IMPORT_DECRYPT_KEY is not configured');
  }
  const blob = Buffer.from(String(encryptedPayload || ''), 'base64');
  if (blob.length < 29) throw new Error('Encrypted payload is invalid');
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ciphertext = blob.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const payloads = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
  if (!Array.isArray(payloads) || !payloads.length) throw new Error('Import payloads are empty');
  return payloads;
}

async function main() {
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '');
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured');
  const serviceAccount = JSON.parse(raw);
  if (!getApps().length) {
    initializeApp({
      credential: cert(serviceAccount),
      projectId: serviceAccount.project_id || 'my-portal-d05fd',
    });
  }

  const payloads = decryptPayloads();
  const totals = { received: 0, created: 0, updated: 0 };
  for (const payload of payloads) {
    const result = await socialStore.importPosts({ ...payload, confirm: true });
    totals.received += Number(result.received || 0);
    totals.created += Number(result.created || 0);
    totals.updated += Number(result.updated || 0);
    console.log(JSON.stringify({
      importKey: result.importKey,
      received: result.received,
      created: result.created,
      updated: result.updated,
      complete: result.complete,
    }));
  }
  console.log(JSON.stringify({ socialArchiveImportTotals: totals }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
