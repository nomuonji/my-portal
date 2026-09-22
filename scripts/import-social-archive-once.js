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

async function runPass(payloads) {
  const totals = { received: 0, created: 0, updated: 0 };
  for (const payload of payloads) {
    const result = await socialStore.importPosts({ ...payload, confirm: true });
    totals.received += Number(result.received || 0);
    totals.created += Number(result.created || 0);
    totals.updated += Number(result.updated || 0);
  }
  return totals;
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
  const firstPass = await runPass(payloads);
  const secondPass = await runPass(payloads);
  const status = await socialStore.status();
  const replies = await socialStore.searchPosts({
    account: '1334823231262314497',
    type: 'reply',
    limit: 200,
    scanLimit: 5000,
  });
  const reposts = await socialStore.searchPosts({
    account: '1334823231262314497',
    type: 'repost',
    limit: 200,
    scanLimit: 5000,
  });
  const sample = await socialStore.searchPosts({
    account: '1334823231262314497',
    limit: 5,
    scanLimit: 5000,
  });

  if (secondPass.received !== 1638 || secondPass.created !== 0 || secondPass.updated !== 1638) {
    throw new Error(`Duplicate import verification failed: ${JSON.stringify(secondPass)}`);
  }
  if (status.counts.posts !== 1638 || status.counts.accounts !== 1 || status.counts.importRuns !== 1) {
    throw new Error(`Archive count verification failed: ${JSON.stringify(status.counts)}`);
  }
  if (replies.count !== 94 || reposts.count !== 18 || sample.count !== 5) {
    throw new Error(`Archive sample/type verification failed: replies=${replies.count}, reposts=${reposts.count}, sample=${sample.count}`);
  }

  console.log(JSON.stringify({
    socialArchiveVerification: {
      firstPass,
      secondPass,
      counts: status.counts,
      replies: replies.count,
      reposts: reposts.count,
      sampleCount: sample.count,
    },
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
